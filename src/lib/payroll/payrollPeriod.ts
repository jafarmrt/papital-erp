import { isoToJalaliDate, toStorageDate } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.233 (TD-808، B12P-05، تصمیم ت۴ الف): حقوق ثابت فقط تا پایان همکاری داده می‌شود. پیش‌تر سهم ثابت وضعیت استخدام و
 * تاریخ پایان همکاری را نمی‌خواند: پرسنلی که ۱۴۰۵/۰۵/۳۱ قطع همکاری کرده بود برای مهر حقوق ثابت کامل گرفت.
 * پرسنل «قطع همکاری» تا تاریخ پایان همکاری‌اش حقوق ثابت می‌گیرد (ماه ناقص با همان قاعده روزشمار TD-284) و دوره پس از آن
 * بی حقوق ثابت است؛ تاریخ پایان همکاری برای وضعیت‌های دیگر خوانده نمی‌شود. سرور (صدور فیش) و مرورگر (راهنمای فرم) هر دو
 * از این فایل می‌خوانند.
 */

export const TERMINATED_EMPLOYMENT_STATUS = 'قطع همکاری';

export type ServiceEnd =
  | { kind: 'open' }
  | { kind: 'ended'; endIso: string }
  /** «قطع همکاری» بی تاریخ پایان همکاری معتبر */
  | { kind: 'unknown' };

export function serviceEndOf(person: { employmentStatus?: string | null; endDate?: string | null }): ServiceEnd {
  if (String(person.employmentStatus ?? '').trim() !== TERMINATED_EMPLOYMENT_STATUS) return { kind: 'open' };
  const endIso = toStorageDate(String(person.endDate ?? '').trim());
  return endIso ? { kind: 'ended', endIso } : { kind: 'unknown' };
}

/** آخرین روز بازه فیش که حقوق ثابت می‌گیرد؛ null وقتی همکاری پیش از آغاز بازه تمام شده است */
export function fixedSalaryPeriodEnd(startIso: string, endIso: string, serviceEnd: ServiceEnd): string | null {
  if (serviceEnd.kind !== 'ended') return endIso;
  if (serviceEnd.endIso < startIso) return null;
  return serviceEnd.endIso < endIso ? serviceEnd.endIso : endIso;
}

/**
 * v9.0.233 (TD-808، تصمیم ت۴ الف): فیش دوره‌ای که پایانش پس از امروز کسب‌وکار است صادر نمی‌شود (سرور ۴۲۲
 * `PAYROLL_PERIOD_IN_FUTURE`، فرم پیش از ارسال). پیش‌تر فیش آذر در مهر صادر و تأیید شد.
 */
export function payrollPeriodFutureError(endIso: string, todayIso: string): string | null {
  if (endIso <= todayIso) return null;
  return `پایان دوره فیش (${toPersianDigits(isoToJalaliDate(endIso))}) پس از امروز (${toPersianDigits(isoToJalaliDate(todayIso))}) است؛ فیش دوره‌ای که هنوز تمام نشده صادر نمی‌شود.`;
}
