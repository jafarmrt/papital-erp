import { and, asc, desc, eq, gte, ne, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, items, wcProductLinks, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { AppError } from '../../errors/customErrors.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { logger } from '../../middleware/logger.js';
import { WC_LIST_LIMIT, WC_PUSH_DEADLINE_MS, type WcCatalogItem } from '../../lib/woocommerce/wcCatalog.js';
import {
  autoPushBackoffMinutes, isAutoPushOn, WC_AUTO_FULL_PASS_MS, WC_AUTO_MAX_LINK_FAILURES, WC_AUTO_PUSH_INTERVAL_MS,
  WC_AUTO_PUSH_MAX_PRODUCTS, WC_AUTO_PUSH_SETTING_KEY, type WcAutoPushView,
} from '../../lib/woocommerce/wcAutoPush.js';
import { requireWcConnection } from './wcClient.js';
import { autoRunCondition, liveLinks, recordFailedRun, runView, type WcActor } from './wcCatalog.service.js';
import { readOpenOrders } from './wcOpenOrders.js';
import { forgetDueMarks, isMarkedDue, markLinksDue, restoreDueMarks, takeDueMarks } from './wcAutoPushDue.js';
import { recordOutcomes, sendStocks, siteStocks, type WcStockPushResult } from './wcStockPush.service.js';

/**
 * 10.2 package 6 (D-04 part B): «ارسال خودکار موجودی». Once a minute, while the setting `wc_auto_push` is on (off by
 * default, `woocommerce.manage`), the worker compares each linked product's sellable stock in the shop warehouse with what
 * it last sent, and only when something changed reads the shop's open orders and sends, in batches of 100, the stock of the
 * products whose number moved (sellable less open orders, plan question ق۶). It runs after the stock write has committed and
 * never inside it, so a shop that is slow or down never delays or refuses a document. Only products whose stock tracking is
 * already on in the shop are sent (no `manage_stock` field), a link that failed `WC_AUTO_MAX_LINK_FAILURES` times in a row
 * is left out until a manual push succeeds, at most `WC_AUTO_PUSH_MAX_PRODUCTS` go in one run, and a run that failed for
 * the shop (not for one refused product) waits 1, 2, 4 … 30 minutes before the next. The products an order webhook names
 * are compared on the next run whatever moved, and once an hour (and first after a start) every tracked link is (review
 * M-3), so an order that came between an earlier run's order reading and its push, a refund or a cancellation is put
 * right; a stock changed by hand in the shop is put right only by the nightly catalog refresh (TD-1294 part C). One
 * exchange with the shop at a time: a run that finds the `WOOCOMMERCE_SYNC` lock taken skips its turn.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

export type AutoPushState = 'off' | 'waiting' | 'busy' | 'nothing' | 'pushed' | 'failed';
export interface AutoPushOutcome { state: AutoPushState; result?: WcStockPushResult }

const SYSTEM_ACTOR: WcActor = {};

/**
 * The sellable stock each link was last brought in line with, and the shop stock it left: a link is due again only when its
 * sellable stock moved since. Held in memory (one server process, AGENTS §22); after a restart, or once the link's shop
 * stock changes (a manual push or a catalog refresh read another number), the link is compared with its shop stock instead
 */
const settled = new Map<number, { sellable: number; siteStock: number | null }>();
/** When the last hourly pass over every tracked link read the shop's orders (0 after a start: the first run is one) */
let lastFullPassAt = 0;

/** test hook: forget what was settled, the hourly pass and the marks, as after a restart */
export function forgetSettledLinks(): void {
  settled.clear();
  lastFullPassAt = 0;
  forgetDueMarks();
}

function isDue(link: Link, sellable: number): boolean {
  const last = settled.get(link.id);
  if (last && last.siteStock === link.siteStock) return sellable !== last.sellable;
  return sellable !== link.siteStock;
}

export async function isAutoPushEnabled(): Promise<boolean> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WC_AUTO_PUSH_SETTING_KEY));
  return isAutoPushOn(row?.value);
}

const autoLinkWhere = (...extra: SQL[]) => and(eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0), ...extra);

/** Automatic runs that failed in a row, newest first, and when the next one may run */
async function backoffState(): Promise<{ failedRuns: number; nextAttemptAt: Date | null }> {
  const runs = await orm.select({ status: wcSyncRuns.status, finishedAt: wcSyncRuns.finishedAt }).from(wcSyncRuns)
    .where(and(eq(wcSyncRuns.kind, 'stock_push'), autoRunCondition)).orderBy(desc(wcSyncRuns.id)).limit(10);
  let failedRuns = 0;
  while (failedRuns < runs.length && runs[failedRuns].status === 'failed') failedRuns++;
  if (failedRuns === 0 || !runs[0].finishedAt) return { failedRuns, nextAttemptAt: null };
  const last = new Date(serverTimestampToUtcIso(runs[0].finishedAt) ?? '');
  if (Number.isNaN(last.getTime())) return { failedRuns, nextAttemptAt: null };
  return { failedRuns, nextAttemptAt: new Date(last.getTime() + autoPushBackoffMinutes(failedRuns) * 60_000) };
}

