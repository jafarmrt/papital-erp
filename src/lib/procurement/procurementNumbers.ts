import { fin, type DecimalValue } from '../financialDecimal';
import { normalizeDecimalString } from '../numericInput';

/**
 * OBS-R2-39 (TD-992): عدد و مبلغ رابط تدارکات. مبلغ ردیف و جمع‌ها با FinancialDecimal حساب می‌شوند، نه با `*` و `+`
 * عدد جاوااسکریپت (۰٫۱ × ۳ = ۰٫۳۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۴)، و مقدار و برآورد قیمت فرم درخواست خرید متن خوانده می‌شوند، با
 * ارقام فارسی، نه `type="number"` که ارقام فارسی را دور می‌ریزد.
 */

const toDecimal = (value: DecimalValue | null | undefined) => {
  const n = typeof value === 'number' ? value : Number(normalizeDecimalString(String(value ?? '')));
  return fin(Number.isFinite(n) ? n : 0);
};

/** مقدار × قیمت واحد */
export function lineAmount(quantity: DecimalValue | null | undefined, unitPrice: DecimalValue | null | undefined): number {
  return toDecimal(quantity).multiply(toDecimal(unitPrice)).toNumber();
}

/** جمع مبلغ ردیف‌ها */
export function sumAmounts<T>(rows: readonly T[], amountOf: (row: T) => DecimalValue | null | undefined): number {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum.add(toDecimal(amountOf(row))), fin(0)).toNumber();
}

/** حداکثر رقم اعشار مقدار درخواست خرید */
export const REQUISITION_QTY_SCALE = 4;

export type DecimalTextResult = { ok: true; value: number } | { ok: false; error: string };

const DECIMAL_TEXT = /^\d*(\.\d*)?$/;
const persianDigits = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** متن کادر عدد نامنفی؛ خالی صفر است و متن نامعتبر خطا، هرگز صفرِ بی‌صدا */
export function readDecimalText(raw: string, scale: number, noun: string): DecimalTextResult {
  const text = normalizeDecimalString(String(raw ?? ''));
  if (text === '') return { ok: true, value: 0 };
  if (!DECIMAL_TEXT.test(text) || text === '.') return { ok: false, error: `${noun} فقط رقم و ممیز می‌پذیرد.` };
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > scale) {
    return { ok: false, error: scale === 0 ? `${noun} اعشار ندارد.` : `${noun} حداکثر ${persianDigits(scale)} رقم اعشار دارد.` };
  }
  return { ok: true, value: Number(text) };
}
