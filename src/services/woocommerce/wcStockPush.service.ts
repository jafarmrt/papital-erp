import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, wcSyncRuns } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { chunked, siteStockQuantity, WC_LIST_LIMIT } from '../../lib/woocommerce/wcCatalog.js';
import { shopSellableStocks } from './shopWarehouse.js';
import { updateLinkRows } from './wcLinkUpdates.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { requireWcConnection, wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';
import {
  actorUserId, hasLiveLinks, liveLinks, refreshCatalogLocked, withWcSyncLock, type WcActor, type WcRefreshSummary,
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

interface Outcome { link: Link; quantity: number; error: string }

function answerRows(answer: unknown): BatchAnswerRow[] {
  const rows = (answer as { update?: unknown } | null)?.update;
  return Array.isArray(rows) ? rows as BatchAnswerRow[] : [];
}

/** review N-A: one push never holds the lock longer than this (under the 60 s of a reverse proxy), a refresh before it included */
export const WC_PUSH_DEADLINE_MS = 50_000;
const PUSH_DEADLINE_MESSAGE = 'ارسال موجودی در مهلت تعیین‌شده تمام نشد و این محصول فرستاده نشد؛ کمی بعد دوباره بزنید.';

async function pushBatch(
  conn: WcConnection, path: string, rows: Array<{ link: Link; id: number; quantity: number }>, signal?: AbortSignal,
): Promise<Outcome[]> {
  // past the deadline the remaining batches are not sent at all; each of their products records why
  if (signal?.aborted) return rows.map(r => ({ link: r.link, quantity: r.quantity, error: PUSH_DEADLINE_MESSAGE }));
  try {
    const answer = await wcRequest(conn, 'POST', path, {
      update: rows.map(r => ({ id: r.id, manage_stock: true, stock_quantity: r.quantity })),
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
    return rows.map(r => ({ link: r.link, quantity: r.quantity, error: message.slice(0, 300) }));
  }
}

/** Sends the stock of these links in batches; returns each link's outcome */
export async function sendStocks(conn: WcConnection, wanted: Array<{ link: Link; quantity: number }>, signal?: AbortSignal): Promise<Outcome[]> {
  const simple = wanted.filter(w => w.link.wcVariationId === 0).map(w => ({ ...w, id: w.link.wcProductId }));
  const byParent = new Map<number, Array<{ link: Link; quantity: number; id: number }>>();
  for (const w of wanted.filter(x => x.link.wcVariationId > 0)) {
    byParent.set(w.link.wcProductId, [...(byParent.get(w.link.wcProductId) ?? []), { ...w, id: w.link.wcVariationId }]);
  }
  const outcomes: Outcome[] = [];
  for (const rows of chunked(simple)) outcomes.push(...await pushBatch(conn, 'products/batch', rows, signal));
  for (const [parent, rows] of byParent) {
    for (const part of chunked(rows)) outcomes.push(...await pushBatch(conn, `products/${parent}/variations/batch`, part, signal));
  }
  return outcomes;
}

/** The whole-number stock each linked item should show in the shop */
export async function wantedSiteStocks(links: Link[]): Promise<Map<number, number>> {
  const itemIds = [...new Set(links.map(l => l.itemId))];
  const { sellable } = await shopSellableStocks(orm, itemIds);
  return new Map(itemIds.map(id => [id, siteStockQuantity(sellable.get(id) ?? 0)]));
}

/** Records the outcomes on the links, the run row and one audit row (counts only), in one transaction */
async function recordOutcomes(outcomes: Outcome[], skippedCount: number, totalItems: number, actor: WcActor, trigger: string): Promise<WcStockPushResult> {
  const now = systemNowUtcIso();
  const failed = outcomes.filter(o => o.error);
  const errors = failed.map(o => `${o.link.siteSku || `#${o.link.wcProductId}`}: ${o.error}`);
  const trackingEnabledCount = outcomes.filter(o => !o.error && o.link.siteManageStock !== 1).length;
  const result: WcStockPushResult = {
    totalItems, syncedCount: outcomes.length - failed.length, failedCount: failed.length, skippedCount, trackingEnabledCount,
    errors: errors.slice(0, WC_LIST_LIMIT),
  };
  await orm.transaction(async (tx) => {
    // review M-3: one UPDATE per batch of links; the failure count is the one read with the links, under the sync lock
    await updateLinkRows(tx, outcomes.map(o => ({
      id: o.link.id,
      values: o.error
        ? { lastError: o.error, failureCount: o.link.failureCount + 1 }
        : { siteStock: o.quantity, siteManageStock: 1, lastPushedAt: now, lastError: '', failureCount: 0 },
    })), now);
    const status = failed.length === 0 ? 'ok' : failed.length === outcomes.length ? 'failed' : 'partial';
    await tx.insert(wcSyncRuns).values({
      kind: 'stock_push', status, userId: actorUserId(actor), startedAt: now, finishedAt: now,
      summary: {
        trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount, trackingEnabledCount,
        errors: errors.slice(0, 20),
      },
    });
    await logActivity({
      tx, req: actor.req, action: 'WC_STOCK_PUSH', entity: 'فروشگاه اینترنتی', entityId: '',
      description: `ارسال موجودی به سایت: ${formatPersianNumber(result.syncedCount)} محصول به‌روز شد، ${formatPersianNumber(result.failedCount)} ناموفق`
        + (trackingEnabledCount > 0 ? `، ردیابی موجودی ${formatPersianNumber(trackingEnabledCount)} محصول روشن شد` : ''),
      details: { trigger, totalItems, syncedCount: result.syncedCount, failedCount: result.failedCount, skippedCount, trackingEnabledCount },
    });
  });
  return result;
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
  const wanted = await wantedSiteStocks(links);
  const rows = links.map(link => ({ link, quantity: wanted.get(link.itemId) ?? 0 }));
  const toSend = options.onlyChanged ? rows.filter(r => !(r.link.siteManageStock === 1 && r.link.siteStock === r.quantity)) : rows;
  if (toSend.length === 0) {
    return { totalItems: links.length, syncedCount: 0, failedCount: 0, skippedCount: links.length, trackingEnabledCount: 0, errors: [] };
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.deadlineMs ?? WC_PUSH_DEADLINE_MS);
  try {
    const outcomes = await sendStocks(connection, toSend, deadline.signal);
    return await recordOutcomes(outcomes, links.length - toSend.length, links.length, actor, options.trigger);
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}


export const WC_ITEM_NOT_LINKED = 'WC_ITEM_NOT_LINKED';

/** what is left of the exchange's deadline after a refresh that ran first (at least one second, so the push still tries) */
function remainingMs(startedAt: number): number {
  return Math.max(1_000, WC_PUSH_DEADLINE_MS - (Date.now() - startedAt));
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
    const refreshed = (await hasLiveLinks()) ? undefined : await refreshCatalogLocked(actor, conn);
    const result = await pushStocksLocked(actor, { trigger: 'all', deadlineMs: remainingMs(startedAt) }, conn);
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
      await refreshCatalogLocked(actor, conn);
      [link] = await liveLinks([itemId]);
    }
    if (!link) {
      throw new ValidationError(
        `محصولی با شناسه «${item.code}» در سایت نیست یا به کالای دیگری وصل است؛ فهرست «محصولات سایت بی کالای متناظر» را در «تنظیمات ← ووکامرس» ببینید.`,
        undefined, WC_ITEM_NOT_LINKED,
      );
    }
    const result = await pushStocksLocked(actor, { itemIds: [itemId], trigger: 'item', deadlineMs: remainingMs(startedAt) }, conn);
    if (result.failedCount > 0) throw new ValidationError(`موجودی به سایت نرسید: ${result.errors[0] ?? ''}`, undefined, WC_SHOP_REQUEST_FAILED);
    const [after] = await liveLinks([itemId]);
    return { sku: after?.siteSku || String(item.code), quantity: Number(after?.siteStock ?? 0), trackingEnabledCount: result.trackingEnabledCount };
  });
}
