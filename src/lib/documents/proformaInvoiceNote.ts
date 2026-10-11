import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * Note of an invoice finalized from a proforma: the proforma's number and Jalali date (v8.0.51 / v8.0.119, TD-317 /
 * TD-410), in Persian digits like every text shown to the user (v10.0.119, TD-1184).
 */
export function proformaInvoiceNote(refNumber: string | null | undefined, jalaliDate: string | null | undefined): string {
  return [
    refNumber ? `صادرشده از پیش‌فاکتور شماره ${toPersianDigits(refNumber)}` : 'صادرشده از پیش‌فاکتور',
    jalaliDate ? `به تاریخ ${toPersianDigits(jalaliDate)}` : '',
  ].filter(Boolean).join(' ');
}
