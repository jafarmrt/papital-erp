/**
 * V9-1.3: ابزار مشترک اعتبارسنجی و سقف‌گذاری پارامترهای صفحه‌بندی
 * جلوگیری از NaN (حذف LIMIT و dump کل جدول) و سقف حداکثر ۱۰۰۰ ردیف در هر درخواست.
 * (سقف ۱۰۰۰ برای سازگاری با فراخوانی‌های موجود فرانت‌اند مانند لیست‌های انتخابی بزرگ)
 */
export const MAX_PAGE_LIMIT = 1000;

export interface ParsedPagination {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  query: Record<string, unknown>,
  defaults?: { page?: number; limit?: number }
): ParsedPagination {
  const rawPage = Number.parseInt(String(query.page ?? ''), 10);
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : (defaults?.page ?? 1);
  let limit: number;
  if (Number.isFinite(rawLimit) && rawLimit >= 0) {
    limit = rawLimit;
  } else {
    limit = defaults?.limit ?? 50;
  }
  if (limit > MAX_PAGE_LIMIT) {
    limit = MAX_PAGE_LIMIT;
  }

  return { page, limit, offset: (page - 1) * limit };
}
