import { fin } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';

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
  vatAmount: number;
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
export function parseVatInput(input: VatInput): { vatPercent?: number; vatAmount?: number } {
  const vatPercent = parseOptionalNumber(pick(input.vatPercent, input.vat_percent), 'درصد مالیات بر ارزش افزوده');
  const vatAmount = parseOptionalNumber(pick(input.vatAmount, input.vat_amount), 'مبلغ مالیات بر ارزش افزوده');
  if (vatPercent !== undefined && (vatPercent < 0 || vatPercent > 100)) {
    throw new ValidationError(`درصد مالیات بر ارزش افزوده باید بین ۰ تا ۱۰۰ باشد (مقدار دریافتی: ${vatPercent}).`);
  }
  if (vatAmount !== undefined && vatAmount < 0) {
    throw new ValidationError(`مبلغ مالیات بر ارزش افزوده نمی‌تواند منفی باشد (مقدار دریافتی: ${vatAmount}).`);
  }
  return { vatPercent, vatAmount };
}

/** جمع خالص اقلام (پایه مالیات) با همان قاعده سند حسابداری فروش؛ منفی به صفر گرد می‌شود. */
export function computeNetAmount(lines: VatLine[]): number {
  let gross = fin(0);
  let discount = fin(0);
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unitPrice ?? line.unit_price ?? line.price ?? 0) || 0;
    gross = gross.add(fin(qty).multiply(price));
    discount = discount.add(Number(line.discount) || 0);
  }
  const net = gross.round(4).subtract(discount.round(4));
  return net.isNegative() ? 0 : net.round(4).toNumber();
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
  existing?: DocumentVat;
  linesChanged?: boolean;
}): DocumentVat {
  if (!VAT_DOC_TYPES.has(params.docType)) {
    return { vatPercent: 0, vatAmount: 0 };
  }
  const { vatPercent, vatAmount } = parseVatInput(params.input);
  if (vatAmount !== undefined) {
    return { vatPercent: vatPercent ?? 0, vatAmount: fin(vatAmount).round(4).toNumber() };
  }
  const percentFromPercentage = (pct: number): DocumentVat => ({
    vatPercent: pct,
    vatAmount: pct > 0 ? fin(computeNetAmount(params.lines)).multiply(pct).divide(100).round(0).toNumber() : 0,
  });
  if (vatPercent !== undefined) {
    return percentFromPercentage(vatPercent);
  }
  const existing = params.existing ?? { vatPercent: 0, vatAmount: 0 };
  if (params.linesChanged && existing.vatPercent > 0) {
    return percentFromPercentage(existing.vatPercent);
  }
  return { vatPercent: Number(existing.vatPercent) || 0, vatAmount: Number(existing.vatAmount) || 0 };
}
