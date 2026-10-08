/**
 * v9.0.305 (TD-677، B16-13): شکل نشانی پیش‌نویس فرم. نوع (`invoice`، `voucher` و ...) و کلید (`new_invoice`، `edit_12`)
 * فقط حروف لاتین، رقم، «_» و «-» با سقف طول‌اند. پیش‌تر هر رشته‌ای پذیرفته می‌شد و نویسه `\u0000` خطای خام پایگاه‌داده را
 * با متن SQL و پارامترها به مرورگر برمی‌گرداند.
 */
export const DRAFT_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
export const DRAFT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DRAFT_DEFAULT_KEY = 'default';

/**
 * v9.0.306 (TD-676، B16-12): پیش‌نویس ۱ تا ۹۰ روز می‌ماند (پیش‌فرض ۳۰). پیش‌نویس منقضی برگردانده نمی‌شود و پاک‌سازی
 * روزانه آن را حذف نرم می‌کند. پیش‌تر `expires_at` خوانده نمی‌شد و پیش‌نویس ماه‌ها پیش بنر «بازیابی» را می‌آورد.
 */
export const DRAFT_EXPIRY_DAYS = { min: 1, max: 90, default: 30 } as const;

/** آیا شمار روز ماندگاری پیش‌نویس پذیرفتنی است */
export function isValidDraftExpiryDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= DRAFT_EXPIRY_DAYS.min && days <= DRAFT_EXPIRY_DAYS.max;
}
