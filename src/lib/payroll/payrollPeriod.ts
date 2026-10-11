import { isoToJalaliDate, toStorageDate } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.268 (TD-808، B12P-05، تصمیم ت۴ الف): حقوق ثابت فقط تا پایان همکاری داده می‌شود. پیش‌تر سهم ثابت وضعیت استخدام و
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
 * v9.0.268 (TD-808، تصمیم ت۴ الف): فیش دوره‌ای که پایانش پس از امروز کسب‌وکار است صادر نمی‌شود (سرور ۴۲۲
 * `PAYROLL_PERIOD_IN_FUTURE`، فرم پیش از ارسال). پیش‌تر فیش آذر در مهر صادر و تأیید شد.
 */
export function payrollPeriodFutureError(endIso: string, todayIso: string): string | null {
  if (endIso <= todayIso) return null;
  return `پایان دوره فیش (${toPersianDigits(isoToJalaliDate(endIso))}) پس از امروز (${toPersianDigits(isoToJalaliDate(todayIso))}) است؛ فیش دوره‌ای که هنوز تمام نشده صادر نمی‌شود.`;
}

/**
 * v10.0.199 (TD-1086، طرح حقوق §۳.۴): «آغاز همکاری» پرسنل (`personnel.start_date`) جایی است که حقوق ثابت آغاز می‌شود؛ ماه
 * نخست با همان قاعده روزشمار TD-284. پیش‌تر حقوق ثابت از روز نخست هر بازه داده می‌شد، حتی برای پرسنلی که نیمه ماه آمده بود.
 * تاریخ خالی یا نامعتبر یعنی رفتار پیشین.
 */
export function serviceStartOf(person: { startDate?: string | null }): string | null {
  return toStorageDate(String(person.startDate ?? '').trim()) || null;
}

/** نخستین روز بازه فیش که حقوق ثابت می‌گیرد؛ null وقتی همکاری پس از پایان بازه آغاز می‌شود */
export function fixedSalaryPeriodStart(startIso: string, endIso: string, serviceStartIso: string | null): string | null {
  if (!serviceStartIso) return startIso;
  if (serviceStartIso > endIso) return null;
  return serviceStartIso > startIso ? serviceStartIso : startIso;
}

export interface PayrollPrepayment { isPrepayment?: boolean | null; prepaymentReason?: string | null }

/**
 * v10.0.199 (TD-1085، طرح حقوق §۳.۴): فیش دوره‌ای که پایانش پس از امروز است فقط با تیک «فیش پیش‌پرداخت» و دلیل الزامی
 * پذیرفته می‌شود (پیش‌پرداخت فقط حقوق ثابت را دربر می‌گیرد، چون کارکرد آینده ثبت نشده)؛ تیک پیش‌پرداخت برای دوره
 * تمام‌شده معنایی ندارد. سرور (صدور فیش) و فرم صدور هر دو از این قاعده می‌خوانند.
 */
export function payrollPrepaymentError(endIso: string, todayIso: string, prepayment: PayrollPrepayment): { code: string; message: string } | null {
  const future = endIso > todayIso;
  if (!prepayment.isPrepayment) {
    const message = payrollPeriodFutureError(endIso, todayIso);
    return message ? { code: 'PAYROLL_PERIOD_IN_FUTURE', message: `${message} برای پرداخت پیشاپیش حقوق ثابت، «فیش پیش‌پرداخت» را با دلیل آن بزنید.` } : null;
  }
  if (!future) {
    return { code: 'PAYROLL_PREPAYMENT_NOT_FUTURE', message: 'فیش پیش‌پرداخت فقط برای دوره‌ای است که پایانش پس از امروز است؛ تیک «فیش پیش‌پرداخت» را بردارید.' };
  }
  if (!String(prepayment.prepaymentReason ?? '').trim()) {
    return { code: 'PAYROLL_PREPAYMENT_REASON_REQUIRED', message: 'برای فیش پیش‌پرداخت دلیل بنویسید، مثلاً پرداخت پیش از تعطیلات.' };
  }
  return null;
}

/** حداکثر طول دلیل فیش پیش‌پرداخت (طرح‌واره مسیر و فرم) */
export const PREPAYMENT_REASON_MAX = 500;
