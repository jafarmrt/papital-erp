import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { DocAmountFormat } from '../../../lib/invoices/invoiceListDocuments';

interface InvoiceRowSettlementCellProps {
  isCommercial: boolean;
  settlementStatus: string;
  remainingAmt: number;
  /** the row's amount format (display unit for a rial document, v11 phase 6.3 U3) */
  amounts: DocAmountFormat;
}

/** TD-080 (بخش ۳): ستون «وضعیت تسویه» یک ردیف لیست اسناد */
export function InvoiceRowSettlementCell({ isCommercial, settlementStatus, remainingAmt, amounts }: InvoiceRowSettlementCellProps) {
  return (
    <td className="p-3 whitespace-nowrap" data-label="وضعیت تسویه">
      {isCommercial ? (
        <div>
          {settlementStatus === 'fully_paid' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 size={11} className="text-emerald-600" />
              <span>تسویه کامل</span>
            </span>
          ) : settlementStatus === 'partially_paid' ? (
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                <span>تسویه ناقص</span>
              </span>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                مانده: <span className="text-amber-700 font-bold">{amounts.number(remainingAmt)}</span>
              </div>
            </div>
          ) : (
            <div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertCircle size={10} className="text-rose-500" />
                <span>تسویه نشده</span>
              </span>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                مانده: {amounts.number(remainingAmt)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <span className="text-slate-300 font-mono">-</span>
      )}
    </td>
  );
}
