import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizePersianText(str: string | null | undefined): string {
  if (!str || typeof str === 'object') return '';
  try {
    return String(str)
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ة/g, 'ه')
      .replace(/ۀ/g, 'ه')
      .replace(/[\u200c\u200b\u200e\u200f\s\-_]+/g, ' ')
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeStrategyTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle || typeof rawTitle === 'object') return '';
  try {
    let clean = String(rawTitle).trim();
    if (!clean) return '';
    while (
      clean.startsWith('قیمت - ') ||
      clean.startsWith('قیمت-') ||
      clean.startsWith('قیمت: ') ||
      clean.startsWith('قیمت ') ||
      clean.startsWith('Price - ') ||
      clean.startsWith('Price-') ||
      clean.startsWith('Price: ') ||
      clean.startsWith('Price ')
    ) {
      if (clean.startsWith('قیمت - ')) clean = clean.substring(7).trim();
      else if (clean.startsWith('قیمت-')) clean = clean.substring(5).trim();
      else if (clean.startsWith('قیمت: ')) clean = clean.substring(6).trim();
      else if (clean.startsWith('قیمت ')) clean = clean.substring(5).trim();
      else if (clean.startsWith('Price - ')) clean = clean.substring(8).trim();
      else if (clean.startsWith('Price-')) clean = clean.substring(6).trim();
      else if (clean.startsWith('Price: ')) clean = clean.substring(7).trim();
      else if (clean.startsWith('Price ')) clean = clean.substring(6).trim();
    }
    return clean || String(rawTitle).trim();
  } catch {
    return '';
  }
}

export function getStrategyCanonicalKey(rawTitle: string | null | undefined): string {
  const title = normalizeStrategyTitle(rawTitle);
  return normalizePersianText(title);
}

export function formatStrategyDisplayTitle(rawTitle: string | null | undefined): string {
  const clean = normalizeStrategyTitle(rawTitle);
  return clean || 'عمومی';
}

export function toPersianDigits(val: string | number | null | undefined): string {
  if (val === null || val === undefined || typeof val === 'object') return '';
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  try {
    return String(val).replace(/[0-9]/g, (w) => farsiDigits[parseInt(w)]);
  } catch {
    return '';
  }
}

export function toEnglishDigits(str: string | number | null | undefined): string {
  if (str === null || str === undefined || typeof str === 'object') return '';
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  try {
    const s = String(str);
    return s
      .replace(/[۰-۹]/g, (w) => String(faDigits.indexOf(w)))
      .replace(/[٠-٩]/g, (w) => String(arDigits.indexOf(w)));
  } catch {
    return '';
  }
}

export function normalizePersianDate(str: string | null | undefined): string {
  if (!str || typeof str === 'object') return '';
  try {
    let s = toEnglishDigits(String(str)).trim();
    s = s.replace(/-/g, '/');
    const parts = s.split('/');
    if (parts.length === 3) {
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return `${y}/${m}/${d}`;
    }
    return s;
  } catch {
    return '';
  }
}

/**
 * V10-1.3 — ساعت توافقی واحد (کلاینت)
 * ====================================
 * منطقه زمانی نمایش از تنظیمات سامانه (`display_timezone`) خوانده و به‌صورت
 * ماژولی در این فایل ست می‌شود (TimezoneProvider روی App اتصال می‌زند).
 * پیش‌فرض: Asia/Tehran مطابق توافق کاربر.
 */
let _displayTimezone = 'Asia/Tehran';

export function setDisplayTimezone(tz: string | null | undefined): void {
  if (typeof tz === 'string' && tz.trim() && !/[^\w\/+\-]/.test(tz.trim())) {
    _displayTimezone = tz.trim();
  }
}

export function getDisplayTimezoneClient(): string {
  return _displayTimezone;
}

/**Intl options با timeZone تزریق‌شده از تنظیمات */
function tzOptions(base: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return { ...base, timeZone: _displayTimezone };
}

export function getTodayJalaliDate(): string {
  try {
    const today = new Date();
    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })).format(today);
    return toEnglishDigits(formatted);
  } catch (e) {
    return '1405/06/06';
  }
}

export function getPastJalaliDate(daysAgo: number = 30): string {
  try {
    const past = new Date();
    past.setDate(past.getDate() - daysAgo);
    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })).format(past);
    return toEnglishDigits(formatted);
  } catch (e) {
    return '';
  }
}

export function getFutureJalaliDate(daysAhead: number = 30): string {
  try {
    const future = new Date();
    future.setDate(future.getDate() + daysAhead);
    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })).format(future);
    return toEnglishDigits(formatted);
  } catch (e) {
    return '';
  }
}

