import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money, type Money } from '../../lib/money.js';
import { ValidationError } from '../../errors/customErrors.js';
import { currencyScale } from '../../lib/currencyScale.js';

/**
 * v7.0.32 (TD-197 / audit P1-7): مالیات بر ارزش افزوده ساختاریافته اسناد فروش.
 *
 * documents.vat_amount تنها منبع مبلغ مالیات در سند حسابداری است (دیگر هیچ مبلغی از متن یادداشت استخراج
 * نمی‌شود). vat_percent برای نمایش و ویرایش فرم نگه داشته می‌شود؛ وقتی فقط درصد داده شود، مبلغ از جمع خالص
 * اقلام (Σ مقدار×قیمت − Σ تخفیف) با گرد کردن به عدد صحیح محاسبه و ذخیره می‌شود — همان قاعده پیشین سند حسابداری.
 */

export const VAT_DOC_TYPES: ReadonlySet<string> = new Set(['invoice', 'proforma']);

export interface DocumentVat {
  vatPercent: number;
  /** v7.0.68 (P2-6): Decimal، بدون عبور از double */
  vatAmount: Money;
}

export interface VatLine {
  quantity: unknown;
  unitPrice?: unknown;
  unit_price?: unknown;
  price?: unknown;
  discount?: unknown;
}

export interface VatInput {
  vatPercent?: unknown;
  vat_percent?: unknown;
  vatAmount?: unknown;
  vat_amount?: unknown;
}

function pick(primary: unknown, alias: unknown): unknown {
  return primary !== undefined ? primary : alias;
}

function parseOptionalNumber(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${label} باید عدد معتبر باشد (مقدار دریافتی: ${String(raw)}).`);
  }
  return value;
}

/** ورودی مالیات را می‌خواند و اعتبارسنجی می‌کند؛ اگر هیچ‌کدام ارسال نشده باشد هر دو undefined برمی‌گردند. */
export function parseVatInput(input: VatInput): { vatPercent?: number; vatAmount?: FinancialDecimal } {
  const vatPercent = parseOptionalNumber(pick(input.vatPercent, input.vat_percent), 'درصد مالیات بر ارزش افزوده');
  const rawVatAmount = pick(input.vatAmount, input.vat_amount);
  const vatAmount = parseOptionalNumber(rawVatAmount, 'مبلغ مالیات بر ارزش افزوده') !== undefined ? fin(rawVatAmount as DecimalValue) : undefined;
  if (vatPercent !== undefined && (vatPercent < 0 || vatPercent > 100)) {
    throw new ValidationError(`درصد مالیات بر ارزش افزوده باید بین ۰ تا ۱۰۰ باشد (مقدار دریافتی: ${vatPercent}).`);
  }
  if (vatAmount !== undefined && vatAmount.isNegative()) {
    throw new ValidationError(`مبلغ مالیات بر ارزش افزوده نمی‌تواند منفی باشد (مقدار دریافتی: ${vatAmount.toString()}).`);
  }
  return { vatPercent, vatAmount };
}

/** جمع خالص اقلام (پایه مالیات) با همان قاعده سند حسابداری فروش؛ منفی به صفر گرد می‌شود. */
export function computeNetAmount(lines: VatLine[]): FinancialDecimal {
  let gross = fin(0);
  let discount = fin(0);
  for (const line of lines) {
    const qty = fin(line.quantity as DecimalValue);
    const price = fin((line.unitPrice ?? line.unit_price ?? line.price ?? 0) as DecimalValue);
    gross = gross.add(qty.multiply(price));
    discount = discount.add(line.discount as DecimalValue);
  }
  const net = gross.round(4).subtract(discount.round(4));
  return net.isNegative() ? fin(0) : net.round(4);
}

/**
 * مالیات نهایی سند را تعیین می‌کند.
 * - مبلغ صریح ارسال شود → همان مبلغ (درصد ارسالی یا صفر فقط برای نمایش)
 * - فقط درصد ارسال شود → مبلغ = گرد(خالص × درصد ÷ ۱۰۰)
 * - هیچ‌کدام ارسال نشود → مقدار قبلی؛ اگر اقلام تغییر کرده و مالیات درصدی است، مبلغ از نو محاسبه می‌شود
 * اسناد غیر فروش همیشه مالیات صفر دارند.
 */
export function resolveDocumentVat(params: {
  docType: string;
  input: VatInput;
  lines: VatLine[];
  existing?: { vatPercent: number; vatAmount: DecimalValue };
  linesChanged?: boolean;
  /** v8.0.105 (TD-382): ارز سند؛ مالیات درصدی به کوچک‌ترین واحد همین ارز گرد می‌شود (ریال بی‌اعشار، ارز خارجی سِنت) */
  currency?: string | null;
}): DocumentVat {
  if (!VAT_DOC_TYPES.has(params.docType)) {
    return { vatPercent: 0, vatAmount: money(0) };
  }
  const { vatPercent, vatAmount } = parseVatInput(params.input);
  const scale = currencyScale(params.currency);
  const vatOf = (pct: number): FinancialDecimal => (pct > 0 ? computeNetAmount(params.lines).multiply(pct).divide(100, 12).round(scale) : fin(0));
  if (vatAmount !== undefined) {
    // v8.0.104 (TD-381): مبلغ صریح همراه درصد مثبت باید همان مبلغ درصدی سرور باشد؛ پیش‌تر هر مبلغی (درصد ۱۰ با مالیات ۱
    // ریال) ذخیره می‌شد. مبلغ صریح بی درصد (مالیات سفارش ووکامرس) همان‌طور پذیرفته می‌شود.
    if (vatPercent !== undefined && vatPercent > 0) {
      const expected = vatOf(vatPercent);
      if (!vatAmount.round(4).equals(expected)) {
        throw new ValidationError(
          `مبلغ مالیات (${vatAmount.toString()}) با ${vatPercent}٪ جمع خالص اقلام (${expected.toString()}) یکی نیست؛ فرم را تازه کنید یا فقط درصد مالیات را بفرستید.`,
          { code: 'VAT_AMOUNT_MISMATCH', expected: expected.toNumber() }
        );
      }
    }
    return { vatPercent: vatPercent ?? 0, vatAmount: money(vatAmount.round(4)) };
  }
  const percentFromPercentage = (pct: number): DocumentVat => ({ vatPercent: pct, vatAmount: money(vatOf(pct)) });
  if (vatPercent !== undefined) {
    return percentFromPercentage(vatPercent);
  }
  const existing = params.existing ?? { vatPercent: 0, vatAmount: 0 };
  if (params.linesChanged && existing.vatPercent > 0) {
    return percentFromPercentage(existing.vatPercent);
  }
  return { vatPercent: Number(existing.vatPercent) || 0, vatAmount: money(existing.vatAmount) };
}
