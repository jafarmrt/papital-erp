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

/**
 * v9.0.339 (TD-710، B15-08، تصمیم ت۶ الف): پوشش در همه پاسخ‌ها، برای همه کاربران و مدیر سیستم هم.
 * مقدار خالی خالی می‌ماند تا روشن باشد کلیدی ذخیره نشده است.
 */
export function maskSecretValue(value: unknown): string {
  return typeof value === 'string' && value !== '' ? MASKED_SECRET_VALUE : '';
}

/** نام سرآیندها پیدا می‌ماند و هر مقدار پوشیده می‌شود (توکن API شریک در سرآیند می‌آید) */
export function maskHeaderValues(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(Object.entries(headers as Record<string, unknown>).map(([name, value]) => [name, maskSecretValue(String(value ?? ''))]));
}
