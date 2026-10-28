import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import type { PurchaseRequisitionItemRow } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { isClosedRequisitionRow, spreadOrderedQuantity } from '../../lib/procurement/requisitionRows.js';

export interface OverOrderLine {
  itemId: number;
  itemName: string;
  requested: number;
  orderedBefore: number;
  ordering: number;
  /** مقداری از همین سفارش که از درخواست بیشتر است */
  excess: number;
}

/**
 * v8.0.38 (TD-289، تصمیم مالک محصول — گزینه ب): کالاهایی که این تبدیل بیش از درخواست سفارش می‌دهد. برای هر کالا
 * درخواست‌شده و سفارش‌شده همه ردیف‌های آن جمع می‌شوند؛ مقدار بیش از درخواست = کمینه (مقدار همین سفارش، سفارش‌شده پیشین +
 * همین سفارش − درخواست‌شده). کالایی که در درخواست نیست همه مقدارش بیش از درخواست است. ردیف بسته فقط به اندازهٔ سفارش
 * پیشینش درخواست شمرده می‌شود (TD-1391).
 */
export function findOverOrders(
  reqItems: PurchaseRequisitionItemRow[],
  lines: Array<{ itemId: number; itemName?: string; quantity: number | string }>,
  needRows: PurchaseRequisitionItemRow[] = reqItems,
): OverOrderLine[] {
  const ordering = new Map<number, { quantity: FinancialDecimal; name: string }>();
  for (const line of lines) {
    const itemId = Number(line.itemId);
    if (!itemId) continue;
    const prev = ordering.get(itemId);
    ordering.set(itemId, { quantity: (prev?.quantity ?? fin(0)).add(line.quantity), name: prev?.name || line.itemName || '' });
  }

  const result: OverOrderLine[] = [];
  for (const [itemId, order] of ordering) {
    const rows = reqItems.filter(r => Number(r.itemId) === itemId);
    // v11 phase 7.2 (TD-1391): a closed row needs no more than it had ordered (its closure cancelled the rest), so the
    // spread, which skips it, and this check agree on how much the open rows may still take; `needRows` are the stored rows
    // when `reqItems` were rebuilt from only some of the orders (an order edit)
    const requested = needRows.filter(r => Number(r.itemId) === itemId)
      .reduce((sum, r) => sum.add(isClosedRequisitionRow(r) ? (r.orderedQty || 0) : (r.requestedQty || 0)), fin(0));
    const orderedBefore = rows.reduce((sum, r) => sum.add(r.orderedQty || 0), fin(0));
    const beyond = orderedBefore.add(order.quantity).subtract(requested);
    if (!beyond.isPositive()) continue;
    const excess = beyond.lessThan(order.quantity) ? beyond : order.quantity;
    result.push({
      itemId,
      itemName: rows[0]?.itemName || order.name || `کالای ${itemId}`,
      requested: requested.toNumber(),
      orderedBefore: orderedBefore.toNumber(),
      ordering: order.quantity.toNumber(),
      excess: excess.toNumber(),
    });
  }
  return result;
}

/** v11 phase 7.2 (TD-1391): the spread lives in `src/lib/procurement/requisitionRows.ts`, with the closed-row rule */
export { spreadOrderedQuantity };

/** متن هشدار سفارش بیش از درخواست برای پیام خطا، یادداشت درخواست و گزارش فعالیت */
/** v9.0.355 (TD-901، ت۵): مقدارها با رقم فارسی؛ پیش‌تر پیام سفارش بیش از درخواست رقم لاتین داشت */
export function describeOverOrders(overOrders: OverOrderLine[]): string {
  const n = (value: number) => toPersianDigits(value, 3);
  return overOrders
    .map(o => `«${o.itemName}»: درخواست ${n(o.requested)}، سفارش‌شده پیشین ${n(o.orderedBefore)}، این سفارش ${n(o.ordering)} (${n(o.excess)} بیش از درخواست)`)
    .join('؛ ');
}
