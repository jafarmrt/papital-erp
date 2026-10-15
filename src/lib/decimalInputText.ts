/**
 * v10.1.20 (TD-1273، قاعده فرم وایب فارسی): متن کادر عدد.
 * کادر `type=number` در کروم ارقام فارسی را دور می‌ریزد («۱۲۵» خالی می‌شد) و ممیز «٫» را نمی‌شناسد («12٫5» صد و بیست و
 * پنج می‌شد). کادر عدد متن است و اینجا خوانده می‌شود: ارقام فارسی و عربی، «٫» و جداکننده‌های هزارگان پذیرفته می‌شوند،
 * متن نامعتبر خطاست و هرگز صفر بی‌صدا نمی‌شود.
 */
import { normalizeDecimalString, toLatinDigits } from './numericInput.js';
import { formatPersianNumber } from '../utils/persianNumber.js';

export interface DecimalInputRules {
  /** کمترین مقدار؛ بدون آن یا با کمینه منفی، عدد منفی پذیرفته است */
  min?: number | string;
  max?: number | string;
  /** گام کادر قدیمی: «any» بی‌حد، «0.01» دو رقم اعشار، «1» یا «500» بی‌اعشار؛ بدون آن اعشار آزاد است */
  step?: number | string;
}

export type DecimalInputRead =
  /** متن لاتین (خالی برای کادر خالی) و خطای بازه یا اعشار، اگر باشد */
  | { kind: 'value'; text: string; rangeError?: string }
  /** نیمه‌کاره مثل «-» یا «.»: هنوز مقدار نیست؛ پیام آن تنها هنگام ارسال فرم دیده می‌شود */
  | { kind: 'partial' }
  | { kind: 'invalid'; error: string };

const DECIMAL_TEXT = /^-?\d*(\.\d*)?$/;
const PARTIAL_TEXT = /^-?\.?$/;

const ruleNumber = (raw: number | string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/** رقم اعشار مجاز از گام؛ undefined یعنی بی‌حد */
export function stepScale(step: number | string | undefined): number | undefined {
  if (step === undefined || step === '' || step === 'any') return undefined;
  const text = String(step);
  if (!Number.isFinite(Number(text)) || Number(text) <= 0) return undefined;
  const fraction = text.split('.')[1];
  return fraction ? fraction.length : 0;
}

const GROUP_SEPARATOR = /[,٬،]/;
const GROUPED_TEXT = /^-?\d{1,3}([,٬،]\d{3})+(\.\d*)?$/;
const INVISIBLE = /[\s\u200c\u200e\u200f]/g;

/**
 * متن یکدست کادر: ارقام لاتین، ممیز «٫» یا «/» میان رقم‌ها (مثل «12/5») و جداکنندهٔ هزارگان فقط میان دسته‌های سه‌رقمی؛
 * «12,5» عدد صد و بیست و پنج نمی‌شود و خطاست
 */
function canonicalText(raw: string): { text: string } | { error: string } {
  const text = toLatinDigits(String(raw ?? '')).replace(/٫/g, '.').replace(INVISIBLE, '').replace(/(\d)\/(?=\d|$)/, '$1.');
  if (!GROUP_SEPARATOR.test(text)) return { text };
  if (!GROUPED_TEXT.test(text)) return { error: 'جداکنندهٔ هزارگان فقط میان دسته‌های سه‌رقمی می‌آید؛ برای ممیز «٫» یا «/» بزنید.' };
  return { text: normalizeDecimalString(text) };
}

export function readDecimalInputText(raw: string, rules: DecimalInputRules = {}): DecimalInputRead {
  const canonical = canonicalText(raw);
  if ('error' in canonical) return { kind: 'invalid', error: canonical.error };
  const { text } = canonical;
  if (text === '') return { kind: 'value', text: '' };
  if (PARTIAL_TEXT.test(text)) return { kind: 'partial' };
  if (!DECIMAL_TEXT.test(text)) return { kind: 'invalid', error: 'فقط رقم و ممیز پذیرفته می‌شود.' };
  const min = ruleNumber(rules.min);
  if (text.startsWith('-') && min !== undefined && min >= 0) return { kind: 'invalid', error: 'عدد منفی پذیرفته نیست.' };
  const value = Number(text);
  const scale = stepScale(rules.step);
  const fraction = text.split('.')[1] ?? '';
  const max = ruleNumber(rules.max);
  let rangeError: string | undefined;
  if (scale !== undefined && fraction.length > scale) {
    rangeError = scale === 0 ? 'این عدد اعشار ندارد.' : `حداکثر ${formatPersianNumber(scale)} رقم اعشار پذیرفته است.`;
  } else if (min !== undefined && value < min) {
    rangeError = `کمتر از ${formatPersianNumber(min, 6)} نباشد.`;
  } else if (max !== undefined && value > max) {
    rangeError = `بیشتر از ${formatPersianNumber(max, 6)} نباشد.`;
  }
  return rangeError ? { kind: 'value', text, rangeError } : { kind: 'value', text };
}

/** پیام مرورگر برای متن نیمه‌کاره هنگام ارسال فرم */
export const PARTIAL_DECIMAL_MESSAGE = 'عدد را کامل بنویسید.';

/** آیا متن کادر همان مقدار بیرونی را می‌گوید؟ (تا «12.» با رسیدن 12 از دست نرود) */
export function decimalTextMatches(text: string, value: number | string | null | undefined): boolean {
  const read = readDecimalInputText(text);
  const own = read.kind === 'value' ? read.text : normalizeDecimalString(text);
  const outer = value === null || value === undefined ? '' : normalizeDecimalString(String(value));
  if (own === '' || outer === '') return own === outer;
  const a = Number(own);
  const b = Number(outer);
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : own === outer;
}

/** متن کادر برای مقدار بیرونی، بی نماد علمی */
export function decimalTextOf(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Math.abs(value) < 1e21 ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : String(value);
  }
  return value;
}
