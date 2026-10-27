import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { WC_LIST_LIMIT, type WcCatalogItem } from '../../lib/woocommerce/wcCatalog.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';
import type { WcDriftRow, WcFieldPushView, WcPriceSkipRow, WcShopSyncView, WcSiteMoney } from '../../lib/woocommerce/wcShopSync.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import { autoRunCondition, liveLinks, runView } from './wcCatalog.service.js';
import { activeShopPriceList, isSkuRenameEnabled, renamedLinks, wantedSitePrices, type FieldKind } from './wcFieldPush.service.js';
import { imagePushSettings, imageSteps } from './wcImagePush.service.js';
import { collectionSteps, isCollectionPushEnabled, sentTagIds } from './wcCollectionPush.service.js';
import type { WcCollectionPushView, WcImagePushView } from '../../lib/woocommerce/wcMediaPush.js';
import { autoRunBackoff } from './wcRunBackoff.js';
import { lastSiteMoney } from './wcSiteCurrency.js';

/** 10.2 package 6 (D-04 part C): what the WooCommerce tab shows about the price push, the SKU rename and the nightly re-read */
const liveLink = (...extra: SQL[]) => and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0), ...extra);

const FAILURE_COLUMNS = {
  price: [wcProductLinks.priceFailureCount, wcProductLinks.priceError],
  sku: [wcProductLinks.skuFailureCount, wcProductLinks.skuError],
  image: [wcProductLinks.imageFailureCount, wcProductLinks.imageError],
  collection: [wcProductLinks.collectionFailureCount, wcProductLinks.collectionError],
} as const;

async function stoppedLinks(field: keyof typeof FAILURE_COLUMNS) {
  const [column, error] = FAILURE_COLUMNS[field];
  const where = liveLink(gte(column, WC_AUTO_MAX_LINK_FAILURES));
  const rows = await orm.select({ itemId: items.id, code: items.code, name: items.name, error })
    .from(wcProductLinks).innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(where).orderBy(asc(items.code)).limit(WC_LIST_LIMIT);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(where);
  return { stopped: rows.map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '', error: r.error || undefined })), stoppedTotal: total };
}

async function fieldView(kind: FieldKind, enabled: boolean, stopped: { stopped: WcCatalogItem[]; stoppedTotal: number }): Promise<WcFieldPushView> {
  const [[last], backoff] = await Promise.all([
    orm.select().from(wcSyncRuns).where(and(eq(wcSyncRuns.kind, kind), autoRunCondition)).orderBy(desc(wcSyncRuns.id)).limit(1),
    autoRunBackoff(kind),
  ]);
  return {
    enabled,
    lastRun: last ? runView(last) : null,
    failedRuns: backoff.failedRuns,
    nextAttemptAt: backoff.nextAttemptAt && backoff.nextAttemptAt.getTime() > Date.now() ? backoff.nextAttemptAt.toISOString() : null,
    ...stopped,
  };
}

/** The reasons that depend on the shop's currency and decimals, left out while they are unknown */
const MONEY_REASONS = new Set(['currency_mismatch', 'not_positive', 'inexact_unit']);

