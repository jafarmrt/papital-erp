/**
 * v9.0.230 (TD-673، تصمیم ت۵ ب): کد ملی پرسنل در ثبت و ویرایش دقیقاً ۱۰ رقم با رقم کنترل درست است و هرگز با صفر پر نمی‌شود.
 * کد قدیمی‌ای که در ویرایش تغییر نکرده دست نمی‌خورد و سنجیده نمی‌شود؛ خانه خالی یعنی بی کد ملی.
 */
import { ValidationError } from '../../errors/customErrors.js';
import { normalizeNationalId, validateIranianNationalId } from '../../utils.js';

export function requirePersonnelNationalId(raw: unknown, previous?: string | null): string {
  const value = raw === null || raw === undefined ? '' : normalizeNationalId(String(raw));
  if (!value) return '';
  if (previous !== undefined && value === normalizeNationalId(previous ?? '')) return value;
  const check = validateIranianNationalId(value);
  if (!check.isValid) throw new ValidationError(check.error ?? 'کد ملی نامعتبر است', undefined, 'NATIONAL_ID_INVALID');
  return value;
}
