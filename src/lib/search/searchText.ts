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

/**
 * TD-1321 (review of v10.2.14): a compact search for names, the rule the personnel page used in the browser before its list
 * was paged (`normalizePersianText`): on top of `normalizeSearchText`, «ة» and «ۀ» are «ه», and spaces, the zero-width
 * non-joiner and other zero-width marks, «-» and «_» are dropped, so «علی زاده», «علیزاده» and «علی‌زاده» are one search.
 * `compactFoldedSearchSql` applies the same rule to a column.
 */
export const SEARCH_COMPACT_FOLD_FROM = 'ةۀ';
export const SEARCH_COMPACT_FOLD_TO = 'هه';
export const SEARCH_COMPACT_DROP = ' \t\n\r\u00a0\u200b\u200c\u200d\u200e\u200f\ufeff_-';
const COMPACT_DROP = new RegExp(`[${SEARCH_COMPACT_DROP}]+`, 'g');
const COMPACT_FOLD = new Map<string, string>(
  Array.from(SEARCH_COMPACT_FOLD_FROM).map((ch, i) => [ch, Array.from(SEARCH_COMPACT_FOLD_TO)[i]]),
);

export function compactSearchText(value: unknown): string {
  return Array.from(normalizeSearchText(value), ch => COMPACT_FOLD.get(ch) ?? ch).join('').replace(COMPACT_DROP, '');
}
