/**
 * v9.0.257 (TD-782، یافته B08-13 و مشاهده ۳.۲-۳ بسته ۸): جست‌وجوی فاکتور مرجع برگشت از فروش. سرور فقط فاکتور قطعی فعال
 * را با شماره (و سال مالی، اگر داده شود) می‌یابد؛ شماره‌ای که در چند سال فاکتور دارد ۴۰۹ `DOCUMENT_REF_AMBIGUOUS` با فهرست
 * سال‌ها می‌گیرد و فرم سال را می‌پرسد. پیام هر خطا همان است که رخ داده: پیش‌تر ۴۰۳ و قطع شبکه هم «فاکتوری با این شماره
 * یافت نشد» نشان می‌داد.
 *
 * این فایل به چیزی از سرور یا React وابسته نیست.
 */

/** یک فاکتور قطعی با همان شماره در یک سال مالی (از جزئیات پاسخ ۴۰۹ سرور) */
export interface ReturnInvoiceCandidate {
  id: number;
  refFiscalYear: number | null;
  date: string;
  buyerName: string | null;
}

export const RETURN_INVOICE_NOT_FOUND = 'فاکتور فروش قطعی با این شماره یافت نشد.';
export const RETURN_INVOICE_LOOKUP_FAILED = 'جست‌وجوی فاکتور مرجع انجام نشد؛ اتصال را بررسی کنید و دوباره جست‌وجو کنید.';

export function returnInvoiceLookupUrl(ref: string, fiscalYear?: number | null): string {
  const year = fiscalYear ? `&fiscalYear=${fiscalYear}` : '';
  return `/documents/by-ref/${encodeURIComponent(ref.trim())}?type=invoice${year}`;
}

interface LookupError {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

function candidatesOf(details: unknown): ReturnInvoiceCandidate[] {
  const raw = (details as { candidates?: unknown } | null | undefined)?.candidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(c => c as Partial<ReturnInvoiceCandidate>)
    .filter(c => typeof c.id === 'number')
    .map(c => ({ id: Number(c.id), refFiscalYear: c.refFiscalYear ?? null, date: String(c.date ?? ''), buyerName: c.buyerName ?? null }));
}

/** پیام کاربر و سال‌های قابل انتخاب برای خطای جست‌وجو */
export function returnInvoiceLookupError(error: unknown): { message: string; candidates: ReturnInvoiceCandidate[] } {
  const err = (error ?? {}) as LookupError;
  if (err.code === 'DOCUMENT_REF_AMBIGUOUS') {
    return { message: err.message || 'این شماره در چند سال مالی فاکتور قطعی دارد؛ سال مالی را انتخاب کنید.', candidates: candidatesOf(err.details) };
  }
  if (err.status === 404) return { message: RETURN_INVOICE_NOT_FOUND, candidates: [] };
  if (typeof err.status === 'number' && err.status > 0 && err.message) return { message: err.message, candidates: [] };
  return { message: RETURN_INVOICE_LOOKUP_FAILED, candidates: [] };
}
