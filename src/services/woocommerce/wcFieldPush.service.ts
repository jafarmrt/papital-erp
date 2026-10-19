import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { AppError, ValidationError } from '../../errors/customErrors.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { logger } from '../../middleware/logger.js';
import { priceListMatcher } from '../../lib/items/excelPriceColumns.js';
import { chunked, WC_LIST_LIMIT, WC_PUSH_DEADLINE_MS } from '../../lib/woocommerce/wcCatalog.js';
import { WC_AUTO_MAX_LINK_FAILURES, WC_AUTO_PUSH_MAX_PRODUCTS } from '../../lib/woocommerce/wcAutoPush.js';
import {
  isSkuRenameOn, isVariableParentType, sameSitePrice, sitePriceOf, WC_PRICE_LIST_SETTING_KEY, WC_SKU_RENAME_SETTING_KEY,
  type WcPriceSkipReason, type WcRunKind,
} from '../../lib/woocommerce/wcShopSync.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import { requireWcConnection } from './wcClient.js';
import { liveLinks, recordFailedRun, type WcActor } from './wcCatalog.service.js';
import { fieldRunStatus, sendLinkFields, type FieldOutcome } from './wcBatchUpdate.js';
import { updateLinkRows, type LinkRowUpdate } from './wcLinkUpdates.js';
import { autoRunBackoff } from './wcRunBackoff.js';
import { readSiteCurrency } from './wcSiteCurrency.js';

/**
 * 10.2 package 6 (D-04 part C). Two automatic runs beside the stock push, each behind its own setting (off by default),
 * once a minute after the stock push, one exchange with the shop at a time (`WOOCOMMERCE_SYNC`, a run that finds it taken
 * skips its turn):
 * - the price push: the active price of «فهرست قیمت فروشگاه» goes to each linked product's regular price in the shop's
 *   unit; only links whose stored shop price differs are sent, the sale price is never touched, a variable product (its
 *   prices are on its variations) and a link whose type was never read are left out, and a price in another currency than
 *   the shop's is not sent and is listed (plan ق۲ / ق۳);
 * - the SKU rename: a link whose shop SKU is an earlier code of its item (the code changed since, D-15) gets the item's
 *   current code (card ت۲۹).
 * As the stock push: at most `WC_AUTO_PUSH_MAX_PRODUCTS` a run (the rest on the next run, since only what still differs is
 * sent), a product the shop refused `WC_AUTO_MAX_LINK_FAILURES` times in a row stops until the nightly re-read lets it try
 * again, a run that failed for the shop waits 1, 2, 4 … 30 minutes, and only the first failure of a streak writes an
 * audit row; every run that sent something writes a run row with `trigger: 'auto'`.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

export type FieldRunState = 'off' | 'waiting' | 'busy' | 'nothing' | 'pushed' | 'failed';
export interface FieldRunResult { totalLinks: number; syncedCount: number; failedCount: number; skippedCount: number; errors: string[] }
export interface FieldRunOutcome { state: FieldRunState; result?: FieldRunResult }
export interface FieldRunOptions { maxProducts?: number }

export const WC_PRICE_LIST_NOT_CONFIGURED = 'WC_PRICE_LIST_NOT_CONFIGURED';
const SYSTEM_ACTOR: WcActor = {};
const AUDIT_ENTITY = 'فروشگاه اینترنتی';

async function settingValue(key: string): Promise<string> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return String(row?.value ?? '').trim();
}

/** The configured price list whose prices go to the shop, or '' (off, or a list no longer configured) */
export async function activeShopPriceList(): Promise<{ stored: string; title: string }> {
  const stored = await settingValue(WC_PRICE_LIST_SETTING_KEY);
  if (!stored) return { stored, title: '' };
  const title = priceListMatcher(await ItemPricingService.getPricingStrategies()).match(stored);
  return { stored, title: title ?? '' };
}

export async function isSkuRenameEnabled(): Promise<boolean> {
  return isSkuRenameOn(await settingValue(WC_SKU_RENAME_SETTING_KEY));
}

export interface WantedPrices {
  wanted: Map<number, string>;
  skipped: Array<{ itemId: number; reason: WcPriceSkipReason }>;
}

