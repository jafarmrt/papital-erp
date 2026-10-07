/**
 * v9.0.290 (TD-787، یافته B08-18): `GET /documents` همیشه یک صفحه برمی‌گرداند (پیش‌فرض ۵۰ سند) و کل فهرست فقط با
 * `export=true`. پیش‌تر درخواست بی `page` و `limit` همه اسناد را با ردیف‌ها و تسویه‌هایشان می‌فرستاد (۲۰٬۰۵۰ سند: ۴٫۹ تا
 * ۶٫۵ ثانیه و ۲۷٫۹ مگابایت). سرور و زبانه‌های «سوابق دوره‌ها» و «انتقال بین انبارها» همین اندازه صفحه را به کار می‌برند.
 */
export const DOCUMENT_LIST_PAGE_SIZE = 50;

/** نشانی یک صفحه از اسناد یک نوع */
export function typedDocumentListUrl(type: string, page: number): string {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return `/documents?type=${encodeURIComponent(type)}&page=${safePage}&limit=${DOCUMENT_LIST_PAGE_SIZE}`;
}

export interface DocumentListPage<T> {
  rows: T[];
  total: number;
  totalPages: number;
}

/** صفحه پاسخ `{ data, total, totalPages }` (پاسخ آرایه‌ای قدیمی: همه در یک صفحه) */
export function documentListPage<T = Record<string, unknown>>(res: unknown): DocumentListPage<T> {
  if (Array.isArray(res)) return { rows: res as T[], total: res.length, totalPages: 1 };
  const body = res && typeof res === 'object' ? res as { data?: unknown; total?: unknown; totalPages?: unknown } : {};
  const rows = Array.isArray(body.data) ? body.data as T[] : [];
  const total = Number(body.total);
  const totalPages = Number(body.totalPages);
  return {
    rows,
    total: Number.isFinite(total) && total >= rows.length ? total : rows.length,
    totalPages: Number.isFinite(totalPages) && totalPages >= 1 ? Math.floor(totalPages) : 1,
  };
}
