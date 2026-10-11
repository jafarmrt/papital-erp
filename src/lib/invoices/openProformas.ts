import { listFromResponse, SALES_FORM_DOC_TYPES } from './invoiceForm';
import type { InvoiceListDocument } from './invoiceListDocuments';

/**
 * v9.0.301 (TD-792): پیش‌فاکتورهای باز صفحه صدور فاکتور فقط سندهای فروش‌اند (`types=invoice,proforma`) و صفحه‌به‌صفحه خوانده
 * می‌شوند. پیش‌تر فهرست بی نوع بود، پس پیش‌فاکتور خرید (`receipt` با وضعیت `proforma`) در فرم فروش ویرایش می‌شد، و بی هیچ
 * نشانه‌ای در ۱٬۰۰۰ ردیف بریده می‌شد. از v10.0.103 (TD-1197) پیش‌نویس‌های فروش هم در فهرست‌اند: پیش‌فاکتوری که گردش
 * کارش رد شده پیش‌نویس می‌شود (TD-1137) و فروشنده باید آن را بیابد و اصلاح کند.
 */
export const OPEN_PROFORMAS_PAGE_SIZE = 20;

export function openProformasUrl(page: number): string {
  return `/documents?statuses=proforma,draft&types=${SALES_FORM_DOC_TYPES.join(',')}&page=${page}&limit=${OPEN_PROFORMAS_PAGE_SIZE}`;
}

export interface OpenProformasPage {
  rows: InvoiceListDocument[];
  total: number;
}

export function openProformasPageOf(res: unknown): OpenProformasPage {
  const rows = listFromResponse<InvoiceListDocument>(res);
  const total = Number((res as { total?: unknown } | null)?.total);
  return { rows, total: Number.isFinite(total) && total >= rows.length ? total : rows.length };
}

export function openProformasPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / OPEN_PROFORMAS_PAGE_SIZE));
}

/** v10.0.103 (TD-1197): نشان ردیف جعبه «پیش فاکتورهای باز»؛ پیش‌فاکتور بی نشان است */
export function openProformaBadge(row: Pick<InvoiceListDocument, 'status' | 'workflowRejected'>): string {
  if (row.status !== 'draft') return '';
  return row.workflowRejected ? 'ردشده؛ اصلاح و ارسال دوباره' : 'پیش‌نویس';
}
