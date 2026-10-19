/**
 * V9-1.3: ابزار مشترک اعتبارسنجی و سقف‌گذاری پارامترهای صفحه‌بندی
 * جلوگیری از NaN (حذف LIMIT و dump کل جدول) و سقف حداکثر ۱۰۰۰ ردیف در هر درخواست.
 * (سقف ۱۰۰۰ برای سازگاری با فراخوانی‌های موجود فرانت‌اند مانند لیست‌های انتخابی بزرگ)
 */
export const MAX_PAGE_LIMIT = 1000;

/** The highest page number read; a larger one reads this page (an empty page), never an OFFSET the database refuses */
export const MAX_PAGE_NUMBER = 1_000_000;

/**
 * v10.2.0: a page number from the query string. A missing, malformed, zero or negative page is the first page; a page
 * above MAX_PAGE_NUMBER is that page. Before, `GET /items?page=-1` sent a negative OFFSET and answered 500.
 */
export function parsePageNumber(raw: unknown, fallback = 1): number {
  const page = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.min(page, MAX_PAGE_NUMBER);
}

export interface ParsedPagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  query: Record<string, unknown>,
  defaults?: { page?: number; limit?: number; maxLimit?: number }
): ParsedPagination {
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);

  const page = parsePageNumber(query.page, defaults?.page ?? 1);
  let limit: number;
  // OBS-R2-100: `limit=0` (or negative) is the default page, never «no limit» (a whole-table read) or an empty page
  if (Number.isFinite(rawLimit) && rawLimit > 0) {
    limit = rawLimit;
  } else {
    limit = defaults?.limit ?? 50;
  }
  // TD-1320: a list whose service reads at most `maxLimit` rows pages with that cap too, so page 2 starts where page 1 ended
  // a cap that is not a whole number above zero (0, negative, NaN) is a caller's mistake: the general cap holds
  const maxLimit = defaults?.maxLimit;
  const cap = maxLimit !== undefined && Number.isFinite(maxLimit) && maxLimit >= 1
    ? Math.min(MAX_PAGE_LIMIT, Math.floor(maxLimit))
    : MAX_PAGE_LIMIT;
  if (limit > cap) {
    limit = cap;
  }

  return { page, limit, offset: (page - 1) * limit };
}

/** فهرست انتخاب (مدل مجوز ت۱۰): بی سقف وقتی limit نیامده، صفر یا نامعتبر است؛ وگرنه حداکثر MAX_PICK_LIST_LIMIT ردیف */
export const MAX_PICK_LIST_LIMIT = 5000;

export function parsePickListLimit(raw: unknown, maxLimit: number = MAX_PICK_LIST_LIMIT): number | undefined {
  const limit = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  // TD-1321: a picker that asks one row above its cap (to know there are more) passes that as `maxLimit`
  return Math.min(limit, maxLimit);
}
