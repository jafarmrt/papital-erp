/**
 * برچسب فارسی کد اقدام سجل (v9.0.216، TD-538، یافته B02-23، تصمیم ت۸ الف): یک جدول برای نشان اقدام صفحه سجل، گزینه‌های
 * پالایه، برگه چاپی و ستون «نوع اقدام» فایل Excel. هر کدی که کد سرور در سجل می‌نویسد اینجا برچسب دارد (آزمون Vitest
 * `auditActionLabels.test.tsx` کدهای نوشته‌شده را از خود کد پیدا می‌کند)؛ کد ناشناخته داده قدیمی است و همان‌طور نشان داده می‌شود.
 */
export const AUDIT_ACTION_LABELS = {
  LOGIN: 'ورود',
  LOGIN_FAILED: 'ورود ناموفق',
  LOGOUT: 'خروج',
  CREATE: 'ایجاد',
  UPDATE: 'ویرایش',
  DELETE: 'حذف',
  RESTORE: 'بازگردانی',
  REVIEW: 'بازخورد مدیریتی',
  SETTING_CHANGE: 'تغییر تنظیمات',
  VIEW: 'مشاهده',
  EXPORT: 'دریافت خروجی',
  IMPORT: 'بارگذاری از فایل',
  SEED: 'بارگذاری داده پایه',
  AUDIT: 'بررسی سلامت داده‌ها',
  AUDIT_APPLY: 'اصلاح موجودی',
  RECONCILIATION_EXECUTE: 'اجرای تطبیق',
  PURGE: 'پاک‌سازی سجل',
} as const satisfies Record<string, string>;

export type KnownAuditAction = keyof typeof AUDIT_ACTION_LABELS;

export function isKnownAuditAction(action: string): action is KnownAuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, action);
}

/** برچسب فارسی اقدام؛ کد ناشناخته (داده قدیمی) همان‌طور برمی‌گردد */
export function auditActionLabel(action: string | null | undefined): string {
  const code = String(action ?? '');
  return isKnownAuditAction(code) ? AUDIT_ACTION_LABELS[code] : code;
}

/** گزینه‌های پالایه اقدام: اقدام‌های شناخته به ترتیب جدول، سپس کدهای دیگری که سرور در سجل یافته */
export function auditActionOptions(serverActions: readonly unknown[] = []): Array<{ value: string; label: string }> {
  const known = Object.keys(AUDIT_ACTION_LABELS) as KnownAuditAction[];
  const others = [...new Set(serverActions.filter((a): a is string => typeof a === 'string' && a !== '' && !isKnownAuditAction(a)))].sort();
  return [...known, ...others].map(value => ({ value, label: auditActionLabel(value) }));
}
