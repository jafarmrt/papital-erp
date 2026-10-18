import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, woocommerceOrderLogs } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { WC_BATCH_SIZE } from '../../lib/woocommerce/wcCatalog.js';
import { WC_MAX_ORDER_PAGES, WC_OPEN_ORDER_STATUSES } from '../../lib/woocommerce/wcAutoPush.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { wcRequest, WC_SHOP_REQUEST_FAILED, type WcConnection } from './wcClient.js';

/**
 * 10.2 package 6 (D-04 part B, plan question ق۶): the quantities the shop's open orders hold. The shop lowers its own stock
 * when an order arrives, while the program invoices an order only once it is processing (TD-190); sending the program's
 * stock in between would give the shop back what a pending order already holds. So every push keeps these quantities off
 * the number it sends: each pending and on-hold order, and each processing order whose invoice is not in the program yet
 * (no live document in its order log).
 */
export interface OpenOrderLine { productId: number; variationId: number; quantity: number }
export interface OpenOrder { id: number; status: string; lines: OpenOrderLine[] }

const ORDERS_UNREADABLE = 'سفارش‌های باز سایت خوانده نشد و موجودی فرستاده نشد؛ کمی بعد دوباره تلاش می‌شود.';

function asOrder(row: unknown): OpenOrder | null {
  const r = row as { id?: unknown; status?: unknown; line_items?: unknown } | null;
  const id = Number(r?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const lines = (Array.isArray(r?.line_items) ? r.line_items : []).map((l: unknown) => {
    const line = l as { product_id?: unknown; variation_id?: unknown; quantity?: unknown };
    return { productId: Number(line.product_id) || 0, variationId: Number(line.variation_id) || 0, quantity: Number(line.quantity) || 0 };
  }).filter(l => l.productId > 0 && l.quantity > 0);
  return { id, status: String(r?.status ?? ''), lines };
}

/**
 * Every open order of the shop, in id order. A page that shows an order again means the list moved while it was read and
 * an order may have been missed, so the reading fails rather than send a stock that is too high; so does a shop with more
 * open orders than `WC_MAX_ORDER_PAGES` pages.
 */
export async function readOpenOrders(conn: WcConnection, signal?: AbortSignal): Promise<OpenOrder[]> {
  const orders = new Map<number, OpenOrder>();
  for (let page = 1; page <= WC_MAX_ORDER_PAGES; page++) {
    const answer = await wcRequest(conn, 'GET', 'orders', null, {
      status: WC_OPEN_ORDER_STATUSES.join(','), per_page: WC_BATCH_SIZE, page, orderby: 'id', order: 'asc',
      _fields: 'id,status,line_items',
    }, { signal });
    if (!Array.isArray(answer)) throw new ValidationError(ORDERS_UNREADABLE, undefined, WC_SHOP_REQUEST_FAILED);
    for (const row of answer) {
      const order = asOrder(row);
      if (!order) continue;
      if (orders.has(order.id)) throw new ValidationError(ORDERS_UNREADABLE, undefined, WC_SHOP_REQUEST_FAILED);
      orders.set(order.id, order);
    }
    if (answer.length < WC_BATCH_SIZE) return [...orders.values()];
  }
  throw new ValidationError(
    `سایت بیش از ${formatPersianNumber(WC_MAX_ORDER_PAGES * WC_BATCH_SIZE)} سفارش باز دارد و موجودی فرستاده نشد؛ سفارش‌های کهنه سایت را بررسی کنید.`,
    undefined, WC_SHOP_REQUEST_FAILED,
  );
}

/** Processing orders the program has invoiced (a live document in the order log): their stock already left the program */
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
 * The quantity each item's open orders hold, through the links (a variation line without its own link counts for its
 * parent product's link, whose stock it then holds). Read with the stock the push sends, in one snapshot, so an invoice
 * written meanwhile is counted once.
 */
export async function openOrderQuantities(
  executor: DbExecutor, orders: OpenOrder[], links: Array<{ itemId: number; wcProductId: number; wcVariationId: number }>,
): Promise<Map<number, number>> {
  const byKey = new Map(links.map(l => [`${l.wcProductId}:${l.wcVariationId}`, l.itemId]));
  const invoiced = await invoicedOrderIds(executor, orders.filter(o => o.status === 'processing').map(o => o.id));
  const held = new Map<number, number>();
  for (const order of orders) {
    if (order.status === 'processing' && invoiced.has(order.id)) continue;
    for (const line of order.lines) {
      const itemId = byKey.get(`${line.productId}:${line.variationId}`) ?? byKey.get(`${line.productId}:0`);
      if (itemId !== undefined) held.set(itemId, (held.get(itemId) ?? 0) + line.quantity);
    }
  }
  return held;
}