export interface AutoPushRunOptions {
  /** the most products one run sends (`WC_AUTO_PUSH_MAX_PRODUCTS`; a test passes a small cap) */
  maxProducts?: number;
}

/**
 * An automatic failure's audit row (review c): only the first failure of a streak, so a shop that stays down writes one
 * row, not one per attempt; the run rows keep every attempt
 */
async function auditFailure(failedRunsBefore: number, message: string): Promise<void> {
  if (failedRunsBefore > 0) return;
  try {
    await orm.transaction(tx => logActivity({
      tx, action: 'WC_STOCK_PUSH', entity: 'فروشگاه اینترنتی', entityId: WC_AUTO_PUSH_SETTING_KEY,
      description: `ارسال خودکار موجودی به سایت ناموفق بود: ${message.slice(0, 300)}`,
      details: { trigger: 'auto', failed: true },
    }));
  } catch (err) {
    logger.warn(`[WooCommerce auto push] failure not audited: ${err instanceof Error ? err.name : 'unknown error'}`);
  }
}

/** One automatic run, for a caller holding the `WOOCOMMERCE_SYNC` lock */
async function autoPushLocked(failedRunsBefore: number, options: AutoPushRunOptions, now: number): Promise<AutoPushOutcome> {
  const maxProducts = options.maxProducts ?? WC_AUTO_PUSH_MAX_PRODUCTS;
  const marks = takeDueMarks();
  const all = await liveLinks();
  const tracked = all.filter(l => l.siteManageStock === 1 && l.failureCount < WC_AUTO_MAX_LINK_FAILURES);
  if (tracked.length === 0) return { state: 'nothing' };
  // review M-3: once an hour every tracked link is compared, whatever moved (an order that arrived between the order
  // reading and the push of an earlier run, a refund or a cancellation the program did not follow)
  const fullPass = now - lastFullPassAt >= WC_AUTO_FULL_PASS_MS;
  const itemIds = [...new Set(tracked.map(l => l.itemId))];
  // a first look without the shop: nothing moved and nothing marked, nothing is asked of the shop
  const before = await siteStocks(itemIds, [], all);
  const due = fullPass ? tracked
    : tracked.filter(l => isMarkedDue(marks, l) || isDue(l, before.sellable.get(l.itemId) ?? 0));
  if (due.length === 0) return { state: 'nothing' };

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), WC_PUSH_DEADLINE_MS);
  try {
    const conn = await requireWcConnection();
    const orders = await readOpenOrders(conn, deadline.signal);
    const dueItems = [...new Set(due.map(l => l.itemId))];
    const { sellable, wanted } = await siteStocks(dueItems, orders, all);
    if (fullPass) lastFullPassAt = now;
    const rows = due.map(link => ({ link, quantity: wanted.get(link.itemId) ?? 0, sellable: sellable.get(link.itemId) ?? 0 }));
    // a link whose shop stock is already right is settled without a request (an open order the shop already took off)
    for (const r of rows.filter(x => x.quantity === x.link.siteStock)) settled.set(r.link.id, { sellable: r.sellable, siteStock: r.link.siteStock });
    const differing = rows.filter(r => r.quantity !== r.link.siteStock);
    const toSend = differing.slice(0, maxProducts);
    // the rest go on the next run, whatever their sellable stock does meanwhile
    markLinksDue(differing.slice(maxProducts).map(r => r.link.id));
    if (toSend.length === 0) return { state: 'nothing' };
    const outcomes = await sendStocks(conn, toSend, { signal: deadline.signal, setManageStock: false });
    const result = await recordOutcomes(outcomes, tracked.length - toSend.length, tracked.length, SYSTEM_ACTOR, 'auto');
    const sellableOf = new Map(toSend.map(r => [r.link.id, r.sellable]));
    for (const o of outcomes.filter(x => !x.error)) settled.set(o.link.id, { sellable: sellableOf.get(o.link.id) ?? 0, siteStock: o.quantity });
    // a product the shop refused is tried again on each run until it stops (`WC_AUTO_MAX_LINK_FAILURES`); one the request
    // never reached goes on the next run even when it was due only for the hourly pass
    markLinksDue(outcomes.filter(o => o.error && o.requestFailed).map(o => o.link.id));
    if (result.status === 'failed') await auditFailure(failedRunsBefore, result.errors[0] ?? '');
    return { state: result.status === 'failed' ? 'failed' : 'pushed', result };
  } catch (err) {
    restoreDueMarks(marks);
    await recordFailedRun('stock_push', SYSTEM_ACTOR, err, { trigger: 'auto' });
    await auditFailure(failedRunsBefore, err instanceof AppError && err.statusCode < 500 ? err.message : 'ارتباط با سایت ناموفق بود.');
    return { state: 'failed' };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}

