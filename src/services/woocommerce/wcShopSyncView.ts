import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { WC_LIST_LIMIT, type WcCatalogItem } from '../../lib/woocommerce/wcCatalog.js';
import { WC_AUTO_MAX_LINK_FAILURES } from '../../lib/woocommerce/wcAutoPush.js';
import type { WcDriftRow, WcFieldPushView, WcPriceSkipRow, WcShopSyncView } from '../../lib/woocommerce/wcShopSync.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import { autoRunCondition, liveLinks, runView } from './wcCatalog.service.js';
import { activeShopPriceList, isSkuRenameEnabled, renamedLinks, wantedSitePrices } from './wcFieldPush.service.js';
import { autoRunBackoff } from './wcRunBackoff.js';
import { lastSiteCurrency } from './wcSiteCurrency.js';

/** 10.2 package 6 (D-04 part C): what the WooCommerce tab shows about the price push, the SKU rename and the nightly re-read */
const liveLink = (...extra: SQL[]) => and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0), ...extra);

async function stoppedLinks(field: 'price' | 'sku') {
  const column = field === 'price' ? wcProductLinks.priceFailureCount : wcProductLinks.skuFailureCount;
  const error = field === 'price' ? wcProductLinks.priceError : wcProductLinks.skuError;
  const where = liveLink(gte(column, WC_AUTO_MAX_LINK_FAILURES));
  const rows = await orm.select({ itemId: items.id, code: items.code, name: items.name, error })
    .from(wcProductLinks).innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(where).orderBy(asc(items.code)).limit(WC_LIST_LIMIT);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(where);
  return { stopped: rows.map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '', error: r.error || undefined })), stoppedTotal: total };
}

async function fieldView(kind: 'price_push' | 'sku_push', enabled: boolean, stopped: { stopped: WcCatalogItem[]; stoppedTotal: number }): Promise<WcFieldPushView> {
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

/** The links whose price is not sent and why; without a shop currency read yet, only the reasons that do not depend on it */
async function skippedPrices(title: string, siteCurrency: string | null): Promise<{ skipped: WcPriceSkipRow[]; skippedTotal: number }> {
  if (!title) return { skipped: [], skippedTotal: 0 };
  const { skipped } = await wantedSitePrices(await liveLinks(), title, siteCurrency ?? '');
  const shown = siteCurrency ? skipped : skipped.filter(s => s.reason !== 'currency_mismatch' && s.reason !== 'not_positive');
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

export async function getShopSyncView(): Promise<WcShopSyncView> {
  const { stored, title } = await activeShopPriceList();
  const priceLists = await ItemPricingService.getPricingStrategies().catch(() => [] as string[]);
  const siteCurrency = lastSiteCurrency();
  const skuOn = await isSkuRenameEnabled();
  const [price, sku, skipped, pending, [nightly]] = await Promise.all([
    fieldView('price_push', title !== '', await stoppedLinks('price')),
    fieldView('sku_push', skuOn, await stoppedLinks('sku')),
    skippedPrices(title, siteCurrency),
    renamedLinks(),
    orm.select().from(wcSyncRuns).where(and(eq(wcSyncRuns.kind, 'refresh'), sql`${wcSyncRuns.summary}->>'trigger' = 'nightly'`))
      .orderBy(desc(wcSyncRuns.id)).limit(1),
  ]);
  const lastNightly = nightly ? runView(nightly) : null;
  const ok = lastNightly && lastNightly.status !== 'failed';
  return {
    // a stored list no longer configured is shown, so the tab can say the price push stopped
    priceList: title || stored,
    priceListMissing: stored !== '' && title === '',
    priceLists,
    siteCurrency,
    price: { ...price, ...skipped },
    sku: { ...sku, pending: pending.length },
    lastNightly,
    differences: ok && Array.isArray(lastNightly.summary.differences) ? lastNightly.summary.differences as WcDriftRow[] : [],
    differencesTotal: ok ? Number(lastNightly.summary.differencesTotal) || 0 : 0,
  };
}
