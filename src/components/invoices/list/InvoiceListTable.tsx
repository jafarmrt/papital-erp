import type { InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import type { InvoiceListActions } from '../../../hooks/invoices/useInvoiceListActions';
import { InvoiceListRow } from './InvoiceListRow';

interface InvoiceListTableProps {
  safeDocs: InvoiceListDocument[];
  loading: boolean;
  actions: InvoiceListActions;
  /** v9.0.293 (TD-797): پیام خطای دریافت فهرست و تلاش دوباره */
  loadError?: string | null;
  onRetry?: () => void;
}

/** TD-080 (بخش ۳): جدول لیست اسناد (پوشش بارگذاری، سرستون‌ها، ردیف‌ها و پیام خالی) */
export function InvoiceListTable({ safeDocs, loading, actions, loadError, onRetry }: InvoiceListTableProps) {
  return (
    <div className="flex-1 overflow-auto relative min-h-[340px]">
      {loading && (
        <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] z-10 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}
      <table className="w-full text-xs text-right">
        <thead className="bg-slate-100/80 text-slate-700 border-b border-slate-200 sticky top-0 z-0 text-[11px] font-bold">
          <tr>
            <th className="p-3 w-28">شماره سند</th>
            <th className="p-3">نوع سند و ماهیت</th>
            <th className="p-3">وضعیت</th>
            <th className="p-3">تاریخ ثبت</th>
            <th className="p-3">طرف حساب (تامین‌کننده / خریدار)</th>
            <th className="p-3 text-center">تعداد و اقلام</th>
            <th className="p-3">ارزش کل / مبلغ سند</th>
            <th className="p-3">وضعیت تسویه</th>
            <th className="p-3 w-1/5">توضیحات و یادداشت</th>
            <th className="p-3 text-center w-36">عملیات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {safeDocs.map(doc => (
            <InvoiceListRow key={doc.id} doc={doc} actions={actions} />
          ))}
          {!loading && loadError && (
            <tr>
              <td colSpan={10} className="p-10 text-center text-xs" role="alert">
                <div className="text-rose-700 font-bold mb-1">فهرست اسناد دریافت نشد</div>
                <div className="text-slate-600 mb-3">{loadError}</div>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                  >
                    تلاش دوباره
                  </button>
                )}
              </td>
            </tr>
          )}
          {!loading && !loadError && safeDocs.length === 0 && (
            <tr>
              <td colSpan={10} className="p-12 text-center text-slate-400 text-xs">
                سندی مطابق شرط‌های جستجو یافت نشد.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
