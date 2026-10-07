import type { TreasuryTransaction } from '../../types/accounting.types';
import { formatPersianDate } from '../../utils';

/**
 * v9.0.106 (TD-515، B04-19): برچسب فارسی روش و نوع طرف تراکنش خزانه، یکی برای جدول و خروجی اکسل. پیش‌تر اکسل
 * `customer` و `bank_transfer` خام را می‌نوشت.
 */
export function treasuryMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'bank_transfer': return 'حواله / پایا';
    case 'pos': return 'کارتخوان';
    case 'cash': return 'نقدی';
    case 'cheque': return 'چک';
    default: return 'نامشخص';
  }
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
