import { DollarSign } from 'lucide-react';
import { formatPersianPrice, formatCurrencyLabel } from '../../../utils';
import { addLineGross, addLineDiscount, documentPayableOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

/**
 * TD-080 (بخش ۳): نوار جمع کل، جمع ناخالص و مجموع تخفیف در مودال جزئیات.
 * v7.0.94 (TD-235 بند ۱): جمع کل = خالص اقلام + مالیات (documentPayableOf)؛ پیش‌تر مالیات حذف می‌شد و اگر سند کامل
 * بارگذاری نمی‌شد (ردیف بدون اقلام) صفر نشان می‌داد.
 */
export function InvoiceDetailsTotals({ selectedDocDetails }: { selectedDocDetails: InvoiceListDocument }) {
  const vatAmount = Number(selectedDocDetails.vatAmount || 0);
  return (
    <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 font-black">
          <DollarSign size={22} />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 block font-medium">جمع کل ارزش نهایی سند:</span>
          <strong className="text-base font-black text-white font-mono">
            {formatPersianPrice(documentPayableOf(selectedDocDetails))} {formatCurrencyLabel(selectedDocDetails.currency)}
          </strong>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div className="text-right">
          <span className="text-[10px] text-slate-400 block">جمع ناخالص:</span>
          <span className="font-mono text-slate-200 font-bold">
            {formatPersianPrice((selectedDocDetails.items || []).reduce(addLineGross, 0))}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-400 block">مجموع تخفیف:</span>
          <span className="font-mono text-rose-400 font-bold">
            {formatPersianPrice((selectedDocDetails.items || []).reduce(addLineDiscount, 0))}
          </span>
        </div>
        {vatAmount > 0 && (
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block">مالیات بر ارزش افزوده:</span>
            <span className="font-mono text-amber-300 font-bold">
              {formatPersianPrice(vatAmount)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
