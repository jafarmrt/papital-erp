import type { JournalVoucher } from '../../types/accounting.types';

/**
 * v9.0.110 (TD-565، B03-23): قرارداد مشترک سرور و مرورگر برای فهرست اسناد حسابداری.
 * `GET /accounting/vouchers` یک صفحه از اسناد منطبق با صافی‌ها را با `total` و شمار هر وضعیت برمی‌گرداند
 * (`VoucherService.getJournalVouchers`)؛ برگه «اسناد حسابداری» صفحه، جست‌وجو، نوع، وضعیت و تاریخ را به سرور می‌فرستد.
 * پیش‌تر صفحه بی `page` و `limit` فقط ۲۰ سند آخر را می‌گرفت و شمارنده‌ها، جست‌وجو و صافی‌ها روی همان ۲۰ کار می‌کردند.
 */

export interface VoucherStatusCounts {
  draft: number;
  approved: number;
  permanent: number;
}

export interface JournalVoucherPage {
  data: JournalVoucher[];
  /** شمار اسناد منطبق با همه صافی‌ها (وضعیت هم) */
  total: number;
  page: number;
  limit: number;
  /** شمار هر وضعیت با همه صافی‌ها جز وضعیت */
  statusCounts: VoucherStatusCounts;
}

export interface VoucherListFilters {
  /** `all` یا یکی از وضعیت‌ها */
  status: string;
  /** `all` یا نوع سند (`voucherType`) */
  voucherType: string;
  search: string;
  /** تاریخ ISO یا خالی */
  startDate: string;
  endDate: string;
}

export const VOUCHER_PAGE_SIZE = 20;

export const EMPTY_VOUCHER_STATUS_COUNTS: VoucherStatusCounts = { draft: 0, approved: 0, permanent: 0 };

/** پارامترهای درخواست یک صفحه (همان نام‌هایی که `vouchersQuerySchema` می‌خواند) */
export function voucherListParams(filters: VoucherListFilters, page: number, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.voucherType && filters.voucherType !== 'all') params.set('voucherType', filters.voucherType);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return params;
}

/** پاسخ سرور به شکل صفحه (پاسخ ناقص صفحه خالی است، نه خطا) */
export function toVoucherPage(res: unknown, page: number, limit: number): JournalVoucherPage {
  const body = (res && typeof res === 'object' ? res : {}) as Partial<JournalVoucherPage>;
  const data = Array.isArray(body.data) ? body.data : [];
  const counts = body.statusCounts;
  return {
    data,
    total: Number(body.total ?? data.length) || 0,
    page,
    limit,
    statusCounts: {
      draft: Number(counts?.draft) || 0,
      approved: Number(counts?.approved) || 0,
      permanent: Number(counts?.permanent) || 0,
    },
  };
}
