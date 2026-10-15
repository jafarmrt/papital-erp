import { lazy, Suspense } from 'react';
import type { ReportChartBar } from './ReportBarChart';
import { SectionErrorBoundary } from '../../common';
import { chartHeight } from './chartHeight';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۶): قاب نمودار «گزارش‌های مدیریتی». نمودار و کتابخانه‌اش با `React.lazy` بار می‌شوند؛ تا رسیدن
 * آن جای خالی هم‌اندازه نمودار نشان داده می‌شود و خطای بار شدن فقط همین قاب را از کار می‌اندازد. نمودار بی داده (همه صفر)
 * کشیده نمی‌شود و متن خالی جایش می‌آید. جدول همان گزارش زیر نمودار، نمای جدولی همین عددهاست.
 */

const ReportBarChart = lazy(() => import('./ReportBarChart').then(m => ({ default: m.ReportBarChart })));

interface ReportChartCardProps {
  title: string;
  /** یک خط زیر عنوان (واحد مبلغ، دوره) */
  subtitle?: string;
  bars: ReportChartBar[];
  orientation: 'vertical' | 'horizontal';
  emptyText: string;
}

export function ReportChartCard({ title, subtitle, bars, orientation, emptyText }: ReportChartCardProps) {
  const hasData = bars.some(b => b.value !== 0);
  return (
    <figure className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm p-4 m-0 break-inside-avoid">
      <figcaption className="mb-2">
        <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </figcaption>
      {hasData ? (
        <SectionErrorBoundary>
          <Suspense fallback={<div style={{ height: chartHeight(orientation, bars.length) }} className="w-full rounded-xl bg-slate-50 dark:bg-slate-900/40 animate-pulse" aria-hidden />}>
            <ReportBarChart title={title} bars={bars} orientation={orientation} />
          </Suspense>
        </SectionErrorBoundary>
      ) : (
        <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      )}
    </figure>
  );
}
