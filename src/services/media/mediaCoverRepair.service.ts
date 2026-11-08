import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { activityLogs, items, mediaAssets } from '../../db/schema.js';
import { markItemCover } from './mediaArrange.service.js';
import { ITEM_AUDIT_ENTITY } from './mediaProducts.service.js';

/**
 * v12 phase 7 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §4): from v10.1.71 to v12 «تصویر شاخص محصول شود» set the item's
 * picture but not the library cover mark the site and the WooCommerce push read. This manual repair (never at boot, AGENTS.md
 * §4.9 style: dry run first) finds each live product with library photos and no cover, and when the item's audit trail says
 * which library file its current picture came from (the latest «کالا» row with `mediaAssetId`, whose `after.image` is still
 * the item's image), marks that file as the cover through the same path as the button, with its audit rows. It also lists
 * products whose picture is outside the library, which the site cannot show until a photo is uploaded to the library.
 * `itemIds` limits the run to those items (tests).
 */
export interface CoverRepairReport {
  withPhotosNoCover: number;
  markable: Array<{ itemId: number; code: string; assetId: number }>;
  markedNow: number;
  skipped: Array<{ itemId: number; reason: string }>;
  pictureOutsideLibrary: Array<{ itemId: number; code: string }>;
}

const REPAIR_ACTOR = { username: 'cover-repair' } as const;

export async function repairItemCovers(options: { apply: boolean; itemIds?: number[] }): Promise<CoverRepairReport> {
  const scope = options.itemIds ? [inArray(items.id, options.itemIds.length ? options.itemIds : [-1])] : [];
  const products = await orm.select({ id: items.id, code: items.code, image: items.image }).from(items)
    .where(and(eq(items.isDeleted, 0), eq(items.type, 'product'), ...scope));
  const productOf = new Map(products.map(p => [p.id, { code: p.code, image: String(p.image ?? '').trim() }]));
  const ids = [...productOf.keys()];

  const photosOf = new Map<number, { ids: Set<number>; covered: boolean }>();
  if (ids.length > 0) {
    const photoRows = await orm.select({ itemId: mediaAssets.itemId, id: mediaAssets.id, isCover: mediaAssets.isCover }).from(mediaAssets)
      .where(and(inArray(mediaAssets.itemId, ids), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
    for (const row of photoRows) {
      const entry = photosOf.get(Number(row.itemId)) ?? { ids: new Set<number>(), covered: false };
      entry.ids.add(row.id);
      if (row.isCover === 1) entry.covered = true;
      photosOf.set(Number(row.itemId), entry);
    }
  }
  const uncovered = [...photosOf].filter(([, e]) => !e.covered).map(([itemId]) => itemId);
  const pictureOutsideLibrary = products.filter(p => String(p.image ?? '').trim() !== '' && !photosOf.has(p.id)).map(p => ({ itemId: p.id, code: p.code }));

  // the latest library choice of each uncovered item, in one read
  const lastChoice = new Map<number, { assetId: number; image: string }>();
  if (uncovered.length > 0) {
    const logs = await orm.selectDistinctOn([activityLogs.entityId], { entityId: activityLogs.entityId, details: activityLogs.details }).from(activityLogs)
      .where(and(
        eq(activityLogs.entity, ITEM_AUDIT_ENTITY), inArray(activityLogs.entityId, uncovered.map(String)), sql`${activityLogs.details} ? 'mediaAssetId'`,
      )).orderBy(activityLogs.entityId, desc(activityLogs.id));
    for (const log of logs) {
      const details = log.details as { mediaAssetId?: unknown; after?: { image?: unknown } } | null;
      lastChoice.set(Number(log.entityId), { assetId: Number(details?.mediaAssetId), image: String(details?.after?.image ?? '').trim() });
    }
  }
  const markable: CoverRepairReport['markable'] = [];
  for (const itemId of uncovered) {
    const item = productOf.get(itemId);
    const choice = lastChoice.get(itemId);
    if (!item || !choice || !Number.isInteger(choice.assetId) || !item.image || choice.image !== item.image) continue;
    if (!photosOf.get(itemId)?.ids.has(choice.assetId)) continue;
    markable.push({ itemId, code: item.code, assetId: choice.assetId });
  }

  let markedNow = 0;
  const skipped: CoverRepairReport['skipped'] = [];
  if (options.apply) {
    for (const row of markable) {
      try {
        const marked = await orm.transaction(async (tx) => {
          const [locked] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, row.itemId), eq(items.isDeleted, 0))).for('update');
          if (!locked) return false;
          const [already] = await tx.select({ id: mediaAssets.id }).from(mediaAssets)
            .where(and(eq(mediaAssets.itemId, row.itemId), eq(mediaAssets.isCover, 1), eq(mediaAssets.isDeleted, 0))).limit(1);
          if (already) return false;
          await markItemCover(tx, row.assetId, row.itemId, REPAIR_ACTOR);
          return true;
        });
        if (marked) markedNow += 1;
        else skipped.push({ itemId: row.itemId, reason: 'item removed or covered meanwhile' });
      } catch (err) {
        // the code, not the (Persian) message: the terminal speaks English (AGENTS.md §1.8)
        skipped.push({ itemId: row.itemId, reason: String((err as { code?: unknown } | null)?.code ?? 'failed') });
      }
    }
  }
  return { withPhotosNoCover: uncovered.length, markable, markedNow, skipped, pictureOutsideLibrary };
}
