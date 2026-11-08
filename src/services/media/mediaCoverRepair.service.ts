import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { activityLogs, items, mediaAssets } from '../../db/schema.js';
import { markItemCover } from './mediaArrange.service.js';
import { ITEM_AUDIT_ENTITY } from './mediaProducts.service.js';

/**
 * v12 phase 7 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §4): from v10.1.71 to v12 «تصویر شاخص محصول شود» set the item's
 * picture but not the library cover mark the site and the WooCommerce push read. This manual repair (never at boot, AGENTS.md
 * §4.9 style: dry run first) finds each item with library photos and no cover, and when the item's audit trail says which
 * library file its current picture came from (the «کالا» row with `mediaAssetId` whose `after.image` is still the item's
 * image), marks that file as the cover through the same path as the button, with its audit rows. It also lists items whose
 * picture is outside the library, which the site cannot show until a photo is uploaded to the library.
 */
export interface CoverRepairReport {
  withPhotosNoCover: number;
  markable: Array<{ itemId: number; code: string; assetId: number }>;
  markedNow: number;
  pictureOutsideLibrary: Array<{ itemId: number; code: string }>;
}

const REPAIR_ACTOR = { username: 'cover-repair' } as const;

export async function repairItemCovers(options: { apply: boolean }): Promise<CoverRepairReport> {
  const photoRows = await orm.select({ itemId: mediaAssets.itemId, id: mediaAssets.id, isCover: mediaAssets.isCover })
    .from(mediaAssets).where(and(isNotNull(mediaAssets.itemId), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  const photosOf = new Map<number, { ids: Set<number>; covered: boolean }>();
  for (const row of photoRows) {
    const entry = photosOf.get(Number(row.itemId)) ?? { ids: new Set<number>(), covered: false };
    entry.ids.add(row.id);
    if (row.isCover === 1) entry.covered = true;
    photosOf.set(Number(row.itemId), entry);
  }
  const uncovered = [...photosOf].filter(([, e]) => !e.covered).map(([itemId]) => itemId);

  const live = await orm.select({ id: items.id, code: items.code, image: items.image }).from(items)
    .where(and(eq(items.isDeleted, 0), sql`coalesce(btrim(${items.image}), '') <> ''`));
  const pictureOutsideLibrary = live.filter(i => !photosOf.has(i.id)).map(i => ({ itemId: i.id, code: i.code }));
  const imageOf = new Map(live.map(i => [i.id, { code: i.code, image: String(i.image ?? '').trim() }]));

  const markable: CoverRepairReport['markable'] = [];
  for (const itemId of uncovered) {
    const item = imageOf.get(itemId);
    if (!item) continue;
    const [log] = await orm.select({ details: activityLogs.details }).from(activityLogs).where(and(
      eq(activityLogs.entity, ITEM_AUDIT_ENTITY), eq(activityLogs.entityId, String(itemId)), sql`${activityLogs.details} ? 'mediaAssetId'`,
    )).orderBy(desc(activityLogs.id)).limit(1);
    const details = log?.details as { mediaAssetId?: unknown; after?: { image?: unknown } } | undefined;
    const assetId = Number(details?.mediaAssetId);
    if (!Number.isInteger(assetId) || String(details?.after?.image ?? '').trim() !== item.image) continue;
    if (!photosOf.get(itemId)?.ids.has(assetId)) continue;
    markable.push({ itemId, code: item.code, assetId });
  }

  let markedNow = 0;
  if (options.apply) {
    for (const row of markable) {
      await orm.transaction(async (tx) => {
        const [locked] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, row.itemId), eq(items.isDeleted, 0))).for('update');
        if (!locked) return;
        const [already] = await tx.select({ id: mediaAssets.id }).from(mediaAssets)
          .where(and(inArray(mediaAssets.itemId, [row.itemId]), eq(mediaAssets.isCover, 1), eq(mediaAssets.isDeleted, 0))).limit(1);
        if (already) return;
        await markItemCover(tx, row.assetId, row.itemId, REPAIR_ACTOR);
        markedNow += 1;
      });
    }
  }
  return { withPhotosNoCover: uncovered.length, markable, markedNow, pictureOutsideLibrary };
}