export function cleanDecimalString(val: number | string | null | undefined, maxDecimals: number = 1): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const num = typeof val === 'number' ? val : Number(toEnglishDigits(String(val)).replace(/,/g, ''));
    if (isNaN(num)) return '';
    if (num === 0) return '0';
    const factor = Math.pow(10, maxDecimals);
    const rounded = Math.round(num * factor) / factor;
    return String(rounded);
  } catch {
    return '';
  }
}

export function formatPersianPrice(num: number | string | null | undefined, currency?: string, maxDecimals: number = 1): string {
  if (num === null || num === undefined || num === '' || typeof num === 'object') {
    const zero = '۰';
    return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
  }
  try {
    const n = typeof num === 'number' ? num : Number(toEnglishDigits(String(num)).replace(/,/g, ''));
    if (isNaN(n)) {
      const zero = '۰';
      return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
    }
    const factor = Math.pow(10, maxDecimals);
    const rounded = Math.round(n * factor) / factor;
    // Standard format with thousands separator and at most 1 decimal place (0 if integer)
    const formatted = rounded.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: 0
    });
    const persianVal = toPersianDigits(formatted);
    return currency ? `${persianVal} ${formatCurrencyLabel(currency)}` : persianVal;
  } catch {
    const zero = '۰';
    return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
  }
}

export function formatPersianNumber(val: number | string | null | undefined, maxDecimals: number = 1): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  
  if (typeof val === 'number') {
    if (isNaN(val)) return '';
    const factor = Math.pow(10, maxDecimals);
    const rounded = Math.round(val * factor) / factor;
    const formatted = rounded.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: 0
    });
    return toPersianDigits(formatted);
  }
  
  try {
    const rawStr = String(val).trim();
    if (!rawStr) return '';

    // If it's a date or code with slashes, colons, or mixed letters, keep verbatim with Persian digits
    if (rawStr.includes('/') || rawStr.includes(':') || (rawStr.includes('-') && !/^-?\d+(\.\d+)?$/.test(rawStr)) || /[a-zA-Z]/.test(rawStr)) {
      return toPersianDigits(rawStr);
    }

    const englishStr = toEnglishDigits(rawStr).replace(/,/g, '');
    const num = Number(englishStr);
    if (!isNaN(num)) {
      const factor = Math.pow(10, maxDecimals);
      const rounded = Math.round(num * factor) / factor;
      const formatted = rounded.toLocaleString('en-US', {
        maximumFractionDigits: maxDecimals,
        minimumFractionDigits: 0
      });
      return toPersianDigits(formatted);
    }

    return toPersianDigits(rawStr);
  } catch {
    return '';
  }
}

/**
 * فرمتر شناسه‌ها (کد پرسنلی، کد ملی، تلفن، شماره سند و...) — فقط ارقام فارسی
 * بدون هیچ جداکننده سه‌رقمی، چون این فیلدها مقدار عددی/ریالی نیستند.
 */
export function formatPersianCode(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const rawStr = String(val).trim();
    if (!rawStr) return '';
    return toPersianDigits(toEnglishDigits(rawStr));
  } catch {
    return '';
  }
}

export function formatCurrencyLabel(c?: string): string {
  if (!c || c === 'IRR' || c === 'ریال') return 'ریال';
  if (c === 'USD') return 'دلار';
  if (c === 'EUR') return 'یورو';
  if (c === 'AED') return 'درهم';
  if (c === 'GBP') return 'پوند';
  return c;
}

