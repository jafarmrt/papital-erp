import { ReportChartCard } from '../charts/ReportChartCard';
import type { ReportChartBar } from '../charts/ReportBarChart';
import { useSalesCharts } from '../../../hooks/reports/useReportCharts';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import type { ChartBar } from '../../../lib/reports/reportCharts';
import { REPORT_PERIOD_UNIT_LABELS } from '../../../lib/reports/reportPeriods';
import type { SalesReportParams } from '../../../lib/reports/salesReport';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۶): نمودار روند فروش و سهم دسته‌ها در زبانه فروش، با همان بازه، ارز
 * و پالایه‌های گزارش (تفکیک و صفحه جدول آن‌ها را عوض نمی‌کند). خطای نمودار فقط پیامی کوتاه است و جدول گزارش را نمی‌گیرد.
 */

export function toChartBars(bars: ChartBar[], money: ReportMoney): ReportChartBar[] {
  return bars.map(b => ({ label: b.label, value: money.value(b.value), text: `${money.format(b.value)} ${money.label}`, percent: b.percent ?? null }));
}

export function SalesCharts({ params, money }: { params: SalesReportParams; money: ReportMoney }) {
  const { data, error } = useSalesCharts({
    from: params.from,
    to: params.to,
    currency: params.currency,
    partyId: params.partyId,
    itemId: params.itemId,
    projectId: params.projectId,
    category: params.category,
    channel: params.channel,
  });
  if (error && !data) {
    return <p className="text-xs text-rose-700 dark:text-rose-300 no-print">نمودارهای فروش ساخته نشد؛ جدول گزارش درست است.</p>;
  }
  if (!data) return null;
  const trend = Array.isArray(data.trend) ? data.trend : [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const unit = REPORT_PERIOD_UNIT_LABELS[data.period] ?? REPORT_PERIOD_UNIT_LABELS.month;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <ReportChartCard
        title="روند فروش خالص پس از برگشت"
        subtitle={`هر ${unit}، به ${money.label}`}
        bars={toChartBars(trend, money)}
        orientation="vertical"
        emptyText="در این بازه فروشی نیست."
      />
      <ReportChartCard
        title="سهم دسته‌های کالا از فروش"
        subtitle={`فروش خالص پس از برگشت، به ${money.label}`}
        bars={toChartBars(categories, money)}
        orientation="horizontal"
        emptyText="در این بازه فروشی نیست."
      />
    </div>
  );
}
