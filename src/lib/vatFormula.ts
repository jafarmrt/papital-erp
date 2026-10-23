import { fin, type DecimalValue, type FinancialDecimal } from './financialDecimal.js';
import { currencyScale } from './currencyScale.js';

/**
 * 10.3 (ARCH review finding 6): the one VAT formula of a sales document, shared by the server (`resolveDocumentVat` and
 * `computeNetAmount` in src/services/documents/documentVat.ts, the WooCommerce order percent) and the invoice form
 * (`computeInvoiceTotals` in src/lib/invoiceTotals.ts). Before, the form wrote the same steps again; the server refuses an
 * amount that differs from its own, so a drift showed the user an error, never a wrong document. VAT stays optional: a
 * percent of zero (or none) is no VAT.
 */
export interface VatBaseLine {
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  discount?: DecimalValue;
}

export interface VatBase {
  /** Σ quantity × unit price, to 4 places */
  gross: FinancialDecimal;
  /** Σ line discount, to 4 places */
  discount: FinancialDecimal;
  /** the VAT base: gross − discount, never below zero, to 4 places */
  net: FinancialDecimal;
}

export function vatBaseOf(lines: Iterable<VatBaseLine>): VatBase {
  let gross = fin(0);
  let discount = fin(0);
  for (const line of lines) {
    gross = gross.add(fin(line.quantity).multiply(fin(line.unitPrice)));
    discount = discount.add(fin(line.discount));
  }
  const net = gross.round(4).subtract(discount.round(4));
  return { gross: gross.round(4), discount: discount.round(4), net: net.isNegative() ? fin(0) : net.round(4) };
}

/** VAT at a percent of a base: base × percent ÷ 100, rounded to the smallest unit of the currency (whole rials, cents) */
export function percentVatOf(net: FinancialDecimal, vatPercent: number, currency?: string | null): FinancialDecimal {
  return vatPercent > 0 ? net.multiply(vatPercent).divide(100, 12).round(currencyScale(currency)) : fin(0);
}
