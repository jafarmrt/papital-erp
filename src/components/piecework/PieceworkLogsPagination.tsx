import { ChevronRight, ChevronLeft } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { useRialDisplay } from '../../hooks/useAppCurrency';

export interface PieceworkLogsPaginationState {
  page: number;
  pageCount: number;
  /** شمار همه کارکردهای فیلترشده */
  total: number;
  /** جمع مبلغ همه کارکردهای فیلترشده */
  totalAmount: number;
  onPageChange: (page: number) => void;
}

/** v9.0.325 (TD-811): نوار صفحه‌بندی فهرست کارکرد؛ شمار و جمع مبلغ همه منطبق‌ها از سرور */
export function PieceworkLogsPagination({ state, loading }: { state: PieceworkLogsPaginationState; loading: boolean }) {
  const rial = useRialDisplay();
  const { page, pageCount, total, totalAmount, onPageChange } = state;
  const buttonClass = 'p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs';
  return (
    <div className="p-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/80">
      <span className="text-slate-600 font-medium">
        {`${formatPersianNumber(total)} ردیف کارکرد، جمع ${rial.amount(totalAmount)} (صفحه ${formatPersianNumber(page)} از ${formatPersianNumber(pageCount)})`}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading} className={buttonClass} title="صفحه قبلی">
          <ChevronRight size={15} />
        </button>
        <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg shadow-2xs">
          {`${formatPersianNumber(page)} / ${formatPersianNumber(pageCount)}`}
        </span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount || loading} className={buttonClass} title="صفحه بعدی">
          <ChevronLeft size={15} />
        </button>
      </div>
    </div>
  );
}
