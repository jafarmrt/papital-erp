/**
 * v9.0.226 (TD-665 / TD-666): متن کادر مبلغ جدا از عدد آن.
 * کادر مبلغ متن خام را تا پایان ویرایش نگه می‌دارد، پس «12.» و «12.5» از دست نمی‌روند، و ورودی نامعتبر مقدار قبلی را
 * نگه می‌دارد و پیام می‌دهد، نه اینکه مبلغ را صفر کند. تعداد اعشار مجاز از `currencyScale` ارز می‌آید (ریال ۰، ارز ۲).
 */
import { normalizeDecimalString } from './numericInput.js';

export interface AmountTextOptions {
  /** حداکثر رقم اعشار (`currencyScale`) */
  scale: number;
  allowNegative: boolean;
}

export type AmountTextResult =
  | { ok: true; text: string; value: number }
  | { ok: false; error: string };

/** برچسب ارزی که با کپی مبلغ از خود برنامه همراه عدد می‌آید («۱٬۲۵۰٬۰۰۰ ریال») */
const CURRENCY_SUFFIX = /\s*(ریال|تومان|دلار|یورو|درهم|پوند|IRR|USD|EUR|AED|GBP|TOMAN)\s*$/i;
const AMOUNT_TEXT = /^-?\d*(\.\d*)?$/;

/** متن تایپ‌شده یا چسبانده‌شده را می‌خواند؛ ارقام فارسی و عربی، «٫» و جداکننده‌های هزارگان پذیرفته می‌شوند */
export function readAmountText(raw: string, options: AmountTextOptions): AmountTextResult {
  const text = normalizeDecimalString(String(raw ?? '').replace(CURRENCY_SUFFIX, ''));
  if (!AMOUNT_TEXT.test(text)) return { ok: false, error: 'مبلغ فقط رقم و ممیز می‌پذیرد' };
  if (text.startsWith('-') && !options.allowNegative) return { ok: false, error: 'مبلغ منفی پذیرفته نیست' };
  const fraction = text.split('.')[1];
  if (fraction !== undefined && options.scale === 0) return { ok: false, error: 'این مبلغ اعشار ندارد' };
  if (fraction !== undefined && fraction.length > options.scale) {
    return { ok: false, error: `این مبلغ حداکثر ${String(options.scale).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} رقم اعشار دارد` };
  }
  const sign = text.startsWith('-') ? '-' : '';
  const [intPart, frac] = text.replace('-', '').split('.');
  const intDigits = intPart.replace(/^0+(?=\d)/, '');
  const clean = sign + intDigits + (frac !== undefined ? `.${frac}` : '');
  const numeric = Number(`${sign}${intDigits || '0'}.${frac || '0'}`);
  return { ok: true, text: clean, value: Number.isFinite(numeric) ? numeric : 0 };
}

/** متن پذیرفته‌شده با جداکننده هزارگان (کادر چپ‌به‌راست با ارقام لاتین) */
export function groupAmountText(text: string): string {
  if (!text) return '';
  const sign = text.startsWith('-') ? '-' : '';
  const [intPart, frac] = text.replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (frac !== undefined ? `.${frac}` : '');
}

/** متن یک مقدار عددی برای کادر، بی گرد کردن و بی نماد علمی */
export function amountTextOf(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(normalizeDecimalString(String(value)));
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '0' : '';
  const s = Math.abs(n) < 1e21 ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : '';
  return s;
}
