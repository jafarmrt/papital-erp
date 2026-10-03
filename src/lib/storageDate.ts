import { ValidationError } from '../errors/customErrors.js';
import { toStorageDate } from '../utils/calendarDate.js';
import { businessTodayIsoDate } from './businessClock.js';

/**
 * v7.0.131 (TD-232): نرمال‌سازی تاریخ ورودی API پیش از ذخیره در ستون‌های تاریخ متنیِ یکسان‌شده.
 * کاربر شمسی می‌فرستد (یا میلادی)؛ پایگاه‌داده همیشه میلادی ISO `YYYY-MM-DD` می‌گیرد.
 * تاریخ نامعتبر با ValidationError (422) رد می‌شود و هرگز بی‌صدا ذخیره یا حذف نمی‌شود.
 */
export function requireStorageDate(value: unknown, label: string): string {
  const iso = toStorageDate(value);
  if (iso === null) {
    throw new ValidationError(`تاریخ «${String(value)}» برای ${label} معتبر نیست؛ یک تاریخ شمسی مانند ۱۴۰۵/۰۷/۱۰ وارد کنید`, { field: label, value });
  }
  return iso;
}

/** برای ویرایش جزئی: مقدار نیامده (undefined) همان undefined می‌ماند تا ستون دست نخورد */
export function optionalStorageDate(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireStorageDate(value, label);
}

/** v7.0.132: اقدام‌های خودکار CRM (ایجاد فرصت، تغییر مرحله، پیش‌فاکتور …) تاریخ امروز را میلادی ISO در هر دو ستون می‌گیرند */
export async function crmTodayActivityDates(): Promise<{ activityDate: string; activityDateIso: string }> {
  const today = await businessTodayIsoDate();
  return { activityDate: today, activityDateIso: today };
}
