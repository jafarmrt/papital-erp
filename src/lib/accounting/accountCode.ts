import { toLatinDigits } from '../numericInput.js';

/**
 * v9.0.201 (TD-558، B03-16): کد سرفصل فقط رقم لاتین است. رقم فارسی و عربی پیش از ذخیره لاتین می‌شود؛ گزارش‌ها
 * حساب را با پیشوند کد دسته می‌کنند (دارایی جاری «1»، نقد «10» و «11»)، پس کد «۱۱۰۵» صندوق را دارایی غیرجاری
 * می‌دانست و نسبت جاری صفر می‌شد. همین قاعده در سرور و فرم سرفصل.
 */
export const ACCOUNT_CODE_PATTERN = /^[0-9]{1,20}$/;

export const ACCOUNT_CODE_FORMAT_MESSAGE = 'کد حساب فقط رقم است (مثلاً ۱۱۰۱)، حداکثر بیست رقم.';

export function normalizeAccountCode(raw: unknown): string {
  return toLatinDigits(String(raw ?? '')).trim();
}

export function isValidAccountCode(code: string): boolean {
  return ACCOUNT_CODE_PATTERN.test(code);
}
