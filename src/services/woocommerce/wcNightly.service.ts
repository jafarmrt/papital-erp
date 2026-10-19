import { and, desc, eq, gt, or, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { getDisplayTimezone, systemNowUtcIso } from '../../lib/businessClock.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { isAutoPushOn, WC_AUTO_PUSH_SETTING_KEY } from '../../lib/woocommerce/wcAutoPush.js';
import { businessDayHour, nightlyDue, type NightlyAttempts } from '../../lib/woocommerce/wcShopSync.js';
import { readWcConnectionSettings } from './wcConnectionSettings.js';
import { requireWcConnection } from './wcClient.js';
import { liveLinks, refreshCatalogLocked, type WcRefreshSummary } from './wcCatalog.service.js';
import { activeShopPriceList, isSkuRenameEnabled, wantedSitePrices } from './wcFieldPush.service.js';
import { readSiteCurrency } from './wcSiteCurrency.js';

/**
 * 10.2 package 6 (D-04 part C, plan §5 «مقایسه شبانه»): once a business day, from `WC_NIGHTLY_HOUR` in the display time
 * zone, while any automatic send (stock, price or SKU) is on and the connection is complete, the shop's catalog is read
 * again under the `WOOCOMMERCE_SYNC` lock, like «بازخوانی محصولات سایت» but without an audit row: the links follow the
 * shop, each link's shop stock, price and type are read, and the run row lists the differences found (a stock or price
 * changed by hand in the shop). A stock difference is put right by the automatic stock push on its next run (the link's
 * shop stock changed, so it is compared again) and a price difference by the price push; nothing is sent here. A failed
 * reading is tried again at most `WC_NIGHTLY_MAX_ATTEMPTS` times that day, `WC_NIGHTLY_RETRY_MINUTES` apart, and a
 * successful one lets products stopped after repeated price or SKU refusals try again.
 */
export type NightlyState = 'off' | 'not_due' | 'busy' | 'read' | 'failed';

export async function anyAutoSendOn(): Promise<boolean> {
  const [auto] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WC_AUTO_PUSH_SETTING_KEY));
  if (isAutoPushOn(auto?.value)) return true;
  if ((await activeShopPriceList()).title !== '') return true;
  return isSkuRenameEnabled();
}

/** That business day's nightly readings so far */
async function nightlyAttempts(businessDay: string): Promise<NightlyAttempts> {
  const runs = await orm.select({ status: wcSyncRuns.status, finishedAt: wcSyncRuns.finishedAt }).from(wcSyncRuns)
    .where(and(eq(wcSyncRuns.kind, 'refresh'), sql`${wcSyncRuns.summary}->>'trigger' = 'nightly'`,
      sql`${wcSyncRuns.summary}->>'businessDay' = ${businessDay}`))
    .orderBy(desc(wcSyncRuns.id));
  const failed = runs.filter(r => r.status === 'failed');
  const lastFailed = failed[0]?.finishedAt ? new Date(serverTimestampToUtcIso(failed[0].finishedAt) ?? '').getTime() : NaN;
  return {
    succeeded: runs.some(r => r.status !== 'failed'),
    failed: failed.length,
    lastFailedAt: Number.isNaN(lastFailed) ? null : lastFailed,
  };
}

/** The price each linked item's product should have, read before the catalog so the run can list price differences */
async function wantedPricesForNightly(signal: AbortSignal): Promise<ReadonlyMap<number, string> | undefined> {
  const { title } = await activeShopPriceList();
  if (!title) return undefined;
  const currency = await readSiteCurrency(await requireWcConnection(), signal);
  return (await wantedSitePrices(await liveLinks(), title, currency)).wanted;
}

/** One check of the nightly re-read; `now` and `timeZone` are for the tests */
export async function runNightlyOnce(
  now: Date = new Date(), timeZone?: string,
): Promise<{ state: NightlyState; summary?: WcRefreshSummary }> {
  if (!(await anyAutoSendOn())) return { state: 'off' };
  const { url, consumerKey, consumerSecret } = await readWcConnectionSettings();
  if (!url || !consumerKey || !consumerSecret) return { state: 'off' };
  const { day, hour } = businessDayHour(now, timeZone ?? await getDisplayTimezone());
  if (!nightlyDue(hour, await nightlyAttempts(day), now.getTime())) return { state: 'not_due' };
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, async () => {
    // a second check under the lock: another process may have read the shop meanwhile
    if (!nightlyDue(hour, await nightlyAttempts(day), now.getTime())) return { state: 'not_due' as const };
    const prices = new AbortController();
    try {
      const wantedPrices = await wantedPricesForNightly(prices.signal).catch(() => undefined);
      const summary = await refreshCatalogLocked({}, undefined, { run: { nightly: { businessDay: day }, wantedPrices } });
      // products stopped after repeated price or SKU refusals try again after a reading of the shop
      await orm.update(wcProductLinks).set({ priceFailureCount: 0, skuFailureCount: 0, updatedAt: systemNowUtcIso() })
        .where(and(eq(wcProductLinks.isDeleted, 0), or(gt(wcProductLinks.priceFailureCount, 0), gt(wcProductLinks.skuFailureCount, 0))));
      return { state: 'read' as const, summary };
    } catch {
      // the failed run row (with its business day) was written by `refreshCatalogLocked`
      return { state: 'failed' as const };
    } finally {
      prices.abort();
    }
  });
  return outcome.acquired ? outcome.result : { state: 'busy' };
}
