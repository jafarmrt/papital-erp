import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal';

/**
 * v11 phase 7.2 (TD-1391): one rule for a closed requisition row and for spreading an ordered quantity over the rows of one
 * item, shared by «تبدیل به سفارش», the rebuild after a void or an order edit (procurement) and the rebuild after a draft
 * order is voided (documents). Before, the documents rebuild reopened a legacy closed row (status «ordered», ordered below
 * the request, no flag) as «pending», and the spread put quantity on a closed row, so the quantity moved between the rows
 * of an item while the closure stayed with its own row.
 */
export interface RequisitionQuantityRow {
  itemId?: number | null;
  requestedQty: number;
  orderedQty?: number;
  status?: string;
  closed?: boolean;
  closureNote?: string;
  receivedQty?: number | string;
}

/**
 * v9.0.316 (TD-690، B10-03): ردیفی که هنگام صدور سفارش بسته شد و دیگر سفارش داده نمی‌شود: نشان `closed`، یا یادداشت
 * بستن، یا (ردیف‌های پیش از v9.0.316) وضعیت «سفارش‌شده» با سفارشی کمتر از درخواست، که تبدیل فقط هنگام بستن می‌نوشت.
 */
export function isClosedRequisitionRow(row: Pick<RequisitionQuantityRow, 'requestedQty' | 'orderedQty' | 'status' | 'closed' | 'closureNote'>): boolean {
  return row.closed === true
    || Boolean(String(row.closureNote ?? '').trim())
    || (row.status === 'ordered' && fin(row.orderedQty || 0).lessThan(row.requestedQty || 0));
}

/**
 * v11 phase 6.4 (C9): the quantity one order line adds to the requisition rows of its item, spread over them in order: each
 * row takes what it still lacks (requested − ordered) and the last row takes what is left, the excess of an over-order
 * included. Before, the whole quantity went to the first row: rows 5 + 5 ordered as 10 read «ordered 10» and «ordered 0,
 * pending», and ordering the pending 5 asked for an over-order reason. `findOverOrders` and delivery already sum the rows.
 * v11 phase 7.2 (TD-1391): with `isClosed`, a closed row takes nothing and the last open row takes the excess; only when
 * every row is closed does the last row take it, so the rows still add up to what was ordered.
 */
export function spreadOrderedQuantity<T extends Pick<RequisitionQuantityRow, 'requestedQty' | 'orderedQty'>>(
  rows: readonly T[],
  quantity: DecimalValue,
  isClosed: (row: T, index: number) => boolean = () => false,
): Array<{ row: T; added: number }> {
  const open = rows.filter((row, index) => !isClosed(row, index));
  const takers = open.length > 0 ? open : rows.slice(-1);
  const result: Array<{ row: T; added: number }> = [];
  let left = fin(quantity);
  takers.forEach((row, index) => {
    if (!left.isPositive()) return;
    const room = fin(row.requestedQty || 0).subtract(row.orderedQty || 0);
    const take = index === takers.length - 1 ? left : (room.isPositive() ? (room.lessThan(left) ? room : left) : fin(0));
    if (!take.isPositive()) return;
    result.push({ row, added: take.toNumber() });
    left = left.subtract(take);
  });
  return result;
}

/**
 * v11 phase 7.2 (TD-1391): the ordered quantity of the rows of `itemIds`, rebuilt from the live order lines. A row closed
 * before the rebuild keeps what it had ordered (at most what its own linked live orders, and all live orders, still hold),
 * so its closure stays readable by the legacy rule too (and gets the `closed` flag), and the rest is spread over the open
 * rows of the item (`spreadOrderedQuantity`). Returns the rows with `orderedQty` set (others unchanged) and which of them
 * were closed.
 */
export function rebuildOrderedQuantities<T extends RequisitionQuantityRow & { linkedDocumentIds?: number[] }>(
  rows: readonly T[],
  itemIds: ReadonlySet<number>,
  orderedLines: ReadonlyArray<{ itemId: number | null; quantity: DecimalValue | null; documentId?: number | null }>,
): { rows: T[]; closed: boolean[] } {
  const closed = rows.map(row => isClosedRequisitionRow(row));
  const totals = new Map<number, FinancialDecimal>();
  for (const id of itemIds) totals.set(id, fin(0));
  for (const line of orderedLines) {
    const id = Number(line.itemId);
    if (totals.has(id)) totals.set(id, totals.get(id)!.add(line.quantity ?? 0));
  }
  // a legacy closure (no flag) is written as the flag, so a later quantity can no longer reopen the row
  const out = rows.map((row, index) => (totals.has(Number(row.itemId))
    ? { ...row, orderedQty: 0, ...(closed[index] ? { closed: true } : {}) } : row));
  for (const [itemId, total] of totals) {
    let left = total;
    const indexes = out.flatMap((row, index) => (Number(row.itemId) === itemId ? [index] : []));
    for (const index of indexes) {
      if (!closed[index]) continue;
      let keep = fin(rows[index].orderedQty || 0);
      // review of #423: a closed row keeps only what its own live orders still hold, so voiding the order that held its
      // quantity frees it instead of taking it from an open row; lines without a document id cannot tell and do not cap
      const links = Array.isArray(rows[index].linkedDocumentIds) ? rows[index].linkedDocumentIds!.map(Number) : null;
      if (links && orderedLines.every(line => line.documentId != null)) {
        const own = orderedLines
          .filter(line => Number(line.itemId) === itemId && links.includes(Number(line.documentId)))
          .reduce((sum, line) => sum.add(line.quantity ?? 0), fin(0));
        if (own.lessThan(keep)) keep = own;
      }
      if (left.lessThan(keep)) keep = left;
      out[index].orderedQty = keep.toNumber();
      left = left.subtract(keep);
    }
    const itemRows = indexes.map(index => out[index]);
    for (const { row, added } of spreadOrderedQuantity(itemRows, left.toString(), (_row, i) => closed[indexes[i]])) {
      row.orderedQty = fin(row.orderedQty || 0).add(added).toNumber();
    }
  }
  return { rows: out, closed };
}
