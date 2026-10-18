import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import {
  chunked, pushBudgetMs, refreshBudgetMs, siteStockQuantity, WC_LIST_LIMIT, WC_PUSH_DEADLINE_MS,
} from '../../lib/woocommerce/wcCatalog.js';
import { shopSellableStocks } from './shopWarehouse.js';
import { openOrderQuantities, readOpenOrders, type OpenOrder } from './wcOpenOrders.js';
import { updateLinkRows } from './wcLinkUpdates.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { requireWcConnection, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import {
  actorUserId, hasLiveLinks, liveLinks, recordFailedRun, refreshCatalogLocked, withWcSyncLock, type WcActor, type WcRefreshSummary,
} from './wcCatalog.service.js';

/**
 * 10.2 package 6 (D-04 part A, OBS-R2-83): stock goes to the shop through the item links, in `products/batch` requests of
 * at most 100 products (and `products/<id>/variations/batch` for variations), instead of a SKU search and a write per
 * item. The number sent is the item's sellable stock in the shop warehouse (`shopSellableStocks`, TD-293), floored to a
 * whole number. Each product's answer is kept on its link: a success records the stock the shop now holds, a failure its
 * message; one failed request fails only its own batch.
 */
type Link = Awaited<ReturnType<typeof liveLinks>>[number];

export interface WcStockPushResult {
  totalItems: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  /**
   * products whose stock tracking was off on the site and that the push turned on (`manage_stock: true`), counted so the
   * change is never silent; the automatic push of part B leaves such products alone
   */
  trackingEnabledCount: number;
  errors: string[];
}

interface BatchAnswerRow { id?: unknown; error?: { message?: unknown } }

/** `requestFailed`: the request itself failed or was never sent (the shop, not this product); the automatic push then
 * leaves the link's failure count alone, so a shop that is down never stops every product */
export interface Outcome { link: Link; quantity: number; error: string; requestFailed?: boolean }

/** answers that say the shop or the connection failed, not the products of the batch (review M-4) */
const SHOP_LEVEL_STATUSES = new Set([401, 403, 408, 429]);

/**
 * Whether a failed batch request failed for the shop (no answer, a timeout, a redirect, 5xx, 401/403, 408, 429) rather than
 * for its products. Any other 4xx (400, 404: a product or a parent removed in the shop) is the products': each counts it,
 * so a batch the shop keeps refusing stops after `WC_AUTO_MAX_LINK_FAILURES` instead of holding every run back.
 */
export function isShopLevelFailure(err: unknown): boolean {
  const status = (err instanceof ValidationError ? (err.details as { status?: unknown } | undefined)?.status : undefined);
  if (typeof status !== 'number') return true;
  return status < 400 || status >= 500 || SHOP_LEVEL_STATUSES.has(status);
}

function answerRows(answer: unknown): BatchAnswerRow[] {
  const rows = (answer as { update?: unknown } | null)?.update;
  return Array.isArray(rows) ? rows as BatchAnswerRow[] : [];
}

export { WC_PUSH_DEADLINE_MS };
const PUSH_DEADLINE_MESSAGE = 'ارسال موجودی در مهلت تعیین‌شده تمام نشد و این محصول فرستاده نشد؛ کمی بعد دوباره بزنید.';

export interface SendOptions {
  signal?: AbortSignal;
  /**
   * send `manage_stock: true` with each product (the manual push, like the earlier per-item push); the automatic push sends
   * only the stock, to products whose tracking is already on, so it never changes how the shop keeps stock
   */
  setManageStock: boolean;
}

