import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, woocommerceOrderLogs } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { WC_BATCH_SIZE } from '../../lib/woocommerce/wcCatalog.js';
import { WC_FAILED_ORDER_HOLD_DAYS, WC_MAX_ORDER_PAGES, WC_OPEN_ORDER_STATUSES } from '../../lib/woocommerce/wcAutoPush.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { wcListRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';

/**
 * 10.2 package 6 (D-04 part B, plan question ق۶): the quantities the shop's open orders hold. The shop lowers its own stock
 * when an order is put on hold or paid, while the program invoices an order only once it is processing (TD-190); sending
 * the program's stock in between would give the shop back what such an order already holds. So every push keeps these
 * quantities off the number it sends: each on-hold and processing order whose invoice is not in the program yet (no live
 * document in its order log, review M-2: whatever the order's status), and each completed order the program failed to
 * invoice (its order log says so). A pending (unpaid) order holds no shop stock and is not read (review M-1).
 */
export interface OpenOrderLine { productId: number; variationId: number; quantity: number }
export interface OpenOrder { id: number; status: string; lines: OpenOrderLine[] }

const ORDERS_UNREADABLE = 'سفارش‌های باز سایت خوانده نشد و موجودی فرستاده نشد';
const ORDERS_MOVED = 'فهرست سفارش‌های باز سایت هنگام خواندن تغییر کرد و موجودی فرستاده نشد';
const ORDERS_TOO_SLOW = 'خواندن سفارش‌های باز سایت بیش از اندازه طول کشید و موجودی فرستاده نشد';

/** delta review N-B: only the automatic push tries again by itself */
const retryNote = (trigger: 'auto' | 'manual') =>
  (trigger === 'auto' ? '؛ ارسال خودکار کمی بعد دوباره تلاش می‌کند.' : '؛ کمی بعد دوباره «ارسال موجودی» را بزنید.');

function asLines(raw: unknown): OpenOrderLine[] {
  return (Array.isArray(raw) ? raw : []).map((l: unknown) => {
    const line = l as { product_id?: unknown; variation_id?: unknown; quantity?: unknown } | null;
    return { productId: Number(line?.product_id) || 0, variationId: Number(line?.variation_id) || 0, quantity: Number(line?.quantity) || 0 };
  }).filter(l => l.productId > 0 && l.quantity > 0);
}

function asOrder(row: unknown): OpenOrder | null {
  const r = row as { id?: unknown; status?: unknown; line_items?: unknown } | null;
  const id = Number(r?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, status: String(r?.status ?? ''), lines: asLines(r?.line_items) };
}

function tooManyOrders(): ValidationError {
  return new ValidationError(
    `سایت بیش از ${formatPersianNumber(WC_MAX_ORDER_PAGES * WC_BATCH_SIZE)} سفارش باز دارد و موجودی فرستاده نشد؛ سفارش‌های کهنه سایت را بررسی کنید.`,
    undefined, WC_SHOP_REQUEST_FAILED,
  );
}

/**
 * Every open order of the shop, newest first (delta review M-2: an order that arrives while the list is read lands at the
 * top, already read, instead of shifting a later page). Each reading after the first starts one row back (`offset`, delta
 * review N-A), so its first order must be the last order of the reading before: an order that left a read part of the list
 * or one that joined above it moves that row and shows. The reading fails, so nothing is sent with a stock too high, when
 * the list moved while it was read: that row moved, an order shows again, the shop's count (`X-WP-Total`) differs between
 * the first and the last reading, the orders read are not that count (review M-5), or, for a list of more than one
 * reading, the first page read again at the end does not show the same orders. A first page that counts more open orders
 * than `WC_MAX_ORDER_PAGES` pages fails at once (review M-6). A shop that sends no count is read until a short page.
 * `budgetMs` (delta review N-2) is the time the reading may take, so the push it feeds keeps its own part of the deadline;
 * `trigger` (delta review N-B) words the failure for an automatic run, which tries again, or a manual push, which does not.
 */
export async function readOpenOrders(
  conn: WcConnection,
  options: { signal?: AbortSignal; budgetMs?: number; trigger: 'auto' | 'manual' },
): Promise<OpenOrder[]> {
  const { signal, budgetMs, trigger } = options;
  const fail = (text: string) => new ValidationError(`${text}${retryNote(trigger)}`, undefined, WC_SHOP_REQUEST_FAILED);
  const limit = budgetMs ? AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(budgetMs)]) : signal;
  const read = async (offset: number) => {
    try {
      return await wcListRequest(conn, 'orders', {
        status: WC_OPEN_ORDER_STATUSES.join(','), per_page: WC_BATCH_SIZE, offset, orderby: 'id', order: 'desc',
        _fields: 'id,status,line_items',
      }, { signal: limit });
    } catch (err) {
      if (limit?.aborted && !signal?.aborted) throw fail(ORDERS_TOO_SLOW);
      throw err;
    }
  };
  const idsOf = (answer: unknown[]) => answer.map(row => asOrder(row)?.id ?? 0).join(',');
  const orders = new Map<number, OpenOrder>();
  let firstTotal: number | null = null;
  let firstPageIds = '';
  let offset = 0;
  let lastId = 0;
  // the first reading takes a full page and every later one a page less its overlap row
  for (let reading = 1; reading <= WC_MAX_ORDER_PAGES + 2; reading++) {
    const { data: answer, total } = await read(offset);
    if (!Array.isArray(answer)) throw fail(ORDERS_UNREADABLE);
    let rows: unknown[] = answer;
    if (reading === 1) {
      firstTotal = total;
      firstPageIds = idsOf(answer);
      if (total !== null && total > WC_MAX_ORDER_PAGES * WC_BATCH_SIZE) throw tooManyOrders();
    } else {
      if (firstTotal !== null && total !== firstTotal) throw fail(ORDERS_MOVED);
      if ((asOrder(answer[0])?.id ?? 0) !== lastId) throw fail(ORDERS_MOVED);
      rows = answer.slice(1);
    }
    for (const row of rows) {
      const order = asOrder(row);
      if (!order) continue;
      if (orders.has(order.id)) throw fail(ORDERS_MOVED);
      orders.set(order.id, order);
    }
    if (answer.length < WC_BATCH_SIZE || (firstTotal !== null && offset + answer.length >= firstTotal)) {
      if (firstTotal !== null && orders.size !== firstTotal) throw fail(ORDERS_MOVED);
      if (reading > 1) {
        const again = await read(0);
        if (!Array.isArray(again.data) || idsOf(again.data) !== firstPageIds || (firstTotal !== null && again.total !== firstTotal)) throw fail(ORDERS_MOVED);
      }
      return [...orders.values()];
    }
    lastId = asOrder(answer[answer.length - 1])?.id ?? 0;
    offset += answer.length - 1;
  }
  throw tooManyOrders();
}

