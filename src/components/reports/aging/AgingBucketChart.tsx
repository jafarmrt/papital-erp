import { ReportChartCard } from '../charts/ReportChartCard';
import { toChartBars } from '../sales/SalesCharts';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import { AGING_REPORT_TITLES, type AgingReport } from '../../../lib/reports/agingReport';
import { agingChartBars } from '../../../lib/reports/reportCharts';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۶): میله سن مطالبات یا بدهی‌ها، از جمع بازه‌های همان گزارش (بی
 * درخواست تازه). پیش‌دریافت و پیش‌پرداخت سن ندارند و در نمودار نیستند.
 */
export function AgingBucketChart({ report, money }: { report: AgingReport; money: ReportMoney }) {
  return (
    <ReportChartCard
      title={`${AGING_REPORT_TITLES[report.kind]} به تفکیک بازه سن`}
      subtitle={`مانده سن‌دار همه طرف حساب‌ها، به ${money.label}`}
      bars={toChartBars(agingChartBars(report.totals.buckets), money)}
      orientation="vertical"
      emptyText="مانده سن‌داری نیست."
    />
  );
}
