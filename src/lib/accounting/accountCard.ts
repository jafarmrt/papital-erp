import type { ForeignAmountOrigin } from '../../types/accounting.types';

/**
 * v9.0.118 (TD-574، B03-32): قرارداد مشترک سرور و مرورگر برای کارت حساب (`GET /accounting/reports/ledger`).
 * `AccountingReportService.getDetailedAccountCard` همین شکل را برمی‌گرداند و `LedgerView` همین کلیدها را می‌خواند.
 * ردیف «مانده ابتدای دوره» را سرور می‌فرستد (`isOpening`)؛ نام حساب در پاسخ نیست و نما آن را از فهرست حساب‌ها می‌خواند.
 * پیش‌تر نوع مرورگر (`rows`، `accountName`، `closingBalance`) با پاسخ سرور نمی‌خواند و نما ردیف افتتاحیه را دوباره می‌افزود.
 */

export interface AccountCardRow extends ForeignAmountOrigin {
  voucherId: number;
  voucherNumber: number;
  date: string;
  description?: string | null;
  accountName: string;
  accountCode: string;
  detailedName?: string;
  detailedType?: string;
  detailedId?: number | null;
  currency?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  /** ردیف «مانده ابتدای دوره» (فقط وقتی بازه آغاز دارد و مانده پیشین صفر نیست) */
  isOpening?: boolean;
}

export interface AccountCardReport {
  items: AccountCardRow[];
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
  /** v8.0.16 (TD-260): ارز مبالغ گزارش — IRR در نمای همه ارزها، وگرنه همان ارز انتخاب‌شده */
  currency: string;
}

/** ردیف‌های امن کارت (پاسخ ناقص آرایه نمی‌دهد) */
export function accountCardRows(report: AccountCardReport | null | undefined): AccountCardRow[] {
  return Array.isArray(report?.items) ? report.items : [];
}

/** کلیدهای صافی کارت حساب، همان پرس‌وجوی `GET /accounting/reports/ledger` */
export interface AccountCardFilter {
  accountId?: number | null;
  detailedType?: string | null;
  detailedId?: number | null;
  detailedName?: string | null;
}

/**
 * v9.0.211 (TD-547، B03-05، تصمیم ت۵ الف): کارت حساب فقط با یک حساب یا یک طرف حساب (نوع، شناسه یا نام تفصیلی)
 * گرفته می‌شود؛ سرور بی آن ۴۲۲ `ACCOUNT_CARD_FILTER_REQUIRED` می‌دهد و «مرور حساب‌ها» تا انتخاب چیزی درخواست نمی‌فرستد.
 * پیش‌تر کارت بی صافی همه ردیف‌های دفتر را برمی‌گرداند.
 */
export function accountCardHasFilter(filter: AccountCardFilter): boolean {
  return Boolean(filter.accountId || filter.detailedId || (filter.detailedName ?? '').trim()
    || (filter.detailedType && filter.detailedType !== 'all'));
}
