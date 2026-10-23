import { fin, type DecimalValue } from './financialDecimal.js';
import { percentVatOf, vatBaseOf } from './vatFormula.js';

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
  /** v10.0.260 (TD-1136): هزینه ارسال و خدمات (`documents.service_charge_amount`) */
  serviceCharge: number;
  payable: number;
}

/**
 * v7.0.76 (audit P3-6): جمع‌های فرم فاکتور فروش با Decimal و همان قاعده سرور (`computeNetAmount` و مالیات درصدی
 * `resolveDocumentVat` در src/services/documents/documentVat.ts): مبلغ مالیات = گرد(خالص × درصد ÷ ۱۰۰) به ریال.
 * پیش‌تر فرم آن را با ضرب اعشاری جاوااسکریپت می‌ساخت؛ از v8.0.104 (TD-381) فرم فقط درصد را می‌فرستد و سرور مبلغ را حساب می‌کند.
 * v8.0.105 (TD-382): مالیات به کوچک‌ترین واحد ارز سند گرد می‌شود (ریال بی‌اعشار، ارز خارجی سِنت)، همان قاعده سرور.
 * v10.0.260 (TD-1136): مبلغ قابل پرداخت = خالص + مالیات + هزینه ارسال و خدمات، همان `computeDocumentAmounts` سرور.
 * 10.3 (ARCH review finding 6): the base and the VAT come from the server's own functions (`vatBaseOf`, `percentVatOf` in
 * src/lib/vatFormula.ts), no longer from a copy of their steps.
 */
export function computeInvoiceTotals(
  lines: readonly InvoiceTotalsLine[] | null | undefined, vatPercent: number, currency = 'IRR', serviceCharge: DecimalValue = 0,
): InvoiceTotals {
  const { gross, discount, net } = vatBaseOf(Array.isArray(lines) ? lines : []);
  const vat = percentVatOf(net, vatPercent, currency);
  const service = fin(serviceCharge ?? 0);
  return {
    gross: gross.toNumber(),
    discount: discount.toNumber(),
    net: net.toNumber(),
    vatAmount: vat.toNumber(),
    serviceCharge: service.toNumber(),
    payable: net.add(vat).add(service).toNumber(),
  };
}
