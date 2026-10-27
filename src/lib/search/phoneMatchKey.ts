import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * v8.0.40 (TD-296): کلید تطبیق تلفن مشتری. ارقام فارسی و عربی لاتین می‌شوند، هر نویسه غیررقمی حذف می‌شود و از شماره‌های
 * ده‌رقمی یا بلندتر فقط ده رقم آخر می‌ماند؛ پس ۰۹۱۲…، ‎+۹۸۹۱۲…، ۰۰۹۸۹۱۲…، ۹۱۲… و «۰۹۱۲ ۷۴۱ ۲۰۳۲» یک کلید دارند. شماره
 * کوتاه‌تر از ده رقم با همه ارقامش تطبیق می‌شود. خالی یعنی تلفنی برای تطبیق نیست.
 */
export function phoneMatchKey(phone: unknown): string {
  const digits = String(phone ?? '')
    .replace(/[۰-۹]/g, d => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** همان کلید روی ستون تلفن در SQL (فقط برای خواندن و مقایسه) */
export function phoneMatchKeySql(column: AnyPgColumn): SQL<string> {
  const digits = sql`regexp_replace(translate(coalesce(${column}, ''), ${PERSIAN_DIGITS + ARABIC_DIGITS}, ${'01234567890123456789'}), '[^0-9]', '', 'g')`;
  return sql<string>`(CASE WHEN length(${digits}) >= 10 THEN right(${digits}, 10) ELSE ${digits} END)`;
}

/** OBS-R2-99: the fewest digits a search text needs to be matched as a phone number */
export const PHONE_SEARCH_MIN_DIGITS = 4;

/**
 * OBS-R2-99: the TD-296 phone key of a search text that looks like a phone number (only digits, spaces, «+», «-», «(»,
 * «)» and at least `PHONE_SEARCH_MIN_DIGITS` digits), without leading zeros so a part of the number matches inside the
 * stored key («0912 741» finds +98 912 741 2032); else null.
 */
export function phoneSearchKey(q: string): string | null {
  if (!/^[\d۰-۹٠-٩\s+\-()]+$/.test(q)) return null;
  const key = phoneMatchKey(q).replace(/^0+/, '');
  return key.length >= PHONE_SEARCH_MIN_DIGITS ? key : null;
}
