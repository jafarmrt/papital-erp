import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

interface ProjectListPagerProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** v9.0.388 (TD-743): پایین فهرست پروژه‌ها، «x تا y از total پروژه» و صفحه قبل و بعد */
export function ProjectListPager({ page, limit, total, onPageChange }: ProjectListPagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <div className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between text-xs text-slate-500">
      <div data-testid="project-list-range">
        {formatPersianNumber(first)} تا {formatPersianNumber(last)} از {formatPersianNumber(total)} پروژه
        {totalPages > 1 && <span> — صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)}</span>}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            title="صفحه قبل"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            title="صفحه بعد"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
