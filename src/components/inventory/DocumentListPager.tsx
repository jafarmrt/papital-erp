import { ChevronRight, ChevronLeft } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import type { DocumentListPager as Pager } from '../../hooks/inventoryAudit/useInventoryAuditQueries';

/**
 * v9.0.339 (TD-787): نوار صفحه‌بندی سوابق انبارگردانی و حواله‌های انتقال (۵۰ سند در هر صفحه)؛ فقط وقتی بیش از یک صفحه
 * هست یا کاربر روی صفحه‌ای جز اول است دیده می‌شود.
 */
export function DocumentListPager({ pager, shown, loading, noun }: { pager: Pager; shown: number; loading: boolean; noun: string }) {
  const { page, total, totalPages, setPage } = pager;
  if (totalPages <= 1 && page <= 1) return null;
  const buttonClass = 'p-1.5 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 shadow-2xs';
  return (
    <div className="p-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/80">
      <span className="text-slate-600 font-medium">
        نمایش {formatPersianNumber(shown)} از {formatPersianNumber(total)} {noun} (صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)})
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1 || loading} className={buttonClass} title="صفحه قبلی">
          <ChevronRight size={15} />
        </button>
        <span className="px-3 py-1 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg shadow-2xs">
          {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
        </span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading} className={buttonClass} title="صفحه بعدی">
          <ChevronLeft size={15} />
        </button>
      </div>
    </div>
  );
}
