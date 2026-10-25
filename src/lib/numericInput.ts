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

/** جداکنندهٔ هزارگان: «,»، «٬» یا «،» */
export const GROUP_SEPARATOR = /[,٬،]/;
/** عددی که جداکننده‌اش فقط میان دسته‌های سه‌رقمی بخش صحیح آمده است («۱٬۲۳۴٬۵۶۷٫۸») */
export const GROUPED_TEXT = /^-?\d{1,3}([,٬،]\d{3})+(\.\d*)?$/;

/** رشته عدد اعشاری با ارقام لاتین: ارقام فارسی و عربی، ممیز «٫»، جداکننده‌های هزارگان و فاصله‌ها نرمال می‌شوند */
export function normalizeDecimalString(value: string): string {
  return toLatinDigits(value)
    .replace(/٫/g, '.')
    .replace(/[,٬،\s‌‏‎]/g, '')
    .trim();
}

/**
 * v11 phase 3.1 (M4): the reader of a value that is saved (`decimalInput` on every server route, the Excel import, the
 * settings): as `normalizeDecimalString`, but a group separator is removed only between groups of three digits of the
 * whole part (`GROUPED_TEXT`, the browser's rule in `decimalInputText.ts`); a misplaced one («12,5»، «۱٬۰») stays in the
 * text, so `DECIMAL_PATTERN` refuses it. Before, the server dropped it and read «12,5» as 125. The lenient form above stays
 * for typing and display, where a half-typed amount is reformatted.
 */
export function normalizeGroupedDecimalString(value: string): string {
  const text = toLatinDigits(value)
    .replace(/٫/g, '.')
    .replace(/[\s‌‏‎]/g, '');
  return GROUP_SEPARATOR.test(text) && !GROUPED_TEXT.test(text) ? text : normalizeDecimalString(text);
}

export const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
