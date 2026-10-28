import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { PurchaseRequisitionItemRow } from '../../types.js';
import { isClosedRequisitionRow, rebuildOrderedQuantities } from '../../lib/procurement/requisitionRows.js';

export type RequisitionItemWithReceipt = PurchaseRequisitionItemRow & { receivedQty?: number | string };

/**
 * v8.0.36 (TD-290): مقدار دریافتی ردیف‌های درخواست خرید پس از تحویل یک سفارش. مقدار هر کالا جمع همه سطرهای فعال سند است
 * (پیش‌تر فقط سطر اول همان کالا شمرده می‌شد) و میان ردیف‌های همان کالا در درخواست به ترتیب پر می‌شود: هر ردیف تا باقی‌مانده
 * خودش، و مازاد به ردیف آخر همان کالا.
 */
export function applyDeliveredLines(
  reqItems: RequisitionItemWithReceipt[],
  docLines: Array<{ itemId: number | null; quantity: DecimalValue | null }>
): RequisitionItemWithReceipt[] {
  const deliveredByItem = new Map<number, FinancialDecimal>();
  for (const line of docLines) {
    const itemId = Number(line.itemId);
    if (!itemId) continue;
    deliveredByItem.set(itemId, (deliveredByItem.get(itemId) ?? fin(0)).add(line.quantity ?? 0));
  }

  const lastRowOfItem = new Map<number, number>();
  reqItems.forEach((row, index) => {
    const itemId = Number(row.itemId);
    if (deliveredByItem.has(itemId)) lastRowOfItem.set(itemId, index);
  });

  return reqItems.map((row, index) => {
    const itemId = Number(row.itemId);
    const left = deliveredByItem.get(itemId);
    if (!left || !left.isPositive()) return row;
    const requested = fin(row.requestedQty || 0);
    const previous = fin(row.receivedQty || 0);
    // a closed row receives at most what it had ordered (TD-1391); the rest goes on to the next rows of the item
    const open = (isClosedRequisitionRow(row) ? fin(row.orderedQty || 0) : requested).subtract(previous);
    const share = lastRowOfItem.get(itemId) === index || left.lessThan(open) ? left : (open.isPositive() ? open : fin(0));
    deliveredByItem.set(itemId, left.subtract(share));
    if (share.isZero()) return row;
    const received = previous.add(share);
    const remaining = requested.subtract(received);
    return {
      ...row,
      receivedQty: received.toNumber(),
      remainingQty: remaining.isPositive() ? remaining.toNumber() : 0,
      status: received.greaterThanOrEqual(requested) ? 'received' : row.status,
    };
  });
}

type SettlementRow = Pick<PurchaseRequisitionItemRow, 'itemId' | 'requestedQty' | 'orderedQty' | 'status' | 'closureNote' | 'closed'> & { receivedQty?: number | string };

/** v11 phase 7.2 (TD-1391): the rule lives in `src/lib/procurement/requisitionRows.ts`, shared with the documents rebuild */
export { isClosedRequisitionRow };

/**
 * v9.0.316 (TD-690): ردیفی که کارش تمام است: کالای فهرست که به اندازه درخواست دریافت شده یا بسته شده است، و ردیف بی‌کالا
 * (خدمت) که «دریافت کالا» آن را دریافت‌شده کرده است.
 */
export function isSettledRequisitionRow(row: SettlementRow): boolean {
  if (!row.itemId) return row.status === 'received';
  return isClosedRequisitionRow(row) || fin(row.receivedQty || 0).greaterThanOrEqual(row.requestedQty || 0);
}

type OrderLine = { itemId: number | null; quantity: DecimalValue | null; documentId?: number | null };

/**
 * v10.0.237 (TD-912، تصمیم ت۹ الف): مقدار سفارش‌شده و دریافتی ردیف‌های کالاهای `itemIds` از نو، از سطرهای سفارش‌های زنده
 * (`ordered`: هر وضعیت) و سفارش‌های قطعی زنده (`received`). سفارش‌شده هر کالا، مانند «تبدیل به سفارش»، میان ردیف‌های همان
 * کالا به ترتیب پخش می‌شود (v11 phase 6.4, C9: `spreadOrderedQuantity`; پیش‌تر همه روی ردیف اول) و دریافتی میان ردیف‌ها به
 * ترتیب پر می‌شود (`applyDeliveredLines`). ردیف بسته‌شده (TD-690) بسته می‌ماند و مقدار سفارشش را نگه می‌دارد (TD-1391)؛ ردیف
 * دیگر مانده و وضعیتش را از همین دو مقدار می‌گیرد. کالاهای دیگر درخواست دست نمی‌خورند (دریافت‌های قدیمی بی سند پیوندی).
 */
export function rebuildOrderRows(
  rows: RequisitionItemWithReceipt[],
  itemIds: Set<number>,
  ordered: OrderLine[],
  received: OrderLine[],
): RequisitionItemWithReceipt[] {
  // v11 phase 6.4 (C9, review): a row's closure is read before the rebuild; with the lowered quantity the legacy rule
  // (`ordered` below its request) would read a fully ordered row as closed and freeze it at «ordered» with nothing left.
  // v11 phase 7.2 (TD-1391): a closed row keeps its ordered quantity and the spread skips it (`rebuildOrderedQuantities`)
  const { rows: withOrdered, closed: closedBefore } = rebuildOrderedQuantities(rows, itemIds, ordered);
  const reset = withOrdered.map(row => (itemIds.has(Number(row.itemId)) ? { ...row, receivedQty: 0 } : row));
  const filled = applyDeliveredLines(reset, received.filter(line => itemIds.has(Number(line.itemId))));
  return filled.map((row, index) => {
    if (!itemIds.has(Number(row.itemId))) return row;
    const requested = fin(row.requestedQty || 0);
    if (fin(row.receivedQty || 0).greaterThanOrEqual(requested) && requested.isPositive()) return { ...row, remainingQty: 0, status: 'received' };
    if (closedBefore[index]) return { ...row, remainingQty: 0, status: 'ordered' };
    const open = requested.subtract(row.orderedQty || 0);
    return { ...row, remainingQty: open.isPositive() ? open.toNumber() : 0, status: open.isPositive() ? 'pending' : 'ordered' };
  });
}