/** The regular price each link's product should have in the shop, or why none is sent */
export async function wantedSitePrices(links: Link[], priceList: string, siteCurrency: string): Promise<WantedPrices> {
  const latest = new Map<number, { price: string; currency: string }>();
  for (const part of chunked([...new Set(links.map(l => l.itemId))], 5000)) {
    const rows = await orm.select().from(itemPrices).where(and(inArray(itemPrices.itemId, part), eq(itemPrices.isDeleted, 0)));
    for (const p of ItemPricingService.filterActivePrices(rows, [priceList])) {
      latest.set(Number(p.itemId), { price: String(p.price ?? ''), currency: String(p.currency || 'IRR') });
    }
  }
  const wanted = new Map<number, string>();
  const skipped: WantedPrices['skipped'] = [];
  for (const link of links) {
    if (link.siteType === '') { skipped.push({ itemId: link.itemId, reason: 'not_read' }); continue; }
    if (isVariableParentType(link.siteType)) { skipped.push({ itemId: link.itemId, reason: 'variable_parent' }); continue; }
    const price = latest.get(link.itemId);
    const site = price ? sitePriceOf(price.price, price.currency, siteCurrency) : { skip: 'no_price' as const };
    if ('skip' in site) skipped.push({ itemId: link.itemId, reason: site.skip });
    else wanted.set(link.itemId, site.value);
  }
  return { wanted, skipped };
}

async function auditFailure(kind: WcRunKind, failedRunsBefore: number, message: string): Promise<void> {
  if (failedRunsBefore > 0) return;
  const what = kind === 'price_push' ? 'ارسال خودکار قیمت' : 'تغییر خودکار کد';
  try {
    await orm.transaction(tx => logActivity({
      tx, action: kind === 'price_push' ? 'WC_PRICE_PUSH' : 'WC_SKU_PUSH', entity: AUDIT_ENTITY,
      entityId: kind === 'price_push' ? WC_PRICE_LIST_SETTING_KEY : WC_SKU_RENAME_SETTING_KEY,
      description: `${what} به سایت ناموفق بود: ${message.slice(0, 300)}`, details: { trigger: 'auto', failed: true },
    }));
  } catch (err) {
    logger.warn(`[WooCommerce ${kind}] failure not audited: ${err instanceof Error ? err.name : 'unknown error'}`);
  }
}

interface Planned { link: Link; fields: Record<string, unknown>; values: LinkRowUpdate['values'] }

/** Sends what the run planned and records the outcomes on the links and one run row, in one transaction */
async function sendAndRecord(
  kind: 'price_push' | 'sku_push', plan: Planned[], totalLinks: number, extra: Record<string, unknown>, signal: AbortSignal,
  sentDetails?: (outcomes: Array<FieldOutcome<Link>>, plan: Planned[]) => Record<string, unknown>,
): Promise<{ result: FieldRunResult; status: 'ok' | 'partial' | 'failed' }> {
  const conn = await requireWcConnection();
  const outcomes: Array<FieldOutcome<Link>> = await sendLinkFields(conn, plan.map(p => ({ link: p.link, fields: p.fields })), signal);
  const valuesOf = new Map(plan.map(p => [p.link.id, p.values]));
  const failed = outcomes.filter(o => o.error);
  const errors = failed.map(o => `${o.link.siteSku || `#${o.link.wcProductId}`}: ${o.error}`);
  const result: FieldRunResult = {
    totalLinks, syncedCount: outcomes.length - failed.length, failedCount: failed.length, skippedCount: totalLinks - plan.length,
    errors: errors.slice(0, WC_LIST_LIMIT),
  };
  const status = fieldRunStatus(outcomes);
  const now = systemNowUtcIso();
  await orm.transaction(async (tx) => {
    await updateLinkRows(tx, outcomes.map(o => {
      if (!o.error) return { id: o.link.id, values: valuesOf.get(o.link.id) ?? {} };
      // a request that failed for the shop never counts against the product
      const count = kind === 'price_push' ? o.link.priceFailureCount : o.link.skuFailureCount;
      const next = o.requestFailed ? count : count + 1;
      return { id: o.link.id, values: kind === 'price_push'
        ? { priceError: o.error, priceFailureCount: next } : { skuError: o.error, skuFailureCount: next } };
    }), now);
    await tx.insert(wcSyncRuns).values({
      kind, status, startedAt: now, finishedAt: now,
      summary: { trigger: 'auto', ...extra, ...(sentDetails ? sentDetails(outcomes, plan) : {}), totalLinks, syncedCount: result.syncedCount, failedCount: result.failedCount,
        skippedCount: result.skippedCount, errors: errors.slice(0, 20) },
    });
  });
  return { result, status };
}

/** One run of a kind: the setting, the backoff, the lock, then the run, whose error becomes a failed run row */
async function runField(
  kind: 'price_push' | 'sku_push', enabled: () => Promise<boolean>, now: Date,
  locked: (signal: AbortSignal) => Promise<FieldRunOutcome>,
): Promise<FieldRunOutcome> {
  if (!(await enabled())) return { state: 'off' };
  const { failedRuns, nextAttemptAt } = await autoRunBackoff(kind);
  if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) return { state: 'waiting' };
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, async () => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), WC_PUSH_DEADLINE_MS);
    try {
      const run = await locked(deadline.signal);
      if (run.state === 'failed') await auditFailure(kind, failedRuns, run.result?.errors[0] ?? '');
      return run;
    } catch (err) {
      await recordFailedRun(kind, SYSTEM_ACTOR, err, { trigger: 'auto' });
      await auditFailure(kind, failedRuns, err instanceof AppError && err.statusCode < 500 ? err.message : 'ارتباط با سایت ناموفق بود.');
      return { state: 'failed' as const };
    } finally {
      clearTimeout(timer);
      deadline.abort();
    }
  });
  return outcome.acquired ? outcome.result : { state: 'busy' };
}

