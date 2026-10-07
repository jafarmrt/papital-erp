import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';

/**
 * v9.0.270 (TD-813، B12P-10): نرخ کارمزدی (نرخ پایه عنوان کار و نرخ اختصاصی پرسنل) عدد نامنفی است. پیش‌تر نرخ پایه «abc»
 * صفر و «-1000» منفی ذخیره می‌شد، و نرخ پایه منفی کارکرد هر پرسنل بی نرخ اختصاصی را منفی می‌کرد. ورودی عدد یا رشته با ارقام
 * لاتین، فارسی یا عربی و جداکننده هزارگان است؛ خالی یعنی «داده نشده». سرور (فرم، API و ورود اکسل) و پیش‌نمایش اکسل مرورگر هر
 * دو از این تابع می‌خوانند.
 */
export type PieceworkRateParse = { ok: true; value: string | undefined } | { ok: false; message: string };

export function parsePieceworkRate(raw: unknown, label: string): PieceworkRateParse {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  let clean: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, message: `${label} باید عدد معتبر باشد` };
    clean = String(raw);
  } else if (typeof raw === 'string') {
    clean = normalizeDecimalString(raw);
  } else {
    return { ok: false, message: `${label} باید عدد معتبر باشد` };
  }
  if (clean === '') return { ok: true, value: undefined };
  if (!DECIMAL_PATTERN.test(clean)) return { ok: false, message: `${label} باید عدد معتبر باشد (مقدار دریافتی: ${String(raw)})` };
  if (clean.startsWith('-') && /[1-9]/.test(clean)) return { ok: false, message: `${label} نمی‌تواند منفی باشد` };
  return { ok: true, value: clean.replace(/^-/, '') };
}
