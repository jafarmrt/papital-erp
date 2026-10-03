import { toEnglishDigits } from "./persianNumber.js";
import { jalaliToGregorian } from "./dateUtils.js";

/**
 * v7.0.131 (TD-232): تاریخ‌های کاری در پایگاه‌داده میلادی ISO (`YYYY-MM-DD`) ذخیره می‌شوند و کاربر همه‌جا شمسی
 * می‌بیند و وارد می‌کند (تصمیم مالک محصول). این فایل تنها مبدل مشترک سرور و مرورگر است:
 *   toStorageDate   — هر ورودی (شمسی یا میلادی، `-` یا `/`، ارقام فارسی/عربی، با ساعت اختیاری) ← ISO؛ نامعتبر ← null
 *   isoToJalaliDate — تاریخ ذخیره‌شده (یا شمسی) ← `YYYY/MM/DD` شمسی با ارقام لاتین، برای DatePicker و مقایسه
 * سال شمسی ۱۳۰۰ تا ۱۵۰۰ و سال میلادی ۱۹۰۰ تا ۲۱۹۹ پذیرفته می‌شود. همتای SQL: `erp_text_date_to_iso` (مهاجرت 0038).
 * ساعت یا منطقه زمانی همراه تاریخ نادیده گرفته می‌شود (تاریخ همان‌طور که نوشته شده).
 */

const DATE_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

export const JALALI_MIN_YEAR = 1300;
export const JALALI_MAX_YEAR = 1500;
const GREGORIAN_MIN_YEAR = 1900;
const GREGORIAN_MAX_YEAR = 2199;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** میلادی ← شمسی با همان الگوریتم ۳۳ ساله‌ای که jalaliToGregorian دارد (برعکس آن) */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gDaysBeforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) + gd + gDaysBeforeMonth[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
  return [jy, jm, jd];
}

function isValidGregorian(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidJalali(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > (m <= 6 ? 31 : 30)) return false;
  const [gy, gm, gd] = jalaliToGregorian(y, m, d);
  const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
  return ry === y && rm === m && rd === d; // ۳۰ اسفند سال غیرکبیسه اینجا رد می‌شود
}

/** هر تاریخ ورودی ← ISO میلادی `YYYY-MM-DD`؛ خالی ← ''؛ نامعتبر یا خارج از بازه ← null */
export function toStorageDate(value: unknown): string | null {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = toEnglishDigits(String(value)).trim();
  if (!s) return '';
  const m = DATE_PATTERN.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= GREGORIAN_MIN_YEAR && y <= GREGORIAN_MAX_YEAR) {
    return isValidGregorian(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  if (y >= JALALI_MIN_YEAR && y <= JALALI_MAX_YEAR) {
    if (!isValidJalali(y, mo, d)) return null;
    const [gy, gm, gd] = jalaliToGregorian(y, mo, d);
    return `${gy}-${pad2(gm)}-${pad2(gd)}`;
  }
  return null;
}

/** تاریخ ذخیره‌شده یا هر ورودی معتبر ← شمسی `YYYY/MM/DD` با ارقام لاتین؛ خالی یا نامعتبر ← '' */
export function isoToJalaliDate(value: unknown): string {
  const iso = toStorageDate(value);
  if (!iso) return '';
  const [gy, gm, gd] = iso.split('-').map(Number);
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

/** آیا مقدار دقیقاً به قالب ذخیره (`YYYY-MM-DD` میلادی معتبر) است؟ */
export function isStorageDate(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && toStorageDate(value) === value;
}
