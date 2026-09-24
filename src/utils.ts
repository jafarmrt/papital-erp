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
 * تبدیل مستقیم سال، ماه و روز جلالی به میلادی با الگوریتم استاندارد و دقیق تقویم جلالی (Kazimierz M. Borkowski)
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = jy > 979 ? 1600 : 621;
  let jYear = jy > 979 ? jy - 979 : jy;

  let days = (365 * jYear) + (Math.floor(jYear / 33) * 8) + Math.floor(((jYear % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > sal_a[gm]) {
    gd -= sal_a[gm];
    gm++;
  }
  return [gy, gm, gd];
}

/**
 * تبدیل رشته تاریخ جلالی (مثلاً '1405/06/31' یا '1403-05-12') یا رشته‌های مختلف به تاریخ استاندارد میلادی ISO (YYYY-MM-DD).
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

    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * نرمال‌سازی قطعی انواع تاریخ ورودی (رشته جلالی، تاریخ میلادی، رشته ISO یا شیء Date)
 * به فرمت استاندارد timestamp پایگاه‌داده PostgreSQL (YYYY-MM-DD HH:mm:ss).
 * این تابع از وقوع خطای datetime out of range هنگام ذخیره تاریخ‌های جلالی در ستون‌های timestamp جلوگیری می‌کند.
 */
export function normalizeDateToDbTimestamp(dateInput?: string | Date | null): string {
  if (!dateInput) {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.toISOString().replace('T', ' ').slice(0, 19);
  }
  const s = String(dateInput).trim();
  if (!s) {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  // اگر قبلاً ISO با زمان است (مثلاً 2026-09-22T06:19:46.000Z)
  if (s.includes('T') && /^\d{4}-\d{2}-\d{2}/.test(s) && !s.startsWith('13') && !s.startsWith('14') && !s.startsWith('15')) {
    return s.replace('T', ' ').slice(0, 19);
  }
  // اگر تاریخ میلادی استاندارد YYYY-MM-DD یا YYYY/MM/DD است
  const gMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/);
  if (gMatch && parseInt(gMatch[1], 10) >= 1900 && parseInt(gMatch[1], 10) <= 2200) {
    const y = gMatch[1];
    const m = gMatch[2].padStart(2, '0');
    const d = gMatch[3].padStart(2, '0');
    const timePart = gMatch[4]?.trim() || '00:00:00';
    const cleanTime = timePart.includes(':') ? timePart : '00:00:00';
    return `${y}-${m}-${d} ${cleanTime}`.slice(0, 19);
  }
  // اگر تاریخ جلالی است (مثلاً 1405/06/31 یا 1405-06-31)
  const isoDate = jalaliToIsoDate(s);
  if (isoDate) {
    const timeMatch = s.match(/(\d{2}:\d{2}(?::\d{2})?)/);
    const timePart = timeMatch ? (timeMatch[1].length === 5 ? `${timeMatch[1]}:00` : timeMatch[1]) : '00:00:00';
    return `${isoDate} ${timePart}`;
  }
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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

/**
 * نقشه پیش‌شماره‌های ۶ رقمی (BIN/IIN) کارت‌های بانکی عضو شبکه شتاب ایران
 */
export const IRANIAN_BANKS_BIN: Record<string, { name: string; shortName: string; code: string; color: string }> = {
  '603799': { name: 'بانک ملی ایران', shortName: 'ملی', code: '017', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '589210': { name: 'بانک سپه', shortName: 'سپه', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '627648': { name: 'بانک توسعه صادرات ایران', shortName: 'توسعه صادرات', code: '020', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '627961': { name: 'بانک صنعت و معدن', shortName: 'صنعت و معدن', code: '011', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '603770': { name: 'بانک کشاورزی', shortName: 'کشاورزی', code: '016', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '639217': { name: 'بانک کشاورزی', shortName: 'کشاورزی', code: '016', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '628023': { name: 'بانک مسکن', shortName: 'مسکن', code: '014', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  '627760': { name: 'پست بانک ایران', shortName: 'پست بانک', code: '021', color: 'text-green-700 bg-green-50 border-green-200' },
  '502908': { name: 'بانک توسعه تعاون', shortName: 'توسعه تعاون', code: '022', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '627412': { name: 'بانک اقتصاد نوین', shortName: 'اقتصاد نوین', code: '055', color: 'text-purple-700 bg-purple-50 border-purple-200' },
  '622106': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '639194': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '627884': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '502229': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد', code: '057', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '639347': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد', code: '057', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '627488': { name: 'بانک کارآفرین', shortName: 'کارآفرین', code: '053', color: 'text-teal-700 bg-teal-50 border-teal-200' },
  '502910': { name: 'بانک کارآفرین', shortName: 'کارآفرین', code: '053', color: 'text-teal-700 bg-teal-50 border-teal-200' },
  '621986': { name: 'بانک سامان', shortName: 'سامان', code: '056', color: 'text-sky-700 bg-sky-50 border-sky-200' },
  '639346': { name: 'بانک سینا', shortName: 'سینا', code: '059', color: 'text-blue-800 bg-blue-50 border-blue-200' },
  '639607': { name: 'بانک سرمایه', shortName: 'سرمایه', code: '058', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  '636214': { name: 'بانک آینده', shortName: 'آینده', code: '062', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '504706': { name: 'بانک شهر', shortName: 'شهر', code: '061', color: 'text-rose-700 bg-rose-50 border-rose-200' },
  '502806': { name: 'بانک شهر', shortName: 'شهر', code: '061', color: 'text-rose-700 bg-rose-50 border-rose-200' },
  '502938': { name: 'بانک دی', shortName: 'دی', code: '066', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  '603769': { name: 'بانک صادرات ایران', shortName: 'صادرات', code: '019', color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  '610433': { name: 'بانک ملت', shortName: 'ملت', code: '012', color: 'text-red-700 bg-red-50 border-red-200' },
  '991975': { name: 'بانک ملت', shortName: 'ملت', code: '012', color: 'text-red-700 bg-red-50 border-red-200' },
  '585983': { name: 'بانک تجارت', shortName: 'تجارت', code: '018', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  '627353': { name: 'بانک تجارت', shortName: 'تجارت', code: '018', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  '589463': { name: 'بانک رفاه کارگران', shortName: 'رفاه', code: '013', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '627381': { name: 'بانک انصار (سپه)', shortName: 'انصار', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '505785': { name: 'بانک ایران زمین', shortName: 'ایران زمین', code: '069', color: 'text-purple-700 bg-purple-50 border-purple-200' },
  '505416': { name: 'بانک گردشگری', shortName: 'گردشگری', code: '064', color: 'text-stone-700 bg-stone-100 border-stone-200' },
  '636795': { name: 'بانک مرکزی', shortName: 'مرکزی', code: '010', color: 'text-slate-700 bg-slate-100 border-slate-300' },
  '628157': { name: 'موسسه اعتباری توسعه', shortName: 'توسعه', code: '051', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '505801': { name: 'موسسه اعتباری کوثر (سپه)', shortName: 'کوثر', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '606256': { name: 'موسسه اعتباری ملل', shortName: 'ملل', code: '075', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '606373': { name: 'بانک قرض‌الحسنه مهر ایران', shortName: 'مهر ایران', code: '060', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '504172': { name: 'بانک قرض‌الحسنه رسالت', shortName: 'رسالت', code: '070', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '505809': { name: 'بانک خاورمیانه', shortName: 'خاورمیانه', code: '078', color: 'text-sky-700 bg-sky-50 border-sky-200' },
  '581874': { name: 'بانک ایران و ونزوئلا', shortName: 'ایران ونزوئلا', code: '052', color: 'text-teal-700 bg-teal-50 border-teal-200' }
};

/**
 * نقشه شناسه ۳ رقمی بانک‌ها در شماره شبا (ارقام ۴ تا ۶ شماره شبا)
 */
export const SHEBA_BANKS_CODE: Record<string, { name: string; shortName: string }> = {
  '010': { name: 'بانک مرکزی جمهوری اسلامی ایران', shortName: 'بانک مرکزی' },
  '011': { name: 'بانک صنعت و معدن', shortName: 'صنعت و معدن' },
  '012': { name: 'بانک ملت', shortName: 'ملت' },
  '013': { name: 'بانک رفاه کارگران', shortName: 'رفاه' },
  '014': { name: 'بانک مسکن', shortName: 'مسکن' },
  '015': { name: 'بانک سپه', shortName: 'سپه' },
  '016': { name: 'بانک کشاورزی', shortName: 'کشاورزی' },
  '017': { name: 'بانک ملی ایران', shortName: 'ملی' },
  '018': { name: 'بانک تجارت', shortName: 'تجارت' },
  '019': { name: 'بانک صادرات ایران', shortName: 'صادرات' },
  '020': { name: 'بانک توسعه صادرات ایران', shortName: 'توسعه صادرات' },
  '021': { name: 'پست بانک ایران', shortName: 'پست بانک' },
  '022': { name: 'بانک توسعه تعاون', shortName: 'توسعه تعاون' },
  '051': { name: 'موسسه اعتباری توسعه', shortName: 'توسعه' },
  '052': { name: 'بانک مشترک ایران و ونزوئلا', shortName: 'ایران ونزوئلا' },
  '053': { name: 'بانک کارآفرین', shortName: 'کارآفرین' },
  '054': { name: 'بانک پارسیان', shortName: 'پارسیان' },
  '055': { name: 'بانک اقتصاد نوین', shortName: 'اقتصاد نوین' },
  '056': { name: 'بانک سامان', shortName: 'سامان' },
  '057': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد' },
  '058': { name: 'بانک سرمایه', shortName: 'سرمایه' },
  '059': { name: 'بانک سینا', shortName: 'سینا' },
  '060': { name: 'بانک قرض‌الحسنه مهر ایران', shortName: 'مهر ایران' },
  '061': { name: 'بانک شهر', shortName: 'شهر' },
  '062': { name: 'بانک آینده', shortName: 'آینده' },
  '063': { name: 'بانک انصار (سپه)', shortName: 'انصار' },
  '064': { name: 'بانک گردشگری', shortName: 'گردشگری' },
  '065': { name: 'بانک حکمت ایرانیان (سپه)', shortName: 'حکمت ایرانیان' },
  '066': { name: 'بانک دی', shortName: 'دی' },
  '069': { name: 'بانک ایران زمین', shortName: 'ایران زمین' },
  '070': { name: 'بانک قرض‌الحسنه رسالت', shortName: 'رسالت' },
  '073': { name: 'موسسه اعتباری کوثر (سپه)', shortName: 'کوثر' },
  '075': { name: 'موسسه اعتباری ملل', shortName: 'ملل' },
  '078': { name: 'بانک خاورمیانه', shortName: 'خاورمیانه' },
  '079': { name: 'بانک مهر اقتصاد (سپه)', shortName: 'مهر اقتصاد' }
};

/**
 * پاکسازی و استانداردسازی شماره کارت به ۱۶ رقم خالص انگلیسی
 */
export function normalizeBankCard(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const raw = toEnglishDigits(String(val)).trim();
    return raw.replace(/\D/g, '').slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی نمایشی شماره کارت به دسته‌های ۴ رقمی (مثال: ۶۰۳۷ - ۹۹۱۸ - ۱۲۳۴ - ۵۶۷۸)
 */
export function formatBankCard(val: string | number | null | undefined, separator: string = ' - '): string {
  const clean = normalizeBankCard(val);
  if (!clean) return '';
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.substring(i, i + 4));
  }
  return parts.join(separator);
}

/**
 * استخراج اطلاعات بانک از ۶ رقم اول شماره کارت (BIN)
 */
export function getIranianBankFromCard(card: string | number | null | undefined): {
  name: string;
  shortName: string;
  code: string;
  color: string;
} | null {
  const clean = normalizeBankCard(card);
  if (clean.length < 6) return null;
  const bin = clean.substring(0, 6);
  return IRANIAN_BANKS_BIN[bin] || null;
}

/**
 * اعتبارسنجی الگوریتم لان (Luhn) و ساختار ۱۶ رقمی شماره کارت شتاب
 */
export function validateBankCardNumber(card: string | number | null | undefined): {
  isValid: boolean;
  error?: string;
  bankName?: string;
  shortName?: string;
  bankCode?: string;
  badgeColor?: string;
} {
  const clean = normalizeBankCard(card);
  if (!clean) {
    return { isValid: false, error: 'شماره کارت وارد نشده است' };
  }
  const bank = getIranianBankFromCard(clean);

  if (clean.length < 16) {
    return {
      isValid: false,
      error: `شماره کارت باید ۱۶ رقم باشد (در حال حاضر ${clean.length} رقم)`,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code,
      badgeColor: bank?.color
    };
  }

  // الگوریتم لان (Luhn Checksum):
  // در رشته ۱۶ رقمی، ارقام با اندیس‌های زوج (از چپ: ۰، ۲، ۴، ۶، ۸، ۱۰، ۱۲، ۱۴) در ۲ ضرب شده و در صورت > ۹، منهای ۹ می‌شوند.
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = parseInt(clean[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  if (sum % 10 !== 0) {
    return {
      isValid: false,
      error: 'رقم کنترلی شماره کارت نامعتبر است (خطای Luhn)',
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code,
      badgeColor: bank?.color
    };
  }

  return {
    isValid: true,
    bankName: bank?.name,
    shortName: bank?.shortName,
    bankCode: bank?.code,
    badgeColor: bank?.color
  };
}

/**
 * استانداردسازی و یکدست‌سازی شماره شبا:
 * - تبدیل ارقام فارسی و حذف فاصله‌ها
 * - تبدیل به حروف بزرگ
 * - اضافه کردن پیشوند IR در صورت عدم وجود (اگر ۲۴ رقم وارد شده باشد)
 */
export function normalizeSheba(val: string | null | undefined): string {
  if (!val || typeof val !== 'string') return '';
  try {
    let clean = toEnglishDigits(val).replace(/[\s\-]/g, '').toUpperCase();
    if (!clean.startsWith('IR') && clean.length === 24 && /^\d+$/.test(clean)) {
      clean = 'IR' + clean;
    }
    return clean.slice(0, 26);
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی نمایشی شماره شبا به دسته‌های ۴ رقمی استاندارد
 * مثال: IR65 0120 0000 0000 1234 5678 90
 */
export function formatIranianSheba(val: string | null | undefined, separator: string = ' '): string {
  const clean = normalizeSheba(val);
  if (!clean) return '';
  // تفکیک دسته‌های ۴ رقمی بعد از IR یا از ابتدا
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.substring(i, i + 4));
  }
  return parts.join(separator);
}

/**
 * استخراج نام بانک از روی کد ۳ رقمی شناسه بانک در شماره شبا (ارقام ۴ تا ۶)
 */
export function getIranianBankFromSheba(sheba: string | null | undefined): {
  name: string;
  shortName: string;
  code: string;
} | null {
  const clean = normalizeSheba(sheba);
  if (clean.length < 7 || !clean.startsWith('IR')) return null;
  const bankCode = clean.substring(4, 7);
  const info = SHEBA_BANKS_CODE[bankCode];
  if (!info) return null;
  return { ...info, code: bankCode };
}

/**
 * اعتبارسنجی رسمی شماره شبا بر اساس استاندارد ISO 7064 Mod 97-10
 */
export function validateIranianSheba(sheba: string | null | undefined): {
  isValid: boolean;
  error?: string;
  bankName?: string;
  shortName?: string;
  bankCode?: string;
} {
  const clean = normalizeSheba(sheba);
  if (!clean) {
    return { isValid: false, error: 'شماره شبا وارد نشده است' };
  }

  const bank = getIranianBankFromSheba(clean);

  if (!clean.startsWith('IR')) {
    return { isValid: false, error: 'شماره شبا باید با IR آغاز شود' };
  }

  if (clean.length !== 26) {
    return {
      isValid: false,
      error: `شماره شبا باید شامل ۲۶ کاراکتر (IR و ۲۴ رقم) باشد (در حال حاضر ${clean.length} کاراکتر)`,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  }

  const digitsPart = clean.slice(2);
  if (!/^\d{24}$/.test(digitsPart)) {
    return {
      isValid: false,
      error: 'پس از پیشوند IR باید دقیقاً ۲۴ رقم عددی قرار گیرد',
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  }

  // الگوریتم رسمی ISO 7064 Mod 97-10:
  // ۱. چهار کاراکتر ابتدایی (IRxx) به انتهای رشته منتقل می‌شوند.
  // ۲. حرف I با عدد 18 و حرف R با عدد 27 جایگزین می‌شود (IR => 1827).
  // ۳. باقیمانده تقسیم عدد بزرگ حاصل بر ۹۷ باید برابر با ۱ باشد.
  try {
    const rearranged = clean.substring(4) + '1827' + clean.substring(2, 4);
    const remainder = BigInt(rearranged) % 97n;
    if (remainder !== 1n) {
      return {
        isValid: false,
        error: 'رقم‌های کنترلی شماره شبا نامعتبر است (خطای Mod 97-10)',
        bankName: bank?.name,
        shortName: bank?.shortName,
        bankCode: bank?.code
      };
    }

    return {
      isValid: true,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  } catch {
    return { isValid: false, error: 'خطا در محاسبه کنترل‌رقم شبا' };
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
  // جلوگیری از ارقام تکراری ساختگی نامعتبر مانند ۱۱۱۱۱۱۱۱۱۱
  const allSame = /^(\d)\1{9}$/.test(cleanId);
  if (allSame) {
    return { isValid: false, error: 'کد ملی وارد شده نامعتبر است' };
  }
  // محاسبه رقم کنترلی استاندارد ثبت‌احوال (Mod 11)
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

export type IranianPhoneOperatorKey = 'mci' | 'irancell' | 'rightel' | 'shatel' | 'samantel' | 'taliya' | 'landline' | 'unknown';

export interface IranianPhoneInfo {
  isValid: boolean;
  type: 'mobile' | 'landline' | 'unknown';
  operatorKey: IranianPhoneOperatorKey;
  operatorName: string;
  provinceName?: string;
  error?: string;
}

const IRANIAN_LANDLINE_CODES: Record<string, string> = {
  '021': 'تهران',
  '026': 'البرز',
  '025': 'قم',
  '024': 'زنجان',
  '028': 'قزوین',
  '023': 'سمنان',
  '031': 'اصفهان',
  '034': 'کرمان',
  '035': 'یزد',
  '038': 'چهارمحال و بختیاری',
  '041': 'آذربایجان شرقی',
  '044': 'آذربایجان غربی',
  '045': 'اردبیل',
  '051': 'خراسان رضوی',
  '054': 'سیستان و بلوچستان',
  '056': 'خراسان جنوبی',
  '058': 'خراسان شمالی',
  '061': 'خوزستان',
  '066': 'لرستان',
  '071': 'فارس',
  '074': 'کهگیلویه و بویراحمد',
  '076': 'هرمزگان',
  '077': 'بوشهر',
  '081': 'همدان',
  '083': 'کرمانشاه',
  '084': 'ایلام',
  '086': 'مرکزی',
  '087': 'کردستان',
  '011': 'مازندران',
  '013': 'گیلان',
  '017': 'گلستان'
};

const MCI_PREFIXES = new Set([
  '0910', '0911', '0912', '0913', '0914', '0915', '0916', '0917', '0918', '0919',
  '0990', '0991', '0992', '0993', '0994', '0996'
]);

const IRANCELL_PREFIXES = new Set([
  '0930', '0933', '0935', '0936', '0937', '0938', '0939',
  '0901', '0902', '0903', '0904', '0905', '0941'
]);

const RIGHTEL_PREFIXES = new Set(['0920', '0921', '0922', '0923']);
const SHATEL_PREFIXES = new Set(['0998']);
const SAMANTEL_PREFIXES = new Set(['0999']);
const TALIYA_PREFIXES = new Set(['0932']);

/**
 * دریافت اطلاعات اپراتور و نوع شماره تلفن ایرانی (موبایل یا تلفن ثابت)
 */
export function getIranianPhoneOperatorInfo(phone: string | null | undefined): IranianPhoneInfo {
  if (!phone || !String(phone).trim()) {
    return { isValid: false, type: 'unknown', operatorKey: 'unknown', operatorName: '' };
  }
  const clean = normalizePhoneNumber(phone);
  if (!clean.startsWith('0')) {
    return { isValid: false, type: 'unknown', operatorKey: 'unknown', operatorName: '', error: 'شماره باید با صفر شروع شود' };
  }

  // اگر موبایل است (با 09 شروع می‌شود)
  if (clean.startsWith('09')) {
    const prefix4 = clean.slice(0, 4);
    let operatorKey: IranianPhoneOperatorKey = 'unknown';
    let operatorName = 'موبایل';

    if (MCI_PREFIXES.has(prefix4)) {
      operatorKey = 'mci';
      operatorName = 'همراه اول';
    } else if (IRANCELL_PREFIXES.has(prefix4)) {
      operatorKey = 'irancell';
      operatorName = 'ایرانسل';
    } else if (RIGHTEL_PREFIXES.has(prefix4)) {
      operatorKey = 'rightel';
      operatorName = 'رایتل';
    } else if (SHATEL_PREFIXES.has(prefix4)) {
      operatorKey = 'shatel';
      operatorName = 'شاتل موبایل';
    } else if (SAMANTEL_PREFIXES.has(prefix4)) {
      operatorKey = 'samantel';
      operatorName = 'سامان تل';
    } else if (TALIYA_PREFIXES.has(prefix4)) {
      operatorKey = 'taliya';
      operatorName = 'تالیا';
    }

    const isFullLength = clean.length === 11;
    const isValid = isFullLength && operatorKey !== 'unknown';
    return {
      isValid,
      type: 'mobile',
      operatorKey,
      operatorName,
      error: !isFullLength && clean.length > 4 ? `شماره باید ۱۱ رقمی باشد (${clean.length} رقم وارد شده)` : undefined
    };
  }

  // اگر تلفن ثابت است (با 01 تا 08 شروع می‌شود)
  const code3 = clean.slice(0, 3);
  if (IRANIAN_LANDLINE_CODES[code3]) {
    const provinceName = IRANIAN_LANDLINE_CODES[code3];
    const isFullLength = clean.length === 11;
    return {
      isValid: isFullLength,
      type: 'landline',
      operatorKey: 'landline',
      operatorName: `ثابت (${provinceName})`,
      provinceName,
      error: !isFullLength ? `شماره تلفن ثابت باید ۱۱ رقمی با پیش‌شماره استان باشد` : undefined
    };
  }

  // سایر شماره‌های شروع شده با 0
  const isFullLength = clean.length === 11;
  return {
    isValid: isFullLength,
    type: clean.length >= 3 && clean.startsWith('0') ? 'landline' : 'unknown',
    operatorKey: 'unknown',
    operatorName: 'تلفن',
    error: !isFullLength ? 'شماره باید ۱۱ رقمی باشد' : undefined
  };
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
  const info = getIranianPhoneOperatorInfo(cleanPhone);
  if (!info.isValid && info.error) {
    return { isValid: false, error: info.error };
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

/**
 * تبدیل دسته‌های ۳ رقمی عدد به حروف فارسی
 */
function chunk3ToPersianWords(num: number): string {
  if (num === 0) return '';
  const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];

  const parts: string[] = [];
  const h = Math.floor(num / 100);
  const rem = num % 100;
  if (h > 0) parts.push(hundreds[h]);
  if (rem >= 10 && rem < 20) {
    parts.push(teens[rem - 10]);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (t > 0) parts.push(tens[t]);
    if (o > 0) parts.push(ones[o]);
  }
  return parts.join(' و ');
}

/**
 * تبدیل عدد صحیح به حروف سلیس فارسی (پشتیبانی تا کوادریلیون بدون محدودیت اعشاری)
 * مثال: 1234567 => یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت
 */
export function numberToPersianWords(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '';
  const clean = toEnglishDigits(String(input)).replace(/[,\s]/g, '').trim();
  if (clean === '0') return 'صفر';
  const isNegative = clean.startsWith('-');
  const rawNum = isNegative ? clean.slice(1) : clean;
  if (!/^\d+$/.test(rawNum)) return '';

  const scales = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون'];
  const chunks: number[] = [];
  for (let i = rawNum.length; i > 0; i -= 3) {
    chunks.push(parseInt(rawNum.substring(Math.max(0, i - 3), i), 10));
  }

  const wordsParts: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk > 0) {
      const chunkWords = chunk3ToPersianWords(chunk);
      const scale = scales[i];
      if (i === 1 && chunk === 1) {
        wordsParts.push('یک هزار');
      } else {
        wordsParts.push(scale ? `${chunkWords} ${scale}` : chunkWords);
      }
    }
  }

  const result = wordsParts.join(' و ');
  return (isNegative ? 'منفی ' : '') + result;
}

export interface FinancialWordsResult {
  words: string;
  tomanEquivalent: string;
  fullDescription: string;
}

/**
 * تبدیل مبالغ مالی به حروف فارسی به همراه معادل روان تومان برای مبالغ ریالی
 * مثال برای 45000000:
 * {
 *   words: 'چهل و پنج میلیون ریال',
 *   tomanEquivalent: 'چهار میلیون و پانصد هزار تومان',
 *   fullDescription: 'چهل و پنج میلیون ریال (معادل چهار میلیون و پانصد هزار تومان)'
 * }
 */
export function financialAmountToPersianWords(
  amount: number | string | null | undefined,
  currency: string = 'IRR'
): FinancialWordsResult {
  if (amount === null || amount === undefined || amount === '') {
    return { words: '', tomanEquivalent: '', fullDescription: '' };
  }
  const cleanStr = toEnglishDigits(String(amount)).replace(/[,\s]/g, '').trim();
  const num = Number(cleanStr);
  if (isNaN(num)) {
    return { words: '', tomanEquivalent: '', fullDescription: '' };
  }

  const cur = currency?.toUpperCase() || 'IRR';
  const isRial = cur === 'IRR' || cur === 'ریال';
  const isToman = cur === 'TOMAN' || cur === 'تومان';

  if (num === 0) {
    const label = isRial ? 'ریال' : isToman ? 'تومان' : formatCurrencyLabel(cur);
    const zeroDesc = `صفر ${label}`;
    return { words: zeroDesc, tomanEquivalent: '', fullDescription: zeroDesc };
  }

  const prefix = num < 0 ? 'منفی ' : '';
  const absNum = Math.abs(num);
  const intPart = Math.floor(absNum);

  if (isRial) {
    const rialWords = numberToPersianWords(intPart);
    const rialText = `${prefix}${rialWords} ریال`;
    const tomanValue = Math.floor(intPart / 10);
    const tomanRemainder = intPart % 10;

    let tomanText = '';
    if (tomanValue > 0) {
      const tomanWords = numberToPersianWords(tomanValue);
      tomanText = `${prefix}${tomanWords} تومان`;
      if (tomanRemainder > 0) {
        tomanText += ` و ${numberToPersianWords(tomanRemainder)} ریال`;
      }
    }

    return {
      words: rialText,
      tomanEquivalent: tomanText,
      fullDescription: tomanText ? `${rialText} (معادل ${tomanText})` : rialText
    };
  }

  if (isToman) {
    const tomanWords = numberToPersianWords(intPart);
    const tomanText = `${prefix}${tomanWords} تومان`;
    const rialValue = intPart * 10;
    const rialWords = numberToPersianWords(rialValue);
    const rialText = `${prefix}${rialWords} ریال`;

    return {
      words: tomanText,
      tomanEquivalent: rialText,
      fullDescription: `${tomanText} (معادل ${rialText})`
    };
  }

  // سایر ارزها (USD, EUR, AED, GBP)
  const currLabel = formatCurrencyLabel(cur);
  const foreignWords = numberToPersianWords(intPart);
  const fullText = `${prefix}${foreignWords} ${currLabel}`;

  return {
    words: fullText,
    tomanEquivalent: '',
    fullDescription: fullText
  };
}

/**
 * فرمت‌بندی اندازه فایل به صورت فارسی (بایت، کیلوبایت، مگابایت)
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '۰ بایت';
  if (bytes < 1024) return `${formatPersianNumber(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatPersianNumber(Math.round(kb))} کیلوبایت`;
  const mb = (kb / 1024).toFixed(1);
  return `${formatPersianNumber(mb)} مگابایت`;
}