export function parseQuantityOrTime(val: string | number | null | undefined): number {
  if (val === null || val === undefined || typeof val === 'object') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  try {
    const str = toEnglishDigits(String(val)).trim();
    if (str.includes(':')) {
      const parts = str.split(':');
      const hours = parseFloat(parts[0]) || 0;
      const minutes = parseFloat(parts[1]) || 0;
      return hours + (minutes / 60);
    }
    const num = parseFloat(str.replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  } catch {
    return 0;
  }
}

export function formatQuantityOrTime(val: number | string | null | undefined, unit?: string): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '۰';
  try {
    const parsed = typeof val === 'number' ? val : parseQuantityOrTime(val);
    if (isNaN(parsed) || parsed <= 0) return '۰';
    if (unit === 'ساعت') {
      const totalMinutes = Math.round(parsed * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (m === 0) return `${toPersianDigits(h)} ساعت`;
      return `${toPersianDigits(h)}:${String(m).padStart(2, '0').replace(/[0-9]/g, w => ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'][parseInt(w)])} (${toPersianDigits(h)} ساعت و ${toPersianDigits(m)} دقیقه)`;
    }
    return formatPersianNumber(parsed, 1);
  } catch {
    return '۰';
  }
}

/**
 * تشخیص رشته‌های میلادی بدون پسوند منطقه‌زمانی (مثل `2026-08-28T15:30:00` که
 * businessClock به‌صورت ساعت محلیِ منطقه توافقی می‌نویسد). این مقادیر نباید با
 * `new Date()` (تفسیر وابسته به مرورگر) پارس شوند — بخش‌های عددی مستقیم جلالی می‌شوند.
 * اگر رشته Z یا آفست صریح داشته باشد null برمی‌گردد تا مسیر عادی (Intl با display TZ) برود.
 */
function formatWallClockGregorian(englishStr: string, withTime: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(englishStr.trim());
  if (!m) return null;
  if (/[zZ]$/.test(englishStr) || /[+-]\d{2}:?\d{2}$/.test(englishStr)) return null;
  const [, Y, M, D, H, MI, S] = m;
  const utc = new Date(Date.UTC(Number(Y), Number(M) - 1, Number(D), Number(H || 0), Number(MI || 0), Number(S || 0)));
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', ...opts }).format(utc);
}

export function formatPersianDate(dateInput: any, options?: { englishDigits?: boolean }): string {
  if (!dateInput) return '-';
  try {
    // If it's a Date object
    if (dateInput instanceof Date) {
      if (isNaN(dateInput.getTime())) return '-';
      const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })).format(dateInput);
      return options?.englishDigits ? toEnglishDigits(formatted) : toPersianDigits(formatted);
    }

    // If it's a DateObject or object with toDate/format/year
    if (typeof dateInput === 'object') {
      if (typeof dateInput.toDate === 'function') {
        const d = dateInput.toDate();
        if (d instanceof Date && !isNaN(d.getTime())) {
          return formatPersianDate(d, options);
        }
      }
      if (typeof dateInput.format === 'function') {
        const fmt = dateInput.format('YYYY/MM/DD');
        return options?.englishDigits ? toEnglishDigits(fmt) : toPersianDigits(fmt);
      }
      if (dateInput.year && dateInput.month && dateInput.day) {
        const y = String(dateInput.year);
        const m = String(dateInput.month).padStart(2, '0');
        const d = String(dateInput.day).padStart(2, '0');
        const res = `${y}/${m}/${d}`;
        return options?.englishDigits ? res : toPersianDigits(res);
      }
      return '-';
    }

    if (typeof dateInput === 'number') {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '-';
      return formatPersianDate(d, options);
    }

    const rawStr = String(dateInput).trim();
    if (!rawStr) return '-';
    const englishStr = toEnglishDigits(rawStr);

    // If it's already a Jalali date string (starts with 13xx, 14xx, 15xx)
    if (/^1[345]\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(englishStr)) {
      const normalized = englishStr.split(' ')[0].replace(/-/g, '/');
      const parts = normalized.split('/');
      if (parts.length >= 3) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        const result = `${y}/${m}/${d}`;
        return options?.englishDigits ? result : toPersianDigits(result);
      }
      return options?.englishDigits ? normalized : toPersianDigits(normalized);
    }

    // رشته میلادی بدون TZ = ساعت محلیِ منطقه توافقی — بدون تفسیر مرورگر
    const wall = formatWallClockGregorian(englishStr, false);
    if (wall) return options?.englishDigits ? toEnglishDigits(wall) : toPersianDigits(wall);

    // Gregorian string or Date object
    const cleanStr = englishStr.replace(' ', 'T');
    let d = new Date(cleanStr);
    if (isNaN(d.getTime())) {
      d = new Date(englishStr);
    }

    if (isNaN(d.getTime())) {
      return options?.englishDigits ? englishStr : toPersianDigits(rawStr);
    }

    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })).format(d);

    return options?.englishDigits ? toEnglishDigits(formatted) : toPersianDigits(formatted);
  } catch (e) {
    return '-';
  }
}

/**
 * V10-1.3: استانداردسازی خروجی DatePicker به رشته تاریخ (Jalali `Y/M/D`
 * یا ISO `YYYY-MM-DD`) — رفع off-by-one: Date/DateObject دیگر از
 * toISOString().split('T') عبور نمی‌کنند (UTC-midnight shift)؛ بخش‌های
 * تاریخ مستقیماً در منطقه نمایش استخراج می‌شوند.
 */
