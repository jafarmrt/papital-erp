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
/**
 * عددی که جداکننده‌اش فقط میان دسته‌های سه‌رقمی بخش صحیح آمده است («۱٬۲۳۴٬۵۶۷٫۸»); v11 phase 3.1 (M4): the first group
 * starts with 1-9 after any leading zeros, so «0,500» (a decimal comma) is not read as 500, while «05,000» (typed after the 0
 * a number field shows) is still 5000
 */
export const GROUPED_TEXT = /^-?0*[1-9]\d{0,2}([,٬،]\d{3})+(\.\d*)?$/;

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

/** v11 phase 3.1 (M4): a group separator left outside groups of three digits («12,5»), which no saved value accepts */
export function hasMisplacedGroupSeparator(value: string): boolean {
  return GROUP_SEPARATOR.test(normalizeGroupedDecimalString(value));
}

export const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * v11 phase 6.1a (M16, S10, S12): the money, price and quantity columns are `numeric(18,4)`, so a value has at most 14
 * whole digits and 4 decimals
 */
export const DECIMAL_INPUT_MAX_SCALE = 4;
export const DECIMAL_INPUT_MAX_WHOLE_DIGITS = 14;
export type DecimalBoundIssue = 'scale' | 'size';

/** the bound a decimal text (`DECIMAL_PATTERN`) breaks, or null */
export function decimalTextScaleIssue(text: string): DecimalBoundIssue | null {
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  if (whole.replace(/^0+/, '').length > DECIMAL_INPUT_MAX_WHOLE_DIGITS) return 'size';
  if (fraction.replace(/0+$/, '').length > DECIMAL_INPUT_MAX_SCALE) return 'scale';
  return null;
}

/** the float noise a computed double may carry, as a share of its size (a few units in the last place) */
const DOUBLE_NOISE = 4 * Number.EPSILON;

/**
 * v11 phase 6.1a (review of #403): a JavaScript number as plain decimal text with at most `maxScale` decimals, or null
 * when the number really has more. A computed number carries a few units of noise in its last place («1.1 * 3» is
 * 3.3000000000000003, a price formula in Excel «1850000 * 1.1» is 2035000.0000000002), so a number that close to its
 * `maxScale`-decimal value is that value. A fifth decimal someone typed («100.00005», «12345678901.23456») is further
 * away and stays refused. The noise allowed grows with the number, so a fifth decimal is always refused below about
 * 1e10 and always read as the rounded value (off by at most 0.00005) from about 6e10; in between it depends on the
 * digits («20000000000.00001» reads as 20000000000). Shared by the server's reading of JSON numbers and the browser code
 * that sends a computed number as text.
 */
export function computedDecimalText(value: number, maxScale = 4): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(maxScale));
  if (Math.abs(value - rounded) > DOUBLE_NOISE * Math.max(1, Math.abs(value))) return null;
  const text = String(rounded === 0 ? 0 : rounded);
  return DECIMAL_PATTERN.test(text) ? text : null;
}
