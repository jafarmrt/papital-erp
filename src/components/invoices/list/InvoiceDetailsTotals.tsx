import { DollarSign } from 'lucide-react';
import { addLineGross, addLineDiscount, docAmountFormatOf, documentPayableOf, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';
import { useShownRial } from '../../../contexts/RialDisplayContext';

/**
 * TD-080 (بخش ۳): نوار جمع کل، جمع ناخالص و مجموع تخفیف در مودال جزئیات.
 * v7.0.94 (TD-235 بند ۱): جمع کل = خالص اقلام + مالیات (documentPayableOf)؛ پیش‌تر مالیات حذف می‌شد و اگر سند کامل
 * بارگذاری نمی‌شد (ردیف بدون اقلام) صفر نشان می‌داد. v7.0.103 (TD-191): هزینه ارسال و خدمات جدا نمایش داده می‌شود.
 * v11 phase 6.3 (U3): a rial document's amounts in the display unit (`docAmountFormatOf`).
 */
export function InvoiceDetailsTotals({ selectedDocDetails }: { selectedDocDetails: InvoiceListDocument }) {
  const vatAmount = Number(selectedDocDetails.vatAmount || 0);
  const serviceChargeAmount = Number(selectedDocDetails.serviceChargeAmount || 0);
  const amounts = docAmountFormatOf(selectedDocDetails.currency, useShownRial());
  return (
    <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 font-black">
          <DollarSign size={22} />
        </div>
        <div>
          <span className="text-[11px] text-slate-300 block font-medium">جمع کل ارزش نهایی سند:</span>
          <strong className="text-base font-black text-white font-mono">
            {amounts.number(documentPayableOf(selectedDocDetails))} {amounts.label}
          </strong>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div className="text-right">
          <span className="text-[11px] text-slate-300 block">جمع ناخالص:</span>
          <span className="font-mono text-slate-200 font-bold">
            {amounts.number((selectedDocDetails.items || []).reduce(addLineGross, 0))}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-slate-300 block">مجموع تخفیف:</span>
          <span className="font-mono text-rose-400 font-bold">
            {amounts.number((selectedDocDetails.items || []).reduce(addLineDiscount, 0))}
          </span>
        </div>
        {serviceChargeAmount > 0 && (
          <div className="text-right">
            <span className="text-[11px] text-slate-300 block">هزینه ارسال و خدمات:</span>
            <span className="font-mono text-sky-300 font-bold">
              {amounts.number(serviceChargeAmount)}
            </span>
          </div>
        )}
        {vatAmount > 0 && (
          <div className="text-right">
            <span className="text-[11px] text-slate-300 block">مالیات بر ارزش افزوده:</span>
            <span className="font-mono text-amber-300 font-bold">
              {amounts.number(vatAmount)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
