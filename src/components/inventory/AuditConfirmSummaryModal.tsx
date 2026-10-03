import { formatPersianNumber } from '../../utils';
import type { AuditSummary } from '../../lib/inventoryAudit/auditSheet';

/** V10-3.4: مودال خلاصه تایید پیش از ثبت نهایی انبارگردانی */

interface AuditConfirmSummaryModalProps {
  summary: AuditSummary;
  nextRef: string;
  selectedLocation: string;
  notes: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AuditConfirmSummaryModal({ summary, nextRef, selectedLocation, notes, submitting, onCancel, onConfirm }: AuditConfirmSummaryModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 p-6 animate-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto" dir="rtl">
        <div>
          <h3 className="text-base font-bold text-slate-900">تایید و ثبت نهایی انبارگردانی</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            پیش از صدور سند «{nextRef}» در موقعیت «{selectedLocation}»، خلاصه شمارش را بازبینی کنید. پس از ثبت، موجودی انبار بر اساس شمارش به‌روزرسانی خواهد شد.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <span className="block text-slate-500">تعداد ردیف شمارش‌شده</span>
            <strong className="text-slate-800 text-base font-mono">{formatPersianNumber(summary.counted)}</strong>
          </div>
          <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50">
            <span className="block text-emerald-700">منطبق با سیستم</span>
            <strong className="text-emerald-800 text-base font-mono">{formatPersianNumber(summary.matched)}</strong>
          </div>
          <div className={`p-3 rounded-xl border ${summary.surplus > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
            <span className={summary.surplus > 0 ? 'block text-amber-700' : 'block text-slate-500'}>اقلام اضافی (+)</span>
            <strong className={`${summary.surplus > 0 ? 'text-amber-800' : 'text-slate-800'} text-base font-mono`}>
              {formatPersianNumber(summary.surplus)} مورد / {formatPersianNumber(summary.surplusQty)}
            </strong>
          </div>
          <div className={`p-3 rounded-xl border ${summary.shortage > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
            <span className={summary.shortage > 0 ? 'block text-rose-700' : 'block text-slate-500'}>اقلام کسری (−)</span>
            <strong className={`${summary.shortage > 0 ? 'text-rose-800' : 'text-slate-800'} text-base font-mono`}>
              {formatPersianNumber(summary.shortage)} مورد / {formatPersianNumber(summary.shortageQty)}
            </strong>
          </div>
        </div>

        {notes.trim() && (
          <div className="text-xs bg-white border rounded-xl p-3">
            <span className="text-slate-500 block mb-1">یادداشت سند:</span>
            <p className="text-slate-700 leading-relaxed">{notes}</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 border border-slate-300 rounded-xl hover:bg-slate-100 bg-white text-slate-700 text-xs font-bold transition-all cursor-pointer"
          >
            بازگشت برای اصلاح
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer"
          >
            {submitting ? 'در حال ثبت...' : 'ثبت قطعی انبارگردانی'}
          </button>
        </div>
      </div>
    </div>
  );
}
