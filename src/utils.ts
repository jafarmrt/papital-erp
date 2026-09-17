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

export function toPersianDigits(val: string | number | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || typeof val === 'object') return '';
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  try {
    let s = String(val).trim();
    // اگر رشته دارای صفر پیشین غیر اعشاری باشد (مانند تلفن "021..." یا کد ملی "001..."), نباید به عدد تبدیل شود چون صفرهای پیشین حذف می‌شوند
    const hasLeadingZero = (s.startsWith('0') || s.startsWith('-0')) && !s.startsWith('0.') && !s.startsWith('-0.') && s !== '0';
    // If it's a numeric or decimal string (e.g. "12.3456", "100.0000", 95.833333) and not a code with leading zeros
    if (/^-?\d+(\.\d+)?$/.test(s) && !hasLeadingZero && (typeof val === 'number' || s.includes('.'))) {
      const num = Number(s);
      if (!isNaN(num)) {
        s = num.toLocaleString('en-US', {
          maximumFractionDigits: maxDecimals,
          minimumFractionDigits: 0,
          useGrouping: false
        });
      }
    }
    return s.replace(/[0-9]/g, (w) => farsiDigits[parseInt(w, 10)]);
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
 * تبدیل رشته تاریخ جلالی (مثلاً '1403/05/12') یا رشته‌های مختلف به تاریخ استاندارد میلادی ISO (YYYY-MM-DD).
 * از الگوریتم دقیق تقویم جلالی برای تبدیل قطعی استفاده می‌کند.
 */
export function jalaliToIsoDate(str: string | null | undefined): string {
  if (!str || typeof str === 'object') return '';
  try {
    const s = toEnglishDigits(String(str)).trim();
    if (!s) return '';

    // اگر از قبل میلادی استاندارد است (مثلاً 2026-08-28 یا 2026/08/28)
    const gMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (gMatch && parseInt(gMatch[1], 10) >= 1900 && parseInt(gMatch[1], 10) <= 2200) {
      const gy = gMatch[1];
      const gm = gMatch[2].padStart(2, '0');
      const gd = gMatch[3].padStart(2, '0');
      return `${gy}-${gm}-${gd}`;
    }

    // الگوی تاریخ جلالی (13xx یا 14xx یا 15xx)
    const jMatch = s.match(/^(1[345]\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!jMatch) return '';

    const jy = parseInt(jMatch[1], 10);
    const jm = parseInt(jMatch[2], 10);
    const jd = parseInt(jMatch[3], 10);

    // الگوریتم تبدیل جلالی به میلادی
    let gy = jy + 621;
    let leapJ = -14;
    let jp = -61;
    let jumpL = 0;
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

    for (let i = 0; i < breaks.length - 1; i++) {
      const jmBreak = breaks[i];
      jumpL = jmBreak - jp;
      if (jy < jmBreak) break;
      leapJ = leapJ + Math.floor(jumpL / 33) * 8 + Math.floor((jumpL % 33) / 4);
      jp = jmBreak;
    }

    let n = jy - jp;
    leapJ = leapJ + Math.floor(n / 33) * 8 + Math.floor(((n % 33) + 3) / 4);
    if ((jumpL % 33) === 4 && (jumpL - n) === 4) leapJ += 1;

    const leapG = Math.floor(gy / 4) - Math.floor(((Math.floor(gy / 100) + 1) * 3) / 4) - 150;
    const march = 20 + leapJ - leapG;
    if ((jumpL - n) < 6) n = n - jumpL + Math.floor((jumpL + 4) / 33) * 33;

    // محاسبه Julian Day Number
    const g2d = (gY: number, gM: number, gD: number) => {
      let d = Math.floor(((gY + Math.floor((gM - 8) / 6) + 100100) * 1461) / 4)
        + Math.floor((153 * ((gM + 9) % 12) + 2) / 5)
        + gD - 34840408;
      d = d - Math.floor((Math.floor((gY + 100100 + Math.floor((gM - 8) / 6)) / 100) * 3) / 4) + 752;
      return d;
    };

    const jdn = g2d(gy, 3, march) + (jm - 1) * 31 - Math.floor(jm / 7) * (jm - 7) + jd - 1;

    // تبدیل JDN به تقویم میلادی
    let j = 4 * jdn + 139361631;
    j = j + Math.floor((Math.floor((4 * jdn + 183187720) / 146097) * 3) / 4) * 4 - 3908;
    const iVal = Math.floor((j % 1461) / 4) * 5 + 308;
    const gdOut = Math.floor((iVal % 153) / 5) + 1;
    const gmOut = (Math.floor(iVal / 153) % 12) + 1;
    const gyOut = Math.floor(j / 1461) - 100100 + Math.floor((8 - gmOut) / 6);

    return `${gyOut}-${String(gmOut).padStart(2, '0')}-${String(gdOut).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * دریافت تاریخ ایزو از هر ورودی تاریخ (جلالی، میلادی، Date یا شیء).
 */
export function toIsoDateString(val: any): string {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const extracted = extractDateString(val);
  return jalaliToIsoDate(extracted) || extracted;
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

/** پیاده‌سازی واحد برای هر سه تابع تاریخ جلالی (v4.0.29 — حذف بدنه‌های تکراری) */
function getShiftedJalaliDate(dayOffset: number, fallback: string = ''): string {
  try {
    const date = new Date();
    if (dayOffset !== 0) {
      date.setDate(date.getDate() + dayOffset);
    }
    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', tzOptions({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })).format(date);
    return toEnglishDigits(formatted);
  } catch (e) {
    return fallback;
  }
}

export function getTodayJalaliDate(): string {
  return getShiftedJalaliDate(0, '1405/06/06');
}

export function getPastJalaliDate(daysAgo: number = 30): string {
  return getShiftedJalaliDate(-daysAgo);
}

export function getFutureJalaliDate(daysAhead: number = 30): string {
  return getShiftedJalaliDate(daysAhead);
}

export function cleanDecimalString(val: number | string | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const num = typeof val === 'number' ? val : Number(toEnglishDigits(String(val)).replace(/,/g, ''));
    if (isNaN(num)) return '';
    if (num === 0) return '0';
    return num.toLocaleString('en-US', {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: 0,
      useGrouping: false
    });
  } catch {
    return '';
  }
}

export function formatPersianPrice(num: number | string | null | undefined, currency?: string, maxDecimals: number = 0): string {
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
    // If currency is non-IRR (e.g. USD, EUR) or user didn't specify maxDecimals and fraction exists, allow up to 2 decimals
    const effDecimals = maxDecimals > 0 ? maxDecimals : (currency && currency !== 'IRR' && n % 1 !== 0 ? 2 : 0);
    // Standard format with thousands separator and minimum 0 fraction digits (no redundant .0000)
    const formatted = n.toLocaleString('en-US', {
      maximumFractionDigits: effDecimals,
      minimumFractionDigits: 0
    });
    const persianVal = toPersianDigits(formatted);
    return currency ? `${persianVal} ${formatCurrencyLabel(currency)}` : persianVal;
  } catch {
    const zero = '۰';
    return currency ? `${zero} ${formatCurrencyLabel(currency)}` : zero;
  }
}

export function formatPersianNumber(val: number | string | null | undefined, maxDecimals: number = 2): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  
  if (typeof val === 'number') {
    if (isNaN(val)) return '';
    const formatted = val.toLocaleString('en-US', {
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
      const formatted = num.toLocaleString('en-US', {
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

/**
 * استانداردسازی شماره تلفن در ایران:
 * - ارقام انگلیسی می‌شوند و کاراکترهای غیرعددی پاک می‌شوند.
 * - پیشوندهای بین‌المللی (+98 یا 0098 یا 98) به 0 تبدیل می‌شوند.
 * - در صورتی که شماره ۱۰ رقمی باشد و بدون صفر شروع شده باشد (مانند 2122610001 یا 9123456789)، صفر پیشین اضافه می‌شود.
 */
export function normalizePhoneNumber(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    let str = toEnglishDigits(String(val)).trim();
    if (!str) return '';

    // تبدیل پیشوندهای +98 یا 0098 یا 98 کشوری به 0
    if (str.startsWith('+98')) {
      str = '0' + str.slice(3);
    } else if (str.startsWith('0098')) {
      str = '0' + str.slice(4);
    } else if (str.startsWith('98') && (str.length === 12 || str.length === 11)) {
      str = '0' + str.slice(2);
    }

    const digits = str.replace(/\D/g, '');
    if (!digits) return str;

    // شماره‌های ایران (تلفن همراه یا ثابت استانی) با پیش‌شماره معمولاً ۱۱ رقمی با ۰ هستند.
    // در اکسل یا هنگام تایپ اگر ۱۰ رقم بدون صفر وارد شود (مثلاً 2122610001 یا 9123456789)، با صفر پد می‌شود.
    if (digits.length === 10 && !digits.startsWith('0')) {
      return '0' + digits;
    }

    return digits;
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی شماره تلفن با ارقام فارسی و تضمین عدم حذف صفر اول
 */
export function formatPersianPhone(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  const normalized = normalizePhoneNumber(val);
  if (!normalized) return '';
  return toPersianDigits(normalized);
}

/**
 * استانداردسازی کد ملی ایران:
 * - ارقام انگلیسی شده و کاراکترهای غیرعددی پاک می‌شوند.
 * - کد ملی در ایران ۱۰ رقم است؛ در صورتی که به دلیل ورود در اکسل یا بدون صفر ۱ تا ۹ رقم باشد،
 *   با صفرهای پیشین به ۱۰ رقم کامل تبدیل می‌شود (مثلاً 87654321 -> 0087654321).
 */
export function normalizeNationalId(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const rawStr = toEnglishDigits(String(val)).trim();
    const digits = rawStr.replace(/\D/g, '');
    if (!digits) return rawStr;
    if (digits.length > 0 && digits.length < 10) {
      return digits.padStart(10, '0');
    }
    return digits;
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی کد ملی با ارقام فارسی و تضمین نمایش کامل ۱۰ رقم با صفرهای پیشین
 */
export function formatPersianNationalId(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  const normalized = normalizeNationalId(val);
  if (!normalized) return '';
  return toPersianDigits(normalized);
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

export function formatQuantityOrTime(val: number | string | null | undefined, unit?: string, maxDecimals: number = 4): string {
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
    return formatPersianNumber(parsed, maxDecimals);
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

/**
 * Validates Iranian 10-digit National ID (کد ملی)
 * Returns { isValid: boolean, error?: string }
 */
export function validateIranianNationalId(id: string | null | undefined): { isValid: boolean; error?: string } {
  if (!id || !String(id).trim()) {
    return { isValid: true }; // فیلد اختیاری است؛ اگر وارد نشده معتبر تلقی می‌شود
  }
  const cleanId = normalizeNationalId(id);
  if (!/^\d{10}$/.test(cleanId)) {
    return { isValid: false, error: 'کد ملی باید دقیقاً ۱۰ رقم عددی باشد' };
  }
  // جلوگیری از ارقام تکراری نامعتبر مانند ۱۱۱۱۱۱۱۱۱۱
  const allSame = /^(\d)\1{9}$/.test(cleanId);
  if (allSame) {
    return { isValid: false, error: 'کد ملی وارد شده نامعتبر است' };
  }
  // محاسبه رقم کنترلی استاندارد ثبت‌احوال
  const check = parseInt(cleanId[9], 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanId[i], 10) * (10 - i);
  }
  const remainder = sum % 11;
  const isChecksumValid = (remainder < 2 && check === remainder) || (remainder >= 2 && check === 11 - remainder);
  if (!isChecksumValid) {
    return { isValid: false, error: 'رقم کنترلی کد ملی صحیح نمی‌باشد' };
  }
  return { isValid: true };
}

/**
 * Validates Iranian Phone number (موبایل یا تلفن ثابت ۱۱ رقمی شروع با ۰)
 * Returns { isValid: boolean, error?: string }
 */
export function validateIranianPhoneNumber(phone: string | null | undefined): { isValid: boolean; error?: string } {
  if (!phone || !String(phone).trim()) {
    return { isValid: true }; // فیلد اختیاری است؛ در صورت خالی بودن خطا نمی‌دهد
  }
  const cleanPhone = normalizePhoneNumber(phone);
  if (!/^0\d{10}$/.test(cleanPhone)) {
    return { isValid: false, error: 'شماره تماس باید ۱۱ رقم بوده و با صفر (۰) شروع شود (مانند ۰۹۱۲۳۴۵۶۷۸۹ یا ۰۲۱۸۸۸۸۸۸۸۸)' };
  }
  return { isValid: true };
}

/**
 * Standard multi-value parser supporting both English and Persian commas (, and ،)
 */
export function parseMultiValue(val?: string | null): string[] {
  if (!val) return [];
  return String(val).split(/[,،]\s*/).map(s => s.trim()).filter(Boolean);
}

/**
 * Standard multi-value formatter joining non-empty items with Persian comma
 */
export function formatMultiValue(arr?: string[] | null): string {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).join('، ');
}