export function extractDateString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return toEnglishDigits(val.trim());
  if (typeof val === 'number') return String(val);
  try {
    if (typeof val === 'object') {
      if (typeof val.format === 'function') {
        return toEnglishDigits(val.format('YYYY/MM/DD'));
      }
      const asParts = (d: Date): string => {
        if (!(d instanceof Date) || isNaN(d.getTime())) return '';
        // قسمت‌های میلادی مستقیم در TZ توافقی — بدون UTC shift
        return new Intl.DateTimeFormat('en-CA', tzOptions({
          year: 'numeric', month: '2-digit', day: '2-digit'
        })).format(d);
      };
      if (typeof val.toDate === 'function') {
        return asParts(val.toDate());
      }
      if (val instanceof Date && !isNaN(val.getTime())) {
        return asParts(val);
      }
      if (val.year && val.month && val.day) {
        const y = String(val.year);
        const m = String(val.month.number || val.month).padStart(2, '0');
        const d = String(val.day.number || val.day).padStart(2, '0');
        return `${y}/${m}/${d}`;
      }
      return '';
    }
    return toEnglishDigits(String(val));
  } catch {
    return '';
  }
}

export function formatPersianDateTime(dateInput: any): string {
  if (!dateInput) return '-';
  try {
    let d: Date | null = null;
    if (dateInput instanceof Date) {
      d = dateInput;
    } else if (typeof dateInput === 'number') {
      d = new Date(dateInput);
    } else if (typeof dateInput === 'object') {
      if (typeof dateInput.toDate === 'function') {
        const converted = dateInput.toDate();
        if (converted instanceof Date && !isNaN(converted.getTime())) {
          d = converted;
        }
      }
      if (!d && dateInput.year && dateInput.month && dateInput.day) {
        return formatPersianDate(dateInput);
      }
      if (!d) return '-';
    } else {
      const rawStr = String(dateInput).trim();
      const englishStr = toEnglishDigits(rawStr);
      if (/^1[345]\d{2}/.test(englishStr)) {
        return toPersianDigits(rawStr);
      }
      // رشته میلادی بدون TZ = ساعت محلیِ منطقه توافقی — بدون تفسیر وابسته به مرورگر
      const wall = formatWallClockGregorian(englishStr, true);
      if (wall) return toPersianDigits(wall);
      const cleanStr = englishStr.replace(' ', 'T');
      d = new Date(cleanStr);
      if (isNaN(d.getTime())) {
        d = new Date(englishStr);
      }
    }

    if (!d || isNaN(d.getTime())) return '-';

    const formattedDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })).format(d);

    return toPersianDigits(formattedDate);
  } catch (e) {
    return '-';
  }
}

/**
 * Financial rounding utility to eliminate IEEE 754 floating-point drift
 */
export function roundFinancial(num: number | string | null | undefined, decimals: number = 4): number {
  if (num === null || num === undefined || typeof num === 'object') return 0;
  const n = typeof num === 'number' ? num : parseFloat(String(num));
  if (isNaN(n) || !isFinite(n)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

/**
 * High-precision financial addition
 */
export function safeFinancialAdd(a: number | string | null | undefined, b: number | string | null | undefined, decimals: number = 4): number {
  const valA = (a === null || a === undefined || typeof a === 'object') ? 0 : a;
  const valB = (b === null || b === undefined || typeof b === 'object') ? 0 : b;
  return roundFinancial(Number(valA || 0) + Number(valB || 0), decimals);
}

/**
 * High-precision financial multiplication
 */
export function safeFinancialMultiply(a: number | string | null | undefined, b: number | string | null | undefined, decimals: number = 4): number {
  const valA = (a === null || a === undefined || typeof a === 'object') ? 0 : a;
  const valB = (b === null || b === undefined || typeof b === 'object') ? 0 : b;
  return roundFinancial(Number(valA || 0) * Number(valB || 0), decimals);
}

/**
 * Formats a financial amount with standard decimal places
 */
export function formatFinancialAmount(num: number | string | null | undefined, decimals: number = 1): string {
  const n = roundFinancial(num, decimals);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Safely extracts error message from an unknown error object
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'خطای ناشناخته رخ داده است';
}

/**
 * Safely extracts an array from API responses (paginated { data: [...] } or direct array [...])
 */
export function safeExtractArray<T = unknown>(res: unknown): T[] {
  if (res && typeof res === 'object' && 'data' in res && Array.isArray((res as { data: unknown }).data)) {
    return (res as { data: T[] }).data;
  }
  if (Array.isArray(res)) return res as T[];
  return [];
}


