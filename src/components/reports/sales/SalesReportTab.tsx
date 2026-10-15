import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorStateView } from '../../common/ErrorStateView';
import { ReportActions } from '../ReportActions';
import { ReportPrintHeader } from '../ReportPrintHeader';
import { SalesCharts } from './SalesCharts';
import { SalesReportFilters } from './SalesReportFilters';
import { SalesReportTable } from './SalesReportTable';
import { SalesSummary } from './SalesSummary';
import { SalesTopLists } from './SalesTopLists';
import { fetchSalesReportExport, useSalesReport } from '../../../hooks/reports/useSalesReport';
import { useReportMoney } from '../../../hooks/reports/useReportMoney';
import { downloadReportWorkbook } from '../../../lib/reports/reportWorkbook';
import {
  defaultSalesParams, salesFilterMeta, salesReportFileName, salesReportSheet, salesTopSheets,
  type SalesFilterLabels, type SalesReportParams,
} from '../../../lib/reports/salesReport';
import { getTodayIsoDate } from '../../../utils';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۲): زبانه «فروش» صفحه «گزارش‌های مدیریتی». پالایه‌ها و تفکیک در حالت صفحه‌اند و
 * هر تغییر گزارش را از صفحه نخست می‌خواند؛ جمع‌ها، مقایسه، ده‌تایی‌ها و هم‌خوانی با دفتر کل از کارساز می‌آیند. خروجی
 * اکسل همه ردیف‌ها را (تا سقف خروجی) با همان پالایه‌ها می‌گیرد و چاپ همین صفحه با سربرگ است.
 * v10.1.15: نمودار روند فروش و سهم دسته‌ها زیر کارت‌های جمع (ت۱۶).
 */

export function SalesReportTab() {
  const todayIso = useMemo(() => getTodayIsoDate(), []);
  const [params, setParams] = useState<SalesReportParams>(() => defaultSalesParams(todayIso));
  const [labels, setLabels] = useState<SalesFilterLabels>({});
  const { data: report, error, isLoading, isFetching, refetch } = useSalesReport(params);
  const money = useReportMoney(report?.currency ?? params.currency);

  const change = (patch: Partial<SalesReportParams>, labelPatch?: Partial<SalesFilterLabels>) => {
    setParams(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));
    if (labelPatch) setLabels(prev => ({ ...prev, ...labelPatch }));
  };

  const filterMeta = salesFilterMeta(params, labels);
  const exportExcel = async () => {
    const full = await fetchSalesReportExport(params);
    await downloadReportWorkbook([salesReportSheet(full, filterMeta), ...salesTopSheets(full)], salesReportFileName(full.range));
  };

  const printMeta = report ? salesReportSheet(report, filterMeta).meta : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">گزارش فروش</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">فاکتورهای قطعی و باطل‌نشده به تاریخ خود؛ برگشت از فروش به تاریخ خود برگشت کم می‌شود.</p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" aria-label="در حال به‌روزرسانی" />}
          <ReportActions onExport={exportExcel} disabled={!report} />
        </div>
      </div>
      <SalesReportFilters params={params} labels={labels} todayIso={todayIso} onChange={change} />
      <ReportPrintHeader title="گزارش فروش" meta={printMeta} />
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          در حال ساخت گزارش…
        </div>
      ) : error && !report ? (
        <ErrorStateView title="گزارش فروش ساخته نشد" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />
      ) : report ? (
        <>
          {error && <ErrorStateView compact title="به‌روزرسانی گزارش ناموفق بود" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />}
          <SalesSummary report={report} money={money} />
          <SalesCharts params={params} money={money} />
          <SalesReportTable report={report} money={money} onPage={page => change({ page })} />
          <SalesTopLists topItems={report.topItems} topCustomers={report.topCustomers} money={money} />
        </>
      ) : null}
    </div>
  );
}
