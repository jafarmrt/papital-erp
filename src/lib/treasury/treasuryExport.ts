import type { TreasuryTransaction } from '../../types/accounting.types';
import { formatPersianDate } from '../../utils';

/**
 * v9.0.106 (TD-515، B04-19): برچسب فارسی روش و نوع طرف تراکنش خزانه، یکی برای جدول و خروجی اکسل. پیش‌تر اکسل
 * `customer` و `bank_transfer` خام را می‌نوشت.
 */
/**
 * v11 phase 6.3b (U22): one name for each way money moves, on the invoice's quick settlement, the treasury form, filter
 * and list, the export and the payroll payment. Before, the same method read «انتقال بانکی»، «حواله / پایا / ساتنا» and
 * «حواله»; «کارت‌خوان» and «کارتخوان (POS)»; «وجه نقد (صندوق)»، «نقدی / صندوق» and «نقدی».
 */
export const PAYMENT_METHOD_LABELS = {
  bank_transfer: 'انتقال بانکی',
  pos: 'کارت‌خوان',
  cash: 'نقدی (صندوق)',
  cheque: 'چک',
} as const;
export type PaymentMethodKey = keyof typeof PAYMENT_METHOD_LABELS;

export function treasuryMethodLabel(method: string | null | undefined): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[String(method ?? '')] ?? 'نامشخص';
}

export function treasuryPartyTypeLabel(partyType: string | null | undefined): string {
  switch (partyType) {
    case 'customer': return 'مشتری';
    case 'supplier': return 'تأمین‌کننده';
    case 'personnel': return 'پرسنل';
    default: return 'متفرقه';
  }
}

/** نام فایل اکسل گردش خزانه با تاریخ شمسی امروز (`jalaliDate` مانند 1405/07/15؛ «/» در نام فایل مجاز نیست) */
export function treasuryExportFileName(jalaliDate: string): string {
  return `گردش-خزانه-${jalaliDate.replace(/\//g, '-')}.xlsx`;
}

/** ردیف‌های برگه اکسل گردش خزانه */
export function treasuryExportRows(rows: TreasuryTransaction[]): Record<string, string | number>[] {
  return rows.map((tx, idx) => ({
    'ردیف': idx + 1,
    'شماره رسید': tx.transactionNumber,
    'تاریخ': formatPersianDate(tx.date),
    'نوع': tx.type === 'receipt' ? 'دریافت' : 'پرداخت',
    'وضعیت': tx.status === 'voided' ? 'ابطال‌شده' : 'معتبر',
    'طرف حساب': tx.partyName || '—',
    'نوع طرف': treasuryPartyTypeLabel(tx.partyType),
    'بانک / صندوق': tx.bankAccountTitle || '—',
    'روش پرداخت': treasuryMethodLabel(tx.method),
    'شماره پیگیری': tx.trackingNumber || '—',
    'مبلغ': tx.amount,
    'شماره سند': tx.voucherId || '—',
    'توضیحات': tx.description || '—',
  }));
}