function outcomeOf(sent: { result: FieldRunResult; status: 'ok' | 'partial' | 'failed' }): FieldRunOutcome {
  return { state: sent.status === 'failed' ? 'failed' : 'pushed', result: sent.result };
}

/** The links whose shop price differs from the price list's, with the price each gets */
async function planPrices(links: Link[], title: string, siteCurrency: string, options: FieldRunOptions): Promise<Planned[]> {
  const { wanted } = await wantedSitePrices(links, title, siteCurrency);
  const differing = links.filter(l => wanted.has(l.itemId) && !sameSitePrice(l.siteRegularPrice, wanted.get(l.itemId) ?? ''));
  return differing.slice(0, options.maxProducts ?? WC_AUTO_PUSH_MAX_PRODUCTS).map((link) => {
    const value = wanted.get(link.itemId) ?? '';
    return { link, fields: { regular_price: value }, values: { siteRegularPrice: value, priceError: '', priceFailureCount: 0 } };
  });
}

/** review M-2: the prices a run changed, ids and numbers only (no name or code), the first `WC_PRICE_CHANGES_KEPT` */
export const WC_PRICE_CHANGES_KEPT = 200;
function priceChanges(sent: Array<FieldOutcome<Link>>, plan: Planned[]): Record<string, unknown> {
  const toOf = new Map(plan.map(p => [p.link.id, String(p.fields.regular_price ?? '')]));
  const done = sent.filter(o => !o.error);
  return {
    changed: done.slice(0, WC_PRICE_CHANGES_KEPT).map(o => ({
      productId: o.link.wcProductId, variationId: o.link.wcVariationId, from: o.link.siteRegularPrice || null, to: toOf.get(o.link.id) ?? null,
    })),
    changedTotal: done.length,
  };
}

/** One automatic price run */
export function runPricePushOnce(now: Date = new Date(), options: FieldRunOptions = {}): Promise<FieldRunOutcome> {
  return runField('price_push', async () => (await activeShopPriceList()).title !== '', now, async (signal) => {
    const { title } = await activeShopPriceList();
    if (!title) return { state: 'off' };
    const links = (await liveLinks()).filter(l => l.priceFailureCount < WC_AUTO_MAX_LINK_FAILURES);
    if (links.length === 0) return { state: 'nothing' };
    const conn = await requireWcConnection();
    let siteCurrency = await readSiteCurrency(conn, signal);
    let plan = await planPrices(links, title, siteCurrency, options);
    if (plan.length > 0) {
      // review M-1: before anything is sent, the shop currency is read again, so a shop switched between toman and rial
      // within the cache window never gets a price in the old unit
      const current = await readSiteCurrency(conn, signal, { fresh: true });
      if (current !== siteCurrency) {
        siteCurrency = current;
        plan = await planPrices(links, title, siteCurrency, options);
      }
    }
    if (plan.length === 0) return { state: 'nothing' };
    return outcomeOf(await sendAndRecord('price_push', plan, links.length, { priceList: title, siteCurrency }, signal, priceChanges));
  });
}