/** The links whose price is not sent and why; without the shop money read yet, only the reasons that do not depend on it */
async function skippedPrices(title: string, site: WcSiteMoney | null): Promise<{ skipped: WcPriceSkipRow[]; skippedTotal: number }> {
  if (!title) return { skipped: [], skippedTotal: 0 };
  const { skipped } = await wantedSitePrices(await liveLinks(), title, site ?? { currency: '', decimals: 0 });
  const shown = site ? skipped : skipped.filter(s => !MONEY_REASONS.has(s.reason));
  const first = shown.slice(0, WC_LIST_LIMIT);
  const named = first.length === 0 ? [] : await orm.select({ id: items.id, code: items.code, name: items.name }).from(items)
    .where(inArray(items.id, first.map(s => s.itemId)));
  const byId = new Map(named.map(r => [r.id, r]));
  return {
    skipped: first.map(s => ({ itemId: s.itemId, code: byId.get(s.itemId)?.code ?? '', name: byId.get(s.itemId)?.name ?? '', reason: s.reason }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    skippedTotal: shown.length,
  };
}

/**
 * The shop money read last: in memory, else (after a restart) the currency and decimals the last price run recorded, so
 * the products a price that is not exact in the shop's unit or is in another currency leaves out are listed before the
 * next run (reviews H-1 / M-A)
 */
async function knownSiteMoney(): Promise<WcSiteMoney | null> {
  const inMemory = lastSiteMoney();
  if (inMemory) return inMemory;
  const currency = sql<string>`${wcSyncRuns.summary}->>'siteCurrency'`;
  const decimals = sql<string>`${wcSyncRuns.summary}->>'siteDecimals'`;
  const [row] = await orm.select({ currency, decimals }).from(wcSyncRuns)
    .where(and(eq(wcSyncRuns.kind, 'price_push'), sql`coalesce(${currency}, '') <> ''`, sql`coalesce(${decimals}, '') ~ '^[0-9]+$'`))
    .orderBy(desc(wcSyncRuns.id)).limit(1);
  return row?.currency ? { currency: String(row.currency), decimals: Number(row.decimals) } : null;
}

/** v11 phase 6.5 (part D): the image push's and the collection push's lines of the tab */
async function mediaViews(): Promise<{ image: WcImagePushView; collection: WcCollectionPushView }> {
  const settings = await imagePushSettings();
  const [steps, collections, collectionOn] = await Promise.all([imageSteps(), collectionSteps(), isCollectionPushEnabled()]);
  const [image, collection] = await Promise.all([
    fieldView('image_push', settings.enabled, await stoppedLinks('image')),
    fieldView('collection_push', collectionOn, await stoppedLinks('collection')),
  ]);
  return {
    image: {
      ...image, baseUrl: settings.baseUrl, secretsReady: settings.secretsReady,
      pending: steps.filter(s => s.step !== null && 'send' in s.step).length,
      notRead: steps.filter(s => s.link.siteImageId === null && s.link.coverSentSha256 === '').length,
    },
    collection: {
      ...collection, pending: collections.filter(s => s.key !== '' || sentTagIds(s.link.sentTagIds).length > 0).length,
    },
  };
}

export async function getShopSyncView(): Promise<WcShopSyncView> {
  const { stored, title } = await activeShopPriceList();
  const priceLists = await ItemPricingService.getPricingStrategies().catch(() => [] as string[]);
  const site = await knownSiteMoney();
  const skuOn = await isSkuRenameEnabled();
  const [price, sku, skipped, pending, [nightly], media] = await Promise.all([
    fieldView('price_push', title !== '', await stoppedLinks('price')),
    fieldView('sku_push', skuOn, await stoppedLinks('sku')),
    skippedPrices(title, site),
    renamedLinks(),
    orm.select().from(wcSyncRuns).where(and(eq(wcSyncRuns.kind, 'refresh'), sql`${wcSyncRuns.summary}->>'trigger' = 'nightly'`))
      .orderBy(desc(wcSyncRuns.id)).limit(1),
    mediaViews(),
  ]);
  const lastNightly = nightly ? runView(nightly) : null;
  const ok = lastNightly && lastNightly.status !== 'failed';
  return {
    // a stored list no longer configured is shown, so the tab can say the price push stopped
    priceList: title || stored,
    priceListMissing: stored !== '' && title === '',
    priceLists,
    siteCurrency: site?.currency ?? null,
    siteDecimals: site?.decimals ?? null,
    price: { ...price, ...skipped },
    sku: { ...sku, pending: pending.length },
    ...media,
    lastNightly,
    differencesCurrency: ok && typeof lastNightly.summary.siteCurrency === 'string' ? lastNightly.summary.siteCurrency : null,
    differences: ok && Array.isArray(lastNightly.summary.differences) ? lastNightly.summary.differences as WcDriftRow[] : [],
    differencesTotal: ok ? Number(lastNightly.summary.differencesTotal) || 0 : 0,
  };
}
