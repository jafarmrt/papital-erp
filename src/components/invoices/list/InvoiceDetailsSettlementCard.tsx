import { CreditCard } from 'lucide-react';
import { formatPersianPrice } from '../../../utils';
import { detailsRemainingOf, detailsSettlementViewOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

interface InvoiceDetailsSettlementCardProps {
  selectedDocDetails: InvoiceListDocument;
  setSettlementDoc: (doc: InvoiceListDocument | null) => void;
  /** v9.0.340 (TD-795): دکمه تسویه فقط با مجوز خزانه */
  canSettle: boolean;
}

/** TD-080 (بخش ۳): کارت وضعیت تسویه مالی در مودال جزئیات (فقط فاکتور فروش و رسید خرید) */
export function InvoiceDetailsSettlementCard({ selectedDocDetails, setSettlementDoc, canSettle }: InvoiceDetailsSettlementCardProps) {
  const settlementView = detailsSettlementViewOf(selectedDocDetails.settlementStatus);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${settlementView.iconClass}`}>
          <CreditCard size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800">وضعیت تسویه مالی:</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${settlementView.badgeClass}`}>
              {settlementView.label}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3">
            <span>پرداخت‌شده: <strong className="text-emerald-700 font-mono">{formatPersianPrice(selectedDocDetails.paidAmount || 0, selectedDocDetails.currency)}</strong></span>
            <span>•</span>
            <span>مانده: <strong className="text-amber-700 font-mono">{formatPersianPrice(detailsRemainingOf(selectedDocDetails), selectedDocDetails.currency)}</strong></span>
          </div>
        </div>
      </div>

      {selectedDocDetails.status === 'final' && canSettle && (
        <button
          type="button"
          onClick={() => setSettlementDoc(selectedDocDetails)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-2xs hover:shadow-xs flex items-center gap-1.5 shrink-0"
        >
          <CreditCard size={14} />
          <span>{selectedDocDetails.settlementStatus === 'fully_paid' ? 'مشاهده / ثبت تراکنش جدید' : 'تسویه سریع فاکتور'}</span>
        </button>
      )}
    </div>
  );
}