/** One automatic run: off, waiting after failures, the lock taken by another exchange, or the run itself */
export async function runAutoPushOnce(now: Date = new Date(), options: AutoPushRunOptions = {}): Promise<AutoPushOutcome> {
  if (!(await isAutoPushEnabled())) return { state: 'off' };
  const { failedRuns, nextAttemptAt } = await backoffState();
  if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) return { state: 'waiting' };
  const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WOOCOMMERCE_SYNC, () => autoPushLocked(failedRuns, options, now.getTime()));
  return outcome.acquired ? outcome.result : { state: 'busy' };
}

/** Turns the automatic push on or off (`POST /woocommerce/auto-push`), with its audit row in the same transaction */
export async function setAutoPush(actor: WcActor, enabled: boolean): Promise<{ enabled: boolean; changed: boolean }> {
  const result = await orm.transaction(async (tx) => {
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings)
      .where(eq(appSettings.key, WC_AUTO_PUSH_SETTING_KEY)).for('update');
    const before = isAutoPushOn(row?.value);
    if (before === enabled) return { enabled, changed: false };
    // turning it on needs a complete connection, so the switch never shows «on» for a shop it cannot reach
    if (enabled) await requireWcConnection(tx);
    await tx.insert(appSettings).values({ key: WC_AUTO_PUSH_SETTING_KEY, value: enabled ? '1' : '0' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: enabled ? '1' : '0' } });
    await logActivity({
      tx, req: actor.req, action: 'UPDATE', entity: 'فروشگاه اینترنتی', entityId: WC_AUTO_PUSH_SETTING_KEY,
      description: enabled ? 'ارسال خودکار موجودی به سایت روشن شد' : 'ارسال خودکار موجودی به سایت خاموش شد',
      details: { before: { enabled: before }, after: { enabled }, changes: { enabled: { before, after: enabled } } },
    });
    return { enabled, changed: true };
  });
  invalidateSettingsCache();
  return result;
}

async function linkItems(where: SQL | undefined): Promise<{ rows: WcCatalogItem[]; total: number }> {
  const rows = await orm.select({ itemId: items.id, code: items.code, name: items.name, error: wcProductLinks.lastError })
    .from(wcProductLinks).innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(where).orderBy(asc(items.code)).limit(WC_LIST_LIMIT);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId)).where(where);
  return { rows: rows.map(r => ({ itemId: r.itemId, code: r.code ?? '', name: r.name ?? '', error: r.error || undefined })), total };
}

/** What the WooCommerce tab shows about the automatic push */
export async function getAutoPushView(): Promise<WcAutoPushView> {
  const [enabled, backoff, [last]] = await Promise.all([
    isAutoPushEnabled(),
    backoffState(),
    orm.select().from(wcSyncRuns).where(and(eq(wcSyncRuns.kind, 'stock_push'), autoRunCondition)).orderBy(desc(wcSyncRuns.id)).limit(1),
  ]);
  const untracked = await linkItems(autoLinkWhere(ne(wcProductLinks.siteManageStock, 1)));
  const stopped = await linkItems(autoLinkWhere(eq(wcProductLinks.siteManageStock, 1), gte(wcProductLinks.failureCount, WC_AUTO_MAX_LINK_FAILURES)));
  return {
    enabled,
    lastRun: last ? runView(last) : null,
    failedRuns: backoff.failedRuns,
    nextAttemptAt: backoff.nextAttemptAt && backoff.nextAttemptAt.getTime() > Date.now() ? backoff.nextAttemptAt.toISOString() : null,
    untracked: untracked.rows.map(({ error: _e, ...r }) => r),
    untrackedTotal: untracked.total,
    stopped: stopped.rows,
    stoppedTotal: stopped.total,
  };
}

/** The worker: one automatic run a minute, started and stopped by `server.ts` */
export class WcAutoPushService {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  private static runInBackground(): void {
    if (this.running) return;
    this.running = true;
    runAutoPushOnce()
      .then((outcome) => {
        if (outcome.result) {
          logger.info(`[WooCommerce auto push] ${outcome.result.syncedCount} product(s) updated, ${outcome.result.failedCount} failed`);
        } else if (outcome.state === 'failed') {
          logger.warn('[WooCommerce auto push] Run failed; the next attempt waits (see the WooCommerce tab)');
        }
      })
      // terminal output is English (AGENTS §6): the Persian reason is on the run row the tab shows
      .catch((err: unknown) => logger.error(`[WooCommerce auto push] Run failed: ${err instanceof Error ? err.name : 'unknown error'}`))
      .finally(() => { this.running = false; });
  }

  static start(intervalMs: number = WC_AUTO_PUSH_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runInBackground(), intervalMs);
    this.timer.unref?.();
    logger.info(`[WooCommerce auto push] Worker started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
