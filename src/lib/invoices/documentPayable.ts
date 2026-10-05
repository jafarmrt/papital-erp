import { fin } from '../financialDecimal';
import { amountDecimalsOf } from './invoiceListDocuments';

/** فیلدهای مبلغ سند در پاسخ GET /documents و GET /documents/:id (هر دو شکل نام) */
export interface PayableAmountFields {
  currency?: string;
  payableAmount?: number | string | null;
  payable_amount?: number | string | null;
  totalAmount?: number | string | null;
  total_amount?: number | string | null;
  net_amount?: number | string | null;
  vatAmount?: number | string | null;
  vat_amount?: number | string | null;
  serviceChargeAmount?: number | string | null;
  service_charge_amount?: number | string | null;
}

const present = (v: number | string | null | undefined): v is number | string => v !== undefined && v !== null && v !== '';

/**
 * v8.0.90 (TD-389): «مبلغ کل» پرونده مشتری و پیش‌نمایش سند در کارتابل تأیید همان مبلغ قابل پرداخت سرور است
 * (خالص اقلام + مالیات + هزینه ارسال و خدمات، AGENTS §۶)؛ پیش‌تر خالص اقلام بی مالیات و هزینه خدمات نشان داده می‌شد و
 * فاکتور ۱٬۰۰۰٬۰۰۰ ریالی با ۱۰٪ مالیات در کارتابل ۱٬۰۰۰٬۰۰۰ دیده و تأیید می‌شد، نه ۱٬۱۰۰٬۰۰۰.
 */
export function serverPayableOf(doc: PayableAmountFields): number {
  const payable = doc.payableAmount ?? doc.payable_amount;
  if (present(payable)) return Number(payable);
  const net = doc.totalAmount ?? doc.total_amount ?? doc.net_amount;
  return fin(present(net) ? net : 0)
    .add(doc.vatAmount ?? doc.vat_amount ?? 0)
    .add(doc.serviceChargeAmount ?? doc.service_charge_amount ?? 0)
    .toNumber();
}

/** تعداد رقم اعشار مبلغ همان سند (ریال بی اعشار، ارز خارجی سنت) */
export const payableDecimalsOf = (doc: PayableAmountFields): number => amountDecimalsOf(doc.currency);
