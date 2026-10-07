/**
 * v9.0.248 (TD-673، تصمیم ت۵ ب): خانه کد ملی ورود اکسل پرسنل، مشترک سرور و پیش‌نمایش.
 * اکسل صفر اول کد ملی عددی را می‌اندازد، پس فقط این‌جا ورودی ۸ و ۹ رقمی با صفر به ۱۰ رقم می‌رسد و ردیف در گزارش ورود
 * فهرست می‌شود تا بررسی شود؛ ورودی کوتاه‌تر یا بلندتر، یا کدی که رقم کنترل آن نمی‌خواند، خطای ردیف است. فرم‌ها هرگز پر نمی‌کنند.
 */
import { normalizeNationalId, validateIranianNationalId } from '../../utils/cardValidation.js';

export interface ImportedNationalId {
  /** کد ده رقمی، یا خالی وقتی خانه خالی است */
  value: string;
  /** با صفر اول تکمیل شد (۸ یا ۹ رقم در فایل) */
  padded: boolean;
  error?: string;
}

export function readImportedNationalId(raw: unknown): ImportedNationalId {
  const digits = normalizeNationalId(raw === null || raw === undefined ? '' : String(raw)).replace(/\D/g, '');
  if (!digits) return { value: '', padded: false };
  const padded = digits.length === 8 || digits.length === 9;
  const value = padded ? digits.padStart(10, '0') : digits;
  const check = validateIranianNationalId(value);
  if (!check.isValid) return { value, padded, error: check.error ?? 'کد ملی نامعتبر است' };
  return { value, padded };
}

/** متن هشدار ردیفی که کد ملی‌اش با صفر تکمیل شد */
export function paddedNationalIdNotice(value: string): string {
  return `کد ملی با صفر اول به ${value.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} تکمیل شد؛ آن را بررسی کنید.`;
}