/** Live links whose shop SKU is not their item's current code (the code changed since the link was read) */
export async function renamedLinks(): Promise<Array<{ link: Link; code: string }>> {
  const code = sql<string>`btrim(coalesce(${items.code}, ''))`;
  const rows = await orm.select({ link: wcProductLinks, code }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(and(
      eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0), sql`${code} <> ''`, sql`${code} <> ${wcProductLinks.siteSku}`,
      lt(wcProductLinks.skuFailureCount, WC_AUTO_MAX_LINK_FAILURES),
    ))
    .orderBy(asc(wcProductLinks.id));
  return rows;
}

/** One automatic SKU run */
export function runSkuRenameOnce(now: Date = new Date(), options: FieldRunOptions = {}): Promise<FieldRunOutcome> {
  return runField('sku_push', () => isSkuRenameEnabled(), now, async (signal) => {
    const due = await renamedLinks();
    if (due.length === 0) return { state: 'nothing' };
    const plan = due.slice(0, options.maxProducts ?? WC_AUTO_PUSH_MAX_PRODUCTS).map(({ link, code }) => ({
      link, fields: { sku: code }, values: { siteSku: code, skuError: '', skuFailureCount: 0 },
    }));
    const renamed = plan.slice(0, 20).map(p => ({ from: p.link.siteSku, to: String(p.fields.sku) }));
    return outcomeOf(await sendAndRecord('sku_push', plan, due.length, { renamed }, signal));
  });
}

/**
 * Writes a send setting under its row lock with its audit row in the same transaction; a value equal to the stored one
 * changes nothing (false)
 */
async function writeSetting(
  actor: WcActor, key: string, value: string, describe: (before: string) => { text: string; before: unknown; after: unknown },
): Promise<boolean> {
  const changed = await orm.transaction(async (tx) => {
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).for('update');
    const stored = String(row?.value ?? '').trim();
    if (stored === value || (value === '0' && stored === '')) return false;
    // turning a send on needs a complete connection, so the switch never shows «on» for a shop it cannot reach
    if (value !== '' && value !== '0') await requireWcConnection(tx);
    await tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
    const { text, before, after } = describe(stored);
    await logActivity({
      tx, req: actor.req, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: key, description: text,
      details: { before, after, changes: { [key]: { before, after } } },
    });
    return true;
  });
  if (changed) invalidateSettingsCache();
  return changed;
}

/** «فهرست قیمت فروشگاه» (`POST /woocommerce/price-list`): a configured price list, or '' to stop sending prices */
export async function setShopPriceList(actor: WcActor, requested: string): Promise<{ priceList: string; changed: boolean; notRead: number }> {
  const wantedTitle = requested.trim();
  const title = wantedTitle ? priceListMatcher(await ItemPricingService.getPricingStrategies()).match(wantedTitle) : '';
  if (title === null) {
    throw new ValidationError(`فهرست قیمت «${wantedTitle}» در تنظیمات قیمت‌گذاری نیست.`, undefined, WC_PRICE_LIST_NOT_CONFIGURED);
  }
  const changed = await writeSetting(actor, WC_PRICE_LIST_SETTING_KEY, title, before => ({
    text: title ? `قیمت فهرست «${title}» از این پس به سایت فرستاده می‌شود` : 'ارسال خودکار قیمت به سایت خاموش شد',
    before: { priceList: before }, after: { priceList: title },
  }));
  const [{ notRead }] = await orm.select({ notRead: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0), eq(wcProductLinks.siteType, '')));
  return { priceList: title, changed, notRead };
}

/** «تغییر خودکار کد در سایت» (`POST /woocommerce/sku-rename` with the target state) */
export async function setSkuRename(actor: WcActor, enabled: boolean): Promise<{ enabled: boolean; changed: boolean }> {
  const changed = await writeSetting(actor, WC_SKU_RENAME_SETTING_KEY, enabled ? '1' : '0', before => ({
    text: enabled ? 'تغییر خودکار کد محصولات سایت روشن شد' : 'تغییر خودکار کد محصولات سایت خاموش شد',
    before: { enabled: isSkuRenameOn(before) }, after: { enabled },
  }));
  return { enabled, changed };
}
