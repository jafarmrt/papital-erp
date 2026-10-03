import { ValidationError } from '../errors/customErrors.js';
import { toStorageDate } from '../utils/calendarDate.js';

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
