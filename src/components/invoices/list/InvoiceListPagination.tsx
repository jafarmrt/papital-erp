import { ChevronRight, ChevronLeft } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import type { InvoiceListQueryState } from '../../../hooks/invoices/useInvoiceListQuery';

/** TD-080 (بخش ۳): نوار صفحه‌بندی لیست اسناد */
export function InvoiceListPagination({ query }: { query: InvoiceListQueryState }) {
  const { safeDocs, totalItems, page, totalPages, setPage, loading } = query;
  return (
    <div className="p-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/80">
      <span className="text-slate-600 font-medium">
        نمایش {formatPersianNumber(safeDocs.length)} از مجموع {formatPersianNumber(totalItems)} سند ثبت‌شده (صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)})
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setPage(1)}
          disabled={page === 1 || loading}
          className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs shadow-2xs"
        >
          اولین
        </button>
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1 || loading}
          className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs"
          title="صفحه قبلی"
        >
          <ChevronRight size={15} />
        </button>
        <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg shadow-2xs">
          {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
        </span>
        <button
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
          className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs"
          title="صفحه بعدی"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={() => setPage(totalPages)}
          disabled={page >= totalPages || loading}
          className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs shadow-2xs"
        >
          آخرین
        </button>
      </div>
    </div>
  );
}
