import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

/**
 * v10.1.9 (D-03): صفحه‌بندی جدول زبانه‌های «گزارش‌های مدیریتی»؛ پیش‌تر درون جدول گزارش فروش بود. فقط وقتی دیده می‌شود
 * که ردیف‌ها از یک صفحه بیشترند.
 */

interface ReportPagerProps {
  total: number;
  page: number;
  limit: number;
  onPage: (page: number) => void;
}

export function ReportPager({ total, page, limit, onPage }: ReportPagerProps) {
  if (total <= limit) return null;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  const button = 'p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed';
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 no-print">
      <span>{formatPersianNumber(total)} ردیف، صفحه {formatPersianNumber(page)} از {formatPersianNumber(lastPage)}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="صفحه قبل" disabled={page <= 1} onClick={() => onPage(page - 1)} className={button}>
          <ChevronRight className="w-4 h-4" />
        </button>
        <button type="button" aria-label="صفحه بعد" disabled={page >= lastPage} onClick={() => onPage(page + 1)} className={button}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