async function pushBatch(
  conn: WcConnection, path: string, rows: Array<{ link: Link; id: number; quantity: number }>, options: SendOptions,
): Promise<Outcome[]> {
  const { signal } = options;
  // past the deadline the remaining batches are not sent at all; each of their products records why
  if (signal?.aborted) return rows.map(r => ({ link: r.link, quantity: r.quantity, error: PUSH_DEADLINE_MESSAGE, requestFailed: true }));
  try {
    const answer = await wcRequest(conn, 'POST', path, {
      update: rows.map(r => (options.setManageStock
        ? { id: r.id, manage_stock: true, stock_quantity: r.quantity }
        : { id: r.id, stock_quantity: r.quantity })),
    }, {}, { signal });
    const byId = new Map(answerRows(answer).map(a => [Number(a.id), a]));
    return rows.map(r => {
      const a = byId.get(r.id);
      if (!a) return { link: r.link, quantity: r.quantity, error: 'سایت پاسخی برای این محصول نداد.' };
      const message = a.error ? String(a.error.message ?? 'خطای سایت').slice(0, 300) : '';
      return { link: r.link, quantity: r.quantity, error: message };
    });
  } catch (err) {
    const message = err instanceof ValidationError ? err.message : 'ارتباط با سایت ناموفق بود.';
    const requestFailed = isShopLevelFailure(err);
    return rows.map(r => ({ link: r.link, quantity: r.quantity, error: message.slice(0, 300), requestFailed }));
  }
}

/** Sends the stock of these links in batches; returns each link's outcome */
export async function sendStocks(conn: WcConnection, wanted: Array<{ link: Link; quantity: number }>, options: SendOptions): Promise<Outcome[]> {
  const simple = wanted.filter(w => w.link.wcVariationId === 0).map(w => ({ ...w, id: w.link.wcProductId }));
  const byParent = new Map<number, Array<{ link: Link; quantity: number; id: number }>>();
  for (const w of wanted.filter(x => x.link.wcVariationId > 0)) {
    byParent.set(w.link.wcProductId, [...(byParent.get(w.link.wcProductId) ?? []), { ...w, id: w.link.wcVariationId }]);
  }
  const outcomes: Outcome[] = [];
  for (const rows of chunked(simple)) outcomes.push(...await pushBatch(conn, 'products/batch', rows, options));
  for (const [parent, rows] of byParent) {
    for (const part of chunked(rows)) outcomes.push(...await pushBatch(conn, `products/${parent}/variations/batch`, part, options));
  }
  return outcomes;
}

export interface SiteStocks {
  /** the whole-number sellable stock of each item in the shop warehouse */
  sellable: Map<number, number>;
  /** what each item should show in the shop: its sellable stock less what the shop's open orders hold, never below zero */
  wanted: Map<number, number>;
}

/**
 * The stock each item should show in the shop (part B, plan question ق۶). The sellable stock and the order log read in one
 * snapshot (repeatable read), so a processing order invoiced meanwhile is taken off once, never twice or not at all;
 * `mapLinks` are the links an order line is matched through (every live link, so a line never lands on the wrong item).
 */
