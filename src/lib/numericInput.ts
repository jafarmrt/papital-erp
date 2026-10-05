/**
 * v8.0.108 (TD-385): ورودی عددی با ارقام فارسی (۰-۹) یا عربی (٠-٩)، ممیز فارسی «٫» و جداکننده هزارگان «٬» یا «,».
 * پیش‌تر `fin('۵۰۰۰۰۰')` بی‌خطا صفر و `Number('۵۰۰')` NaN می‌شد، پس پاداش، کسور، کسر مساعده، مبلغ پرداخت فیش و نرخ
 * کارکرد با ارقام فارسی صفر یا نادیده گرفته می‌شدند.
 */
const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** ارقام فارسی و عربی را لاتین می‌کند؛ بقیه نویسه‌ها دست نمی‌خورند (برای شماره چک، شناسه صیادی و کدها) */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, ch => {
    const code = ch.charCodeAt(0);
    return String(code >= PERSIAN_ZERO ? code - PERSIAN_ZERO : code - ARABIC_ZERO);
  });
}

/** رشته عدد اعشاری با ارقام لاتین: ارقام فارسی و عربی، ممیز «٫»، جداکننده‌های هزارگان و فاصله‌ها نرمال می‌شوند */
export function normalizeDecimalString(value: string): string {
  return toLatinDigits(value)
    .replace(/٫/g, '.')
    .replace(/[,٬،\s‌‏‎]/g, '')
    .trim();
}

export const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
