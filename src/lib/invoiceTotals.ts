import { fin, type DecimalValue } from './financialDecimal.js';
import { currencyScale } from './currencyScale.js';

export interface InvoiceTotalsLine {
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  discount?: DecimalValue;
}

export interface InvoiceTotals {
  /** جمع ناخالص اقلام (تعداد × فی) */
  gross: number;
  discount: number;
  /** پایه مالیات؛ منفی به صفر گرد می‌شود */
  net: number;
  vatAmount: number;
  payable: number;
}

/**
 * v7.0.76 (audit P3-6): جمع‌های فرم فاکتور فروش با Decimal و همان قاعده سرور (`computeNetAmount` و مالیات درصدی
 * `resolveDocumentVat` در src/services/documents/documentVat.ts): مبلغ مالیات = گرد(خالص × درصد ÷ ۱۰۰) به ریال.
 * پیش‌تر فرم آن را با ضرب اعشاری جاوااسکریپت می‌ساخت؛ از v8.0.104 (TD-381) فرم فقط درصد را می‌فرستد و سرور مبلغ را حساب می‌کند.
 * v8.0.105 (TD-382): مالیات به کوچک‌ترین واحد ارز سند گرد می‌شود (ریال بی‌اعشار، ارز خارجی سِنت)، همان قاعده سرور.
 */
export function computeInvoiceTotals(lines: readonly InvoiceTotalsLine[] | null | undefined, vatPercent: number, currency = 'IRR'): InvoiceTotals {
  const safeLines = Array.isArray(lines) ? lines : [];
  let gross = fin(0);
  let discount = fin(0);
  for (const line of safeLines) {
    gross = gross.add(fin(line.quantity).multiply(fin(line.unitPrice)));
    discount = discount.add(fin(line.discount));
  }
  const rawNet = gross.round(4).subtract(discount.round(4));
  const net = rawNet.isNegative() ? fin(0) : rawNet.round(4);
  const vat = vatPercent > 0 ? net.multiply(vatPercent).divide(100, 12).round(currencyScale(currency)) : fin(0);
  return {
    gross: gross.round(4).toNumber(),
    discount: discount.round(4).toNumber(),
    net: net.toNumber(),
    vatAmount: vat.toNumber(),
    payable: net.add(vat).toNumber(),
  };
}