export async function siteStocks(itemIds: number[], orders: OpenOrder[], mapLinks: Link[]): Promise<SiteStocks> {
  return orm.transaction(async (tx) => {
    const { sellable: raw } = await shopSellableStocks(tx, itemIds);
    const held = await openOrderQuantities(tx, orders, mapLinks);
    const sellable = new Map(itemIds.map(id => [id, siteStockQuantity(raw.get(id) ?? 0)]));
    const wanted = new Map(itemIds.map(id => [id, Math.max(0, (sellable.get(id) ?? 0) - (held.get(id) ?? 0))]));
    return { sellable, wanted };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/**
 * A run failed when nothing it sent arrived; an automatic run fails only for the shop (review M-4): a run whose products
 * were all refused one by one is `partial`, so one rejected product never makes every later run wait
 */
function runStatus(outcomes: Outcome[], failedCount: number, trigger: PushOptions['trigger']): 'ok' | 'partial' | 'failed' {
  if (failedCount === 0) return 'ok';
  if (failedCount < outcomes.length) return 'partial';
  return trigger !== 'auto' || outcomes.some(o => o.requestFailed) ? 'failed' : 'partial';
}

/**
 * Records the outcomes on the links, the run row and one audit row (counts only), in one transaction. In an automatic run a
 * failure of the request itself (`requestFailed`) is recorded on the link without counting against it
 */
export async function recordOutcomes(
  outcomes: Outcome[], skippedCount: number, totalItems: number, actor: WcActor, trigger: PushOptions['trigger'],
): Promise<WcStockPushResult & { status: 'ok' | 'partial' | 'failed' }> {
  const now = systemNowUtcIso();
  const failed = outcomes.filter(o => o.error);
  const errors = failed.map(o => `${o.link.siteSku || `#${o.link.wcProductId}`}: ${o.error}`);
  const trackingEnabledCount = outcomes.filter(o => !o.error && o.link.siteManageStock !== 1).length;
  const result: WcStockPushResult = {
    totalItems, syncedCount: outcomes.length - failed.length, failedCount: failed.length, skippedCount, trackingEnabledCount,
    errors: errors.slice(0, WC_LIST_LIMIT),
  };
  let status: 'ok' | 'partial' | 'failed' = 'ok';
  await orm.transaction(async (tx) => {
    // review M-3: one UPDATE per batch of links; the failure count is the one read with the links, under the sync lock
    await updateLinkRows(tx, outcomes.map(o => ({
      id: o.link.id,
      values: o.error
        ? { lastError: o.error, failureCount: trigger === 'auto' && o.requestFailed ? o.link.failureCount : o.link.failureCount + 1 }
        : { siteStock: o.quantity, siteManageStock: 1, lastPushedAt: now, lastError: '', failureCount: 0 },
    })), now);
    status = runStatus(outcomes, failed.length, trigger);
    await tx.insert(wcSyncRuns).values({
      kind: 'stock_push', status, userId: actorUserId(actor), startedAt: now, finishedAt: now,
      summary: {
        trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount, trackingEnabledCount,
        errors: errors.slice(0, 20),
      },
    });
    // review (c): an automatic run writes no audit row here; its run row is the record and a failure is audited once per
    // streak by the automatic push itself
    if (trigger === 'auto') return;
    await logActivity({
      tx, req: actor.req, action: 'WC_STOCK_PUSH', entity: 'فروشگاه اینترنتی', entityId: '',
      description: `ارسال موجودی به سایت: ${formatPersianNumber(result.syncedCount)} محصول به‌روز شد، ${formatPersianNumber(result.failedCount)} ناموفق`
        + (trackingEnabledCount > 0 ? `، ردیابی موجودی ${formatPersianNumber(trackingEnabledCount)} محصول روشن شد` : ''),
      details: { trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount, trackingEnabledCount },
    });
  });
  return { ...result, status };
}

export interface PushOptions {
  itemIds?: number[];
  /** leave out links whose shop stock already equals the wanted stock */
  onlyChanged?: boolean;
  trigger: 'all' | 'item' | 'auto';
  /** the push's overall deadline (default `WC_PUSH_DEADLINE_MS`); past it the open request is aborted and nothing more is sent */
  deadlineMs?: number;
}

/** The push itself, for a caller that holds the `WOOCOMMERCE_SYNC` lock */
export async function pushStocksLocked(actor: WcActor, options: PushOptions, conn?: WcConnection): Promise<WcStockPushResult> {
  const connection = conn ?? await requireWcConnection();
  const links = await liveLinks(options.itemIds);
  if (links.length === 0) {
    return { totalItems: 0, syncedCount: 0, failedCount: 0, skippedCount: 0, trackingEnabledCount: 0, errors: [] };
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.deadlineMs ?? WC_PUSH_DEADLINE_MS);
  try {
    // part B: the open orders are read first, then the stock in one snapshot with the order log (`siteStocks`)
    let orders: OpenOrder[];
    try {
      orders = await readOpenOrders(connection, deadline.signal);
    } catch (err) {
      await recordFailedRun('stock_push', actor, err, { trigger: options.trigger });
      throw err;
    }
    const { wanted } = await siteStocks([...new Set(links.map(l => l.itemId))], orders, options.itemIds ? await liveLinks() : links);
    const rows = links.map(link => ({ link, quantity: wanted.get(link.itemId) ?? 0 }));
    const toSend = options.onlyChanged ? rows.filter(r => !(r.link.siteManageStock === 1 && r.link.siteStock === r.quantity)) : rows;
    if (toSend.length === 0) {
      return { totalItems: links.length, syncedCount: 0, failedCount: 0, skippedCount: links.length, trackingEnabledCount: 0, errors: [] };
    }
    const outcomes = await sendStocks(connection, toSend, { signal: deadline.signal, setManageStock: true });
    return await recordOutcomes(outcomes, links.length - toSend.length, links.length, actor, options.trigger);
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}


export const WC_ITEM_NOT_LINKED = 'WC_ITEM_NOT_LINKED';

/** review N-D: a refresh run before a push shares the exchange's deadline and leaves the push its minimum budget */
function refreshBeforePush(actor: WcActor, conn: WcConnection, startedAt: number): Promise<WcRefreshSummary> {
  return refreshCatalogLocked(actor, conn, { deadlineMs: refreshBudgetMs(Date.now() - startedAt) });
}

/**
 * What is left of the exchange for the push; when the refresh before it left too little, the push is not started (a failed
 * run with its reason, no link marked failed)
 */
async function pushBudgetOrStop(actor: WcActor, startedAt: number): Promise<number> {
  const budget = pushBudgetMs(Date.now() - startedAt);
  if (budget !== null) return budget;
  const err = new ValidationError(
    'بازخوانی محصولات سایت انجام شد ولی برای ارسال موجودی وقت نماند و چیزی فرستاده نشد؛ دوباره «ارسال موجودی» را بزنید.',
    undefined, WC_SHOP_REQUEST_FAILED,
  );
  await recordFailedRun('stock_push', actor, err);
  throw err;
}

export interface WcPushAllResult extends WcStockPushResult {
  /** the catalog refresh run first because no item was linked yet */
  refreshed?: WcRefreshSummary;
}

/** «ارسال موجودی همه کالاها»: every linked item, after a first catalog refresh when nothing is linked yet */
export function pushAllStocks(actor: WcActor): Promise<WcPushAllResult> {
  return withWcSyncLock(async () => {
    const startedAt = Date.now();
    const conn = await requireWcConnection();
    const refreshed = (await hasLiveLinks()) ? undefined : await refreshBeforePush(actor, conn, startedAt);
    const result = await pushStocksLocked(actor, { trigger: 'all', deadlineMs: await pushBudgetOrStop(actor, startedAt) }, conn);
    return refreshed ? { ...result, refreshed } : result;
  });
}

/** One item's stock (the items page): through its link; 422 `WC_ITEM_NOT_LINKED` when the shop has no product for it */
export function pushItemStock(actor: WcActor, itemId: number): Promise<{ sku: string; quantity: number; trackingEnabledCount: number }> {
  return withWcSyncLock(async () => {
    const [item] = await orm.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));
    if (!item) throw new NotFoundError('کالای مورد نظر در سامانه پیدا نشد.');
    if (!String(item.code ?? '').trim()) throw new ValidationError('کالا کد (SKU) ندارد و به سایت فرستاده نمی‌شود.', undefined, WC_ITEM_NOT_LINKED);
    const startedAt = Date.now();
    const conn = await requireWcConnection();
    let [link] = await liveLinks([itemId]);
    if (!link) {
      // a product made on the site since the last refresh: read the catalog once before giving up
      await refreshBeforePush(actor, conn, startedAt);
      [link] = await liveLinks([itemId]);
    }
    if (!link) {
      throw new ValidationError(
        `محصولی با شناسه «${item.code}» در سایت نیست یا به کالای دیگری وصل است؛ فهرست «محصولات سایت بی کالای متناظر» را در «تنظیمات ← ووکامرس» ببینید.`,
        undefined, WC_ITEM_NOT_LINKED,
      );
    }
    const result = await pushStocksLocked(actor, { itemIds: [itemId], trigger: 'item', deadlineMs: await pushBudgetOrStop(actor, startedAt) }, conn);
    if (result.failedCount > 0) throw new ValidationError(`موجودی به سایت نرسید: ${result.errors[0] ?? ''}`, undefined, WC_SHOP_REQUEST_FAILED);
    const [after] = await liveLinks([itemId]);
    return { sku: after?.siteSku || String(item.code), quantity: Number(after?.siteStock ?? 0), trackingEnabledCount: result.trackingEnabledCount };
  });
}
