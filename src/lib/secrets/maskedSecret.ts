/**
 * مقدار پوشیده کلیدهای محرمانه در پاسخ‌ها و فرم‌ها (مشترک مرورگر و کارساز).
 * v9.0.337 (TD-719، B15-17): مقدار پوشیده هرگز به‌جای خود کلید ذخیره یا به کار برده نمی‌شود. پاسخ‌های وب‌هوک کلید امضا را
 * برای غیرمدیر «****…abcd» یا «********» برمی‌گرداندند و فرم ویرایش همین را پس می‌فرستاد، پس ذخیره کلید واقعی را با پوشش
 * جایگزین می‌کرد و امضای HMAC نزد همه گیرنده‌ها می‌شکست.
 */

/** مقدار پوشیده یک کلید محرمانه در پاسخ‌ها (همان `MASKED_SETTING_VALUE` تنظیمات) */
export const MASKED_SECRET_VALUE = '********';

/** پوشش کامل یا پوشش با چهار نویسه آخر («****…abcd»، شکل قدیمی پاسخ وب‌هوک) */
const MASKED_PATTERN = /^\*{4,}[^*]{0,4}$/;

export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && MASKED_PATTERN.test(value.trim());
}

/** کلیدی که کاربر واقعاً وارد کرده است: نه خالی و نه پوشیده */
export function isEnteredSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !isMaskedSecret(value);
}
