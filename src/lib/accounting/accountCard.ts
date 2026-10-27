import type { ForeignAmountOrigin } from '../../types/accounting.types';
import type { PartyTemporaryRows } from './partyTemporaryRows';
import type { PartyDraftRows } from './partyDraftRows';

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
  /** v11 phase 6.1ch (M13): the row's place in the whole period from 1 (none on the opening row) */
  rowNumber?: number;
}

export interface AccountCardReport {
  items: AccountCardRow[];
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  finalBalance: number;
  /** v8.0.16 (TD-260): ارز مبالغ گزارش — IRR در نمای همه ارزها، وگرنه همان ارز انتخاب‌شده */
  currency: string;
  /** v10.0.257 (TD-915 / TD-924): فقط کارت یک طرف حساب؛ ردیف‌های حساب موقت او بیرون از مانده */
  temporaryRows?: PartyTemporaryRows;
  /** v11 phase 6.1t (U1): the party's draft vouchers apart, with the balance they would make (a party card only) */
  draftRows?: PartyDraftRows;
  /** v11 phase 6.1ch (M13): the rows of the whole period (the opening row not counted) */
  total: number;
  page: number;
  limit: number;
}

/**
 * v11 phase 6.1ch (M13): the card is one page of rows (`page`, `limit`); the running balance, the row numbers and the
 * totals count the whole period, and the opening row comes on the first page. `export=true` answers every row (the CSV
 * file). Before, the card sent the whole period twice (`{ report, ...report }`): 12 MB for one year of one account.
 */
export const ACCOUNT_CARD_PAGE_SIZE = 200;
export const ACCOUNT_CARD_MAX_PAGE_SIZE = 1000;

/** شمار صفحه‌های کارت (دست‌کم یک) */
export function accountCardPageCount(report: Pick<AccountCardReport, 'total' | 'limit'> | null | undefined): number {
  if (!report || !report.limit || report.total <= 0) return 1;
  return Math.ceil(report.total / report.limit);
}

/**
 * the paging keys of a card request: `page` from the second page on (the first page and the page size are the server's
 * defaults), or `export=true` for every row
 */
export function setAccountCardPage(params: URLSearchParams, page = 1, exportAll = false): URLSearchParams {
  if (exportAll) params.set('export', 'true');
  else if (page > 1) params.set('page', String(page));
  return params;
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
 * v9.0.225 (TD-547، B03-05، تصمیم ت۵ الف): کارت حساب فقط با یک حساب یا یک طرف حساب (نوع، شناسه یا نام تفصیلی)
 * گرفته می‌شود؛ سرور بی آن ۴۲۲ `ACCOUNT_CARD_FILTER_REQUIRED` می‌دهد و «مرور حساب‌ها» تا انتخاب چیزی درخواست نمی‌فرستد.
 * پیش‌تر کارت بی صافی همه ردیف‌های دفتر را برمی‌گرداند.
 */
export function accountCardHasFilter(filter: AccountCardFilter): boolean {
  return Boolean(filter.accountId || filter.detailedId || (filter.detailedName ?? '').trim()
    || (filter.detailedType && filter.detailedType !== 'all'));
}
