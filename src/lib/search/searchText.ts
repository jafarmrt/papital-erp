/**
 * v9.0.291 (TD-675، B16-11): یکسان‌سازی متن جست‌وجو، مشترک جست‌وجوی سراسری سرور و `SearchableSelect` مرورگر: حروف کوچک،
 * «ي»، «ى» و «ك» عربی به «ی» و «ک» فارسی، ارقام فارسی و عربی به لاتین. `SEARCH_FOLD_FROM` / `SEARCH_FOLD_TO` همین نگاشت برای
 * `translate()` در PostgreSQL است، پس متن ذخیره‌شده و متن جست‌وجو یک‌جور سنجیده می‌شوند.
 */
export const SEARCH_FOLD_FROM = 'يكى۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
export const SEARCH_FOLD_TO = 'یکی01234567890123456789';

const FOLD = new Map<string, string>(Array.from(SEARCH_FOLD_FROM).map((ch, i) => [ch, Array.from(SEARCH_FOLD_TO)[i]]));

export function normalizeSearchText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return Array.from(String(value).toLowerCase(), ch => FOLD.get(ch) ?? ch).join('').trim();
}
