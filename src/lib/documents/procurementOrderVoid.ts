import { fin, type DecimalValue } from '../financialDecimal';
import { rebuildOrderedQuantities } from '../procurement/requisitionRows';

/**
 * v10.0.99 (TD-1195، آزمون راهنما roles-b باگ ۲): مقدار سفارش‌شده ردیف‌های درخواست خرید پس از ابطال سفارشی که هنوز تحویل
 * نشده، از سطرهای فعال سفارش‌های زنده همان درخواست دوباره ساخته می‌شود (همان قاعده ت۹ برای مقدار دریافتی، TD-912). پیش‌تر
 * ابطال سفارش پیش‌نویس مقدار سفارش‌شده ردیف را نگه می‌داشت: فرم تقسیم سفارش «تطابق کامل» نشان می‌داد و سفارش دوباره همان
 * مقدار ۴۲۲ «دلیل سفارش بیش از درخواست» می‌گرفت. فقط کالاهای سفارش باطل‌شده بازسازی می‌شوند؛ مقدار هر کالا میان ردیف‌های
 * همان کالا به ترتیب پر می‌شود (هر ردیف تا مقدار درخواستش، مازاد به ردیف آخر) و پیوند ردیف‌ها به سند باطل‌شده برداشته می‌شود.
 * v11 فاز ۷.۲ (TD-1391): ردیف بسته (با نشان، یادداشت بستن یا شکل قدیمی) بسته می‌ماند و مقدار سفارشش را نگه می‌دارد.
 */
export interface OrderedRow {
  itemId?: number | null;
  requestedQty: number;
  orderedQty?: number;
  remainingQty?: number;
  status?: string;
  closed?: boolean;
  closureNote?: string;
  linkedDocumentIds?: number[];
}

export function rebuildOrderedRows<T extends OrderedRow>(
  rows: T[],
  liveLines: Array<{ itemId: number | null; quantity: DecimalValue | null }>,
  itemIds: ReadonlySet<number>,
  voidedDocumentId: number,
): T[] {
  // v11 phase 7.2 (TD-1391): the same rule as the procurement rebuild (`rebuildOrderedQuantities`); a closed row, the
  // legacy one without a flag included, keeps its closure and status
  const rebuilt = rebuildOrderedQuantities(rows, itemIds, liveLines);
  return rows.map((row, index) => {
    const linked = Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.some(id => Number(id) === voidedDocumentId)
      ? row.linkedDocumentIds.filter(id => Number(id) !== voidedDocumentId) : row.linkedDocumentIds;
    if (!itemIds.has(Number(row.itemId))) return linked === row.linkedDocumentIds ? row : { ...row, linkedDocumentIds: linked };
    const next = rebuilt.rows[index];
    const remaining = fin(row.requestedQty || 0).subtract(next.orderedQty || 0);
    const closed = rebuilt.closed[index];
    const keepStatus = closed || row.status === 'received';
    return {
      ...next,
      linkedDocumentIds: linked,
      remainingQty: closed || !remaining.isPositive() ? 0 : remaining.toNumber(),
      status: keepStatus ? row.status : (remaining.isPositive() ? 'pending' : 'ordered'),
    };
  });
}
