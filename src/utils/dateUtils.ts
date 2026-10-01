import { toEnglishDigits, toPersianDigits } from "./persianNumber.js";

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
