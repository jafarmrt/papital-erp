import { fin } from '../financialDecimal';
import { addLineDiscount, addLineGross, addLineQuantity, amountDecimalsOf, documentPayableOf, type InvoiceListDocument, type InvoiceListLine } from './invoiceListDocuments';

/** سند در پاسخ GET /documents/:id با نام‌های snake_case و camelCase مالیات و هزینه خدمات */
export interface PrintableDocument extends InvoiceListDocument {
  vat_amount?: number | string | null;
  vat_percent?: number | string | null;
  vatPercent?: number | string | null;
  service_charge_amount?: number | string | null;
  payable_amount?: number | string | null;
}

export interface PrintableLineAmounts {
  quantity: number;
  unitPrice: number;
  discount: number;
  /** تعداد × فی */
  total: number;
  /** مبلغ ردیف پس از تخفیف */
  net: number;
}

export interface PrintTotals {
  /** رقم اعشار مبالغ این سند: ریال بی‌اعشار، ارز خارجی ۲ (همان جدول و جزئیات لیست فاکتورها، TD-235) */
  decimals: number;
  gross: number;
  discount: number;
  vatAmount: number;
  vatPercent: number;
  serviceChargeAmount: number;
  /** مبلغ قابل پرداخت سرور (payableAmount)، وگرنه خالص اقلام + مالیات + هزینه خدمات */
  payable: number;
  quantity: number;
}

const firstNumber = (...values: Array<number | string | null | undefined>): number => {
  const found = values.find(v => v !== undefined && v !== null && v !== '');
  return found === undefined ? 0 : fin(found).toNumber();
};

/**
 * v8.0.84 (TD-383): جمع‌های فاکتور چاپی با Decimal و مبلغ قابل پرداخت همان مقدار سرور؛ پیش‌تر با ضرب و جمع اعشاری
 * مرورگر از ردیف‌ها ساخته و مبالغ ارزی بی رقم اعشار (۲۰۰٫۵ دلار «۲۰۱») چاپ می‌شد.
 */
export function printTotalsOf(doc: PrintableDocument): PrintTotals {
  const lines: InvoiceListLine[] = Array.isArray(doc.items) ? doc.items : [];
  const vatAmount = firstNumber(doc.vatAmount, doc.vat_amount);
  const serviceChargeAmount = firstNumber(doc.serviceChargeAmount, doc.service_charge_amount);
  const payableAmount = doc.payableAmount ?? (doc.payable_amount !== undefined && doc.payable_amount !== null ? fin(doc.payable_amount).toNumber() : undefined);
  return {
    decimals: amountDecimalsOf(doc.currency),
    gross: lines.reduce(addLineGross, 0),
    discount: lines.reduce(addLineDiscount, 0),
    vatAmount,
    vatPercent: firstNumber(doc.vatPercent, doc.vat_percent),
    serviceChargeAmount,
    payable: documentPayableOf({ ...doc, items: lines, vatAmount, serviceChargeAmount, payableAmount }),
    quantity: lines.reduce(addLineQuantity, 0),
  };
}

/** مبالغ یک ردیف چاپی با Decimal */
export function printLineAmounts(line: InvoiceListLine): PrintableLineAmounts {
  const total = fin(line.quantity).multiply(fin(line.unit_price));
  return {
    quantity: fin(line.quantity).toNumber(),
    unitPrice: fin(line.unit_price).toNumber(),
    discount: fin(line.discount).toNumber(),
    total: total.toNumber(),
    net: total.subtract(fin(line.discount)).toNumber(),
  };
}