/** Orders the program has invoiced (a live document in the order log): their stock already left the program */
async function invoicedOrderIds(executor: DbExecutor, orderIds: number[]): Promise<Set<number>> {
  if (orderIds.length === 0) return new Set();
  const rows = await executor.select({ wcOrderId: woocommerceOrderLogs.wcOrderId }).from(woocommerceOrderLogs)
    .innerJoin(documents, eq(documents.id, woocommerceOrderLogs.erpDocumentId))
    .where(and(
      inArray(woocommerceOrderLogs.wcOrderId, orderIds.map(String)),
      isNotNull(woocommerceOrderLogs.erpDocumentId),
      eq(documents.isDeleted, 0),
    ));
  return new Set(rows.map(r => Number(r.wcOrderId)));
}

/**
 * Completed orders the program failed to invoice (review M-2 nit): the shop took their stock and the program did not, and
 * they are not open any more, so they come from the order log (status `failed`, no live invoice, the stored order
 * completed) instead of the shop. Once the accountant invoices one (manual order sync), it is no longer kept off. Only an
 * order completed in the last `WC_FAILED_ORDER_HOLD_DAYS` days counts (delta review M-1): an older failure was most likely
 * put right by hand (a sale entered without the order sync), and keeping it off for ever would lower the shop twice. The
 * days count from the order's completion in the shop (`date_completed_gmt` of the stored order), else from when the order
 * log was made, never from its last change (delta review M-A), which every failed sync and order webhook moves.
 */
async function failedCompletedOrders(executor: DbExecutor, skip: Set<number>): Promise<OpenOrder[]> {
  const rows = await executor.select({
    wcOrderId: woocommerceOrderLogs.wcOrderId, payload: woocommerceOrderLogs.payload, createdAt: woocommerceOrderLogs.createdAt,
  })
    .from(woocommerceOrderLogs)
    .leftJoin(documents, and(eq(documents.id, woocommerceOrderLogs.erpDocumentId), eq(documents.isDeleted, 0)))
    .where(and(
      eq(woocommerceOrderLogs.status, 'failed'),
      isNull(documents.id),
      sql`lower(${woocommerceOrderLogs.payload}->>'status') = 'completed'`,
    ));
  const since = Date.now() - WC_FAILED_ORDER_HOLD_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .filter(r => failedOrderHeldSince(r.payload, r.createdAt) >= since)
    .map(r => ({ id: Number(r.wcOrderId), status: 'completed', lines: asLines((r.payload as { line_items?: unknown } | null)?.line_items) }))
    .filter(o => Number.isInteger(o.id) && o.id > 0 && !skip.has(o.id));
}

/** When a failed completed order's hold starts (UTC ms): its completion in the shop, else when its order log was made */
export function failedOrderHeldSince(payload: unknown, logCreatedAt: string | null): number {
  const completed = (payload as { date_completed_gmt?: unknown } | null)?.date_completed_gmt;
  const text = typeof completed === 'string' ? completed.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    const at = Date.parse(`${text}Z`);
    if (Number.isFinite(at)) return at;
  }
  // the log's own timestamp is UTC without a zone (TD-314)
  const made = Date.parse(serverTimestampToUtcIso(logCreatedAt) ?? '');
  return Number.isFinite(made) ? made : 0;
}

/**
 * The quantity each item's open orders hold, through the links (a variation line without its own link counts for its
 * parent product's link, whose stock it then holds). Read with the stock the push sends, in one snapshot, so an invoice
 * written meanwhile is counted once.
 */
export async function openOrderQuantities(
  executor: DbExecutor, orders: OpenOrder[], links: Array<{ itemId: number; wcProductId: number; wcVariationId: number }>,
): Promise<Map<number, number>> {
  const byKey = new Map(links.map(l => [`${l.wcProductId}:${l.wcVariationId}`, l.itemId]));
  const invoiced = await invoicedOrderIds(executor, orders.map(o => o.id));
  const failed = await failedCompletedOrders(executor, new Set(orders.map(o => o.id)));
  const held = new Map<number, number>();
  for (const order of [...orders.filter(o => !invoiced.has(o.id)), ...failed]) {
    for (const line of order.lines) {
      const itemId = byKey.get(`${line.productId}:${line.variationId}`) ?? byKey.get(`${line.productId}:0`);
      if (itemId !== undefined) held.set(itemId, (held.get(itemId) ?? 0) + line.quantity);
    }
  }
  return held;
}
