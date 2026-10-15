import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useDashboardSummary } from '../../hooks/reports/useReportCharts';
import { useRialDisplay } from '../../hooks/useAppCurrency';
import { managementReportPath } from '../../lib/reports/managementReportTabs';
import { sparklinePoints, type DashboardSalesSummary } from '../../lib/reports/reportCharts';
import { formatPersianNumber } from '../../utils';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۴): ابزارک «فروش» پیشخوان. فروش این ماه تا امروز در برابر همان روزهای
 * ماه قبل با خط روند شش ماه (SVG ساده، بی کتابخانه نمودار)، و جمع مطالبات با بخش بالای ۹۰ روز. هر بخش فقط برای دارنده
 * کلید خودش از کارساز می‌آید (`reports.sales` و `accounting.reports`)؛ همه ارزها به ریال در واحد نمایش مبالغ.
 */

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 36;

function changeText(percent: number | null): string {
  if (percent === null) return 'ماه قبل فروشی نبود';
  return `${percent > 0 ? '+' : ''}${formatPersianNumber(percent, 1)}٪ نسبت به همان روزهای ماه قبل`;
}

function SalesTrendLine({ sales }: { sales: DashboardSalesSummary }) {
  const trend = Array.isArray(sales.trend) ? sales.trend : [];
  const points = sparklinePoints(trend.map(b => Number(b.value)), SPARK_WIDTH, SPARK_HEIGHT);
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const title = `روند فروش شش ماه: ${trend.map(b => b.label).join('، ')}`;
  return (
    <svg width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} role="img" aria-label={title} className="shrink-0 text-indigo-600 dark:text-indigo-300">
      <title>{title}</title>
      <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last.x} cy={last.y} r={3} fill="currentColor" />}
    </svg>
  );
}

export function SalesSummaryWidget() {
  const navigate = useNavigate();
  const rial = useRialDisplay();
  const { data, isLoading, error } = useDashboardSummary(true);
  const amount = rial.amount;

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4" aria-label="فروش و مطالبات">
      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">فروش و مطالبات</h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />در حال خواندن…</div>
      ) : error || !data ? (
        <p className="text-xs text-rose-700 dark:text-rose-300">خلاصه فروش خوانده نشد.</p>
      ) : (
        <>
          {data.sales && (
            <button
              type="button"
              onClick={() => void navigate(managementReportPath('sales'))}
              className="w-full flex items-center justify-between gap-3 text-right rounded-2xl p-3 bg-indigo-50/70 dark:bg-indigo-900/20 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/40 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">فروش این ماه تا امروز</span>
                <span className="block text-base font-black font-mono text-indigo-700 dark:text-indigo-300">{amount(data.sales.netAfterReturns)}</span>
                <span className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {data.sales.changePercent !== null && (data.sales.changePercent >= 0
                    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
                    : <TrendingDown className="w-3.5 h-3.5 text-rose-600" aria-hidden />)}
                  {changeText(data.sales.changePercent)}
                </span>
              </span>
              <SalesTrendLine sales={data.sales} />
            </button>
          )}
          {data.receivables && (
            <button
              type="button"
              onClick={() => void navigate(managementReportPath('aging'))}
              className="w-full flex items-center justify-between gap-3 text-right rounded-2xl p-3 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-900/60 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400"><Wallet className="w-3.5 h-3.5" aria-hidden />مطالبات از مشتریان</span>
                <span className="block text-base font-black font-mono text-slate-900 dark:text-white">{amount(data.receivables.total)}</span>
                <span className="block text-[11px] text-rose-700 dark:text-rose-300">بالای ۹۰ روز: {amount(data.receivables.over90)}</span>
              </span>
              <ArrowLeft className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            </button>
          )}
          {data.sales && data.sales.unconvertedDocuments > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              {formatPersianNumber(data.sales.unconvertedDocuments)} سند ارزی این ماه نرخ تبدیل ندارد و در جمع نیامده است.
            </p>
          )}
        </>
      )}
    </section>
  );
}
