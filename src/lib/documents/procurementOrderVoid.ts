import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal';

/**
 * v10.0.93 (TD-1195، آزمون راهنما roles-b باگ ۲): مقدار سفارش‌شده ردیف‌های درخواست خرید پس از ابطال سفارشی که هنوز تحویل
 * نشده، از سطرهای فعال سفارش‌های زنده همان درخواست دوباره ساخته می‌شود (همان قاعده ت۹ برای مقدار دریافتی، TD-912). پیش‌تر
 * ابطال سفارش پیش‌نویس مقدار سفارش‌شده ردیف را نگه می‌داشت: فرم تقسیم سفارش «تطابق کامل» نشان می‌داد و سفارش دوباره همان
 * مقدار ۴۲۲ «دلیل سفارش بیش از درخواست» می‌گرفت. فقط کالاهای سفارش باطل‌شده بازسازی می‌شوند؛ مقدار هر کالا میان ردیف‌های
 * همان کالا به ترتیب پر می‌شود (هر ردیف تا مقدار درخواستش، مازاد به ردیف آخر) و پیوند ردیف‌ها به سند باطل‌شده برداشته می‌شود.
 */
export interface OrderedRow {
  itemId?: number | null;
  requestedQty: number;
  orderedQty?: number;
  remainingQty?: number;
  status?: string;
  closed?: boolean;
  linkedDocumentIds?: number[];
}

export function rebuildOrderedRows<T extends OrderedRow>(
  rows: T[],
  liveLines: Array<{ itemId: number | null; quantity: DecimalValue | null }>,
  itemIds: ReadonlySet<number>,
  voidedDocumentId: number,
): T[] {
  const left = new Map<number, FinancialDecimal>();
  for (const id of itemIds) left.set(id, fin(0));
  for (const line of liveLines) {
    const id = Number(line.itemId);
    if (left.has(id)) left.set(id, left.get(id)!.add(line.quantity ?? 0));
  }
  const lastRow = new Map<number, number>();
  rows.forEach((row, index) => { if (left.has(Number(row.itemId))) lastRow.set(Number(row.itemId), index); });

  return rows.map((row, index) => {
    const linked = Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.some(id => Number(id) === voidedDocumentId)
      ? row.linkedDocumentIds.filter(id => Number(id) !== voidedDocumentId) : row.linkedDocumentIds;
    const id = Number(row.itemId);
    const total = left.get(id);
    if (!total) return linked === row.linkedDocumentIds ? row : { ...row, linkedDocumentIds: linked };
    const requested = fin(row.requestedQty || 0);
    const share = lastRow.get(id) === index || total.lessThan(requested) ? total : requested;
    left.set(id, total.subtract(share));
    const remaining = requested.subtract(share);
    const keepStatus = row.closed === true || row.status === 'received';
    return {
      ...row,
      linkedDocumentIds: linked,
      orderedQty: share.toNumber(),
      remainingQty: remaining.isPositive() ? remaining.toNumber() : 0,
      status: keepStatus ? row.status : (remaining.isPositive() ? 'pending' : 'ordered'),
    };
  });
}
