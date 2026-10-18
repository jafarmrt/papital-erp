import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, woocommerceOrderLogs } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { WC_BATCH_SIZE } from '../../lib/woocommerce/wcCatalog.js';
import { WC_MAX_ORDER_PAGES, WC_OPEN_ORDER_STATUSES } from '../../lib/woocommerce/wcAutoPush.js';
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

const ORDERS_UNREADABLE = 'سفارش‌های باز سایت خوانده نشد و موجودی فرستاده نشد؛ کمی بعد دوباره تلاش می‌شود.';
const ORDERS_MOVED = 'فهرست سفارش‌های باز سایت هنگام خواندن تغییر کرد و موجودی فرستاده نشد؛ کمی بعد دوباره تلاش می‌شود.';

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
 * Every open order of the shop, in id order. The reading fails, so nothing is sent with a stock too high, when the list
 * moved while it was read: a page shows an order again, the shop's count (`X-WP-Total`) differs between the first and the
 * last page, or the orders read are not that count (review M-5: an order that left the list between two pages shifts the
 * next page and one order is never read). A first page that counts more open orders than `WC_MAX_ORDER_PAGES` pages fails
 * at once (review M-6). A shop that sends no count is read until a short page, as before.
 */
export async function readOpenOrders(conn: WcConnection, signal?: AbortSignal): Promise<OpenOrder[]> {
  const orders = new Map<number, OpenOrder>();
  let firstTotal: number | null = null;
  for (let page = 1; page <= WC_MAX_ORDER_PAGES; page++) {
    const { data: answer, total } = await wcListRequest(conn, 'orders', {
      status: WC_OPEN_ORDER_STATUSES.join(','), per_page: WC_BATCH_SIZE, page, orderby: 'id', order: 'asc',
      _fields: 'id,status,line_items',
    }, { signal });
    if (!Array.isArray(answer)) throw new ValidationError(ORDERS_UNREADABLE, undefined, WC_SHOP_REQUEST_FAILED);
    if (page === 1) {
      firstTotal = total;
      if (total !== null && total > WC_MAX_ORDER_PAGES * WC_BATCH_SIZE) throw tooManyOrders();
    } else if (firstTotal !== null && total !== firstTotal) {
      throw new ValidationError(ORDERS_MOVED, undefined, WC_SHOP_REQUEST_FAILED);
    }
    for (const row of answer) {
      const order = asOrder(row);
      if (!order) continue;
      if (orders.has(order.id)) throw new ValidationError(ORDERS_MOVED, undefined, WC_SHOP_REQUEST_FAILED);
      orders.set(order.id, order);
    }
    if (answer.length < WC_BATCH_SIZE || (firstTotal !== null && page * WC_BATCH_SIZE >= firstTotal)) {
      if (firstTotal !== null && orders.size !== firstTotal) throw new ValidationError(ORDERS_MOVED, undefined, WC_SHOP_REQUEST_FAILED);
      return [...orders.values()];
    }
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
 * completed) instead of the shop. Once the accountant invoices one (manual order sync), it is no longer kept off.
 */
async function failedCompletedOrders(executor: DbExecutor, skip: Set<number>): Promise<OpenOrder[]> {
  const rows = await executor.select({ wcOrderId: woocommerceOrderLogs.wcOrderId, payload: woocommerceOrderLogs.payload })
    .from(woocommerceOrderLogs)
    .leftJoin(documents, and(eq(documents.id, woocommerceOrderLogs.erpDocumentId), eq(documents.isDeleted, 0)))
    .where(and(
      eq(woocommerceOrderLogs.status, 'failed'),
      isNull(documents.id),
      sql`lower(${woocommerceOrderLogs.payload}->>'status') = 'completed'`,
    ));
  return rows
    .map(r => ({ id: Number(r.wcOrderId), status: 'completed', lines: asLines((r.payload as { line_items?: unknown } | null)?.line_items) }))
    .filter(o => Number.isInteger(o.id) && o.id > 0 && !skip.has(o.id));
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
