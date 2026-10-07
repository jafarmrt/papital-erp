import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { procurementPageCount } from '../../lib/procurement/procurementLists';

interface ProcurementPagerProps {
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  /** نام ردیف‌ها در متن نوار، مثلاً «درخواست» */
  noun: string;
}

/** v9.0.278 (TD-697): نوار صفحه‌بندی فهرست‌های میز تدارکات؛ صفحه‌ها از سرور خوانده می‌شوند */
export function ProcurementPager({ page, pageSize, total, shown, isLoading, onPageChange, noun }: ProcurementPagerProps) {
  const pages = procurementPageCount(total, pageSize);
  if (total <= pageSize && page === 1) return null;
  return (
    <div className="p-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/80">
      <span className="text-slate-600">
        نمایش {formatPersianNumber(shown)} از {formatPersianNumber(total)} {noun} (صفحه {formatPersianNumber(page)} از {formatPersianNumber(pages)})
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || isLoading}
          className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 cursor-pointer"
          title="صفحه قبلی"
        >
          <ChevronRight size={15} />
        </button>
        <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg">
          {formatPersianNumber(page)} / {formatPersianNumber(pages)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages || isLoading}
          className="p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 cursor-pointer"
          title="صفحه بعدی"
        >
          <ChevronLeft size={15} />
        </button>
      </div>
    </div>
  );
}
