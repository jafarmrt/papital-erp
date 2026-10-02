import { formatCurrencyLabel } from '../../../utils';
import { detailsTypeLabelOf, documentStatusLabelOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

/** TD-080 (بخش ۳): کارت‌های طرف حساب، نوع/وضعیت و ارز در مودال جزئیات سند */
export function InvoiceDetailsInfoCards({ selectedDocDetails }: { selectedDocDetails: InvoiceListDocument }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <span className="text-[10px] text-slate-400 font-bold block mb-1">طرف حساب سند</span>
        <div className="font-bold text-slate-800 text-xs">
          {selectedDocDetails.buyer_name || 'ثبت نشده (عمومی)'}
        </div>
        {selectedDocDetails.buyer_phone && (
          <div className="text-[11px] font-mono text-slate-600 mt-1" dir="ltr">
            {selectedDocDetails.buyer_phone}
          </div>
        )}
        {selectedDocDetails.buyer_city && (
          <div className="text-[10px] text-slate-500 mt-0.5">
            شهر / استان: {selectedDocDetails.buyer_city}
          </div>
        )}
      </div>

      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <span className="text-[10px] text-slate-400 font-bold block mb-1">اطلاعات وضعیت و ماهیت</span>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-bold text-slate-700">نوع سند:</span>
          <span className="font-medium text-slate-900">
            {detailsTypeLabelOf(selectedDocDetails.type)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-bold text-slate-700">وضعیت:</span>
          <span className="font-bold text-emerald-700">
            {documentStatusLabelOf(selectedDocDetails.status, 'نهایی‌شده')}
          </span>
        </div>
      </div>

      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <span className="text-[10px] text-slate-400 font-bold block mb-1">واحد پولی و مالی</span>
        <div className="font-bold text-slate-800 text-xs">
          واحد ارز: {formatCurrencyLabel(selectedDocDetails.currency || 'IRR')}
        </div>
        {selectedDocDetails.notes && (
          <p className="text-[11px] text-slate-600 mt-1 line-clamp-2" title={selectedDocDetails.notes}>
            یادداشت: {selectedDocDetails.notes}
          </p>
        )}
      </div>
    </div>
  );
}
