import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { PurchaseRequisitionItemRow } from '../../types.js';

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
    const open = requested.subtract(previous);
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

/**
 * v9.0.316 (TD-690، B10-03): ردیفی که هنگام صدور سفارش بسته شد و دیگر سفارش داده نمی‌شود: نشان `closed`، یا یادداشت
 * بستن، یا (ردیف‌های پیش از v9.0.316) وضعیت «سفارش‌شده» با سفارشی کمتر از درخواست، که تبدیل فقط هنگام بستن می‌نوشت.
 */
export function isClosedRequisitionRow(row: SettlementRow): boolean {
  return row.closed === true
    || Boolean(String(row.closureNote ?? '').trim())
    || (row.status === 'ordered' && fin(row.orderedQty || 0).lessThan(row.requestedQty || 0));
}

/**
 * v9.0.316 (TD-690): ردیفی که کارش تمام است: کالای فهرست که به اندازه درخواست دریافت شده یا بسته شده است، و ردیف بی‌کالا
 * (خدمت) که «دریافت کالا» آن را دریافت‌شده کرده است.
 */
export function isSettledRequisitionRow(row: SettlementRow): boolean {
  if (!row.itemId) return row.status === 'received';
  return isClosedRequisitionRow(row) || fin(row.receivedQty || 0).greaterThanOrEqual(row.requestedQty || 0);
}
