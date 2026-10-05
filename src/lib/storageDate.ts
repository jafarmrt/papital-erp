import { ValidationError } from '../errors/customErrors.js';
import { toStorageDate } from '../utils/calendarDate.js';
import { toEnglishDigits } from '../utils/persianNumber.js';
import { businessNowIsoDateTime, businessTodayIsoDate } from './businessClock.js';

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

const TIMESTAMP_PATTERN = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * v8.0.50 (TD-313): تاریخ سند (ستون timestamp، ساعت تهران) ← `YYYY-MM-DD HH:MM:SS`. تاریخ شمسی یا میلادی با ساعت اختیاری
 * پذیرفته می‌شود (ساعت و منطقه همان‌طور که نوشته شده). روز ناموجود (۳۰ اسفند سال عادی، ۳۰ فوریه) یا متن غیرتاریخ با
 * ValidationError (422) رد می‌شود؛ پیش‌تر normalizeDateToDbTimestamp روز ناموجود را به روز بعد می‌برد، تاریخ میلادی
 * ناموجود خطای ۵۰۰ پایگاه‌داده می‌داد و متن ناشناخته بی‌صدا «اکنون» به وقت UTC می‌شد.
 */
export function requireDocumentTimestamp(value: unknown, label: string): string {
  const text = typeof value === 'string' || typeof value === 'number' ? toEnglishDigits(String(value)).trim() : '';
  const m = TIMESTAMP_PATTERN.exec(text);
  const iso = m ? toStorageDate(m[1]) : null;
  const h = Number(m?.[2] ?? 0);
  const mi = Number(m?.[3] ?? 0);
  const se = Number(m?.[4] ?? 0);
  if (!m || !iso || h > 23 || mi > 59 || se > 59) {
    throw new ValidationError(`تاریخ «${String(value ?? '')}» برای ${label} معتبر نیست؛ یک تاریخ شمسی مانند ۱۴۰۵/۰۷/۱۰ وارد کنید`, { field: label, value });
  }
  return `${iso} ${pad2(h)}:${pad2(mi)}:${pad2(se)}`;
}

/** v8.0.50 (TD-313): تاریخ سند تازه؛ خالی ← اکنونِ ساعت توافقی (پیش‌تر اکنونِ UTC) */
export async function resolveDocumentTimestamp(value: unknown, label: string): Promise<string> {
  if (value === undefined || value === null || String(value).trim() === '') {
    return (await businessNowIsoDateTime()).replace('T', ' ').slice(0, 19);
  }
  return requireDocumentTimestamp(value, label);
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
