import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

interface ListPagerProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}

/** v10.2 package 7 (OBS-R2-28) / package 11: the pager of a server-paged list: rows shown, total and previous / next */
export function ListPager({ page, totalPages, total, limit, onPage, disabled = false }: ListPagerProps) {
  if (total <= limit && page <= 1) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
      <span className="text-slate-500">
        نمایش {formatPersianNumber(first)} تا {formatPersianNumber(last)} از {formatPersianNumber(total)} مورد
      </span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="صفحه قبل" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}
          className="p-1.5 border rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer">
          <ChevronRight size={16} />
        </button>
        <span className="px-3 font-bold text-slate-800">
          صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)}
        </span>
        <button type="button" aria-label="صفحه بعد" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}
          className="p-1.5 border rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 cursor-pointer">
          <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}
