import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorStateView } from '../../common/ErrorStateView';
import { ReportActions } from '../ReportActions';
import { ReportPrintHeader } from '../ReportPrintHeader';
import { PurchaseReportFilters } from './PurchaseReportFilters';
import { PurchaseReportTable } from './PurchaseReportTable';
import { PurchaseSummary, PurchaseTopLists } from './PurchaseSummary';
import { fetchPurchaseReportExport, usePurchaseReport } from '../../../hooks/reports/usePurchaseReport';
import { useReportMoney } from '../../../hooks/reports/useReportMoney';
import { downloadReportWorkbook } from '../../../lib/reports/reportWorkbook';
import {
  defaultPurchaseParams, purchaseFilterMeta, purchaseReportFileName, purchaseReportSheet, purchaseTopSheets,
  type PurchaseFilterLabels, type PurchaseReportParams,
} from '../../../lib/reports/purchaseReport';
import { getTodayIsoDate } from '../../../utils';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۵): زبانه «خرید» صفحه «گزارش‌های مدیریتی»، به تفکیک تأمین‌کننده، کالا،
 * دسته و دوره. جمع‌ها، مقایسه و ده‌تایی‌ها از کارساز می‌آیند؛ خروجی اکسل همه ردیف‌ها را (تا سقف خروجی) با همان پالایه‌ها
 * می‌گیرد و چاپ همین صفحه با سربرگ است.
 */

export function PurchaseReportTab() {
  const todayIso = useMemo(() => getTodayIsoDate(), []);
  const [params, setParams] = useState<PurchaseReportParams>(() => defaultPurchaseParams(todayIso));
  const [labels, setLabels] = useState<PurchaseFilterLabels>({});
  const { data: report, error, isLoading, isFetching, refetch } = usePurchaseReport(params);
  const money = useReportMoney(report?.currency ?? params.currency);

  const change = (patch: Partial<PurchaseReportParams>, labelPatch?: Partial<PurchaseFilterLabels>) => {
    setParams(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));
    if (labelPatch) setLabels(prev => ({ ...prev, ...labelPatch }));
  };

  const filterMeta = purchaseFilterMeta(params, labels);
  const exportExcel = async () => {
    const full = await fetchPurchaseReportExport(params);
    await downloadReportWorkbook([purchaseReportSheet(full, filterMeta), ...purchaseTopSheets(full)], purchaseReportFileName(full.range));
  };

  const printMeta = report ? purchaseReportSheet(report, filterMeta).meta : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">گزارش خرید</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">رسیدها و سندهای خرید قطعی و باطل‌نشده به تاریخ خود، به تفکیک تأمین‌کننده و کالا.</p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" aria-label="در حال به‌روزرسانی" />}
          <ReportActions onExport={exportExcel} disabled={!report} />
        </div>
      </div>
      <PurchaseReportFilters params={params} labels={labels} todayIso={todayIso} onChange={change} />
      <ReportPrintHeader title="گزارش خرید" meta={printMeta} />
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          در حال ساخت گزارش…
        </div>
      ) : error && !report ? (
        <ErrorStateView title="گزارش خرید ساخته نشد" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />
      ) : report ? (
        <>
          {error && <ErrorStateView compact title="به‌روزرسانی گزارش ناموفق بود" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />}
          <PurchaseSummary report={report} money={money} />
          <PurchaseReportTable report={report} money={money} onPage={page => change({ page })} />
          <PurchaseTopLists report={report} money={money} />
        </>
      ) : null}
    </div>
  );
}
