import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorStateView } from '../../common/ErrorStateView';
import { ReportActions } from '../ReportActions';
import { ReportPrintHeader } from '../ReportPrintHeader';
import { AgingReportFilters } from './AgingReportFilters';
import { AgingReportTable } from './AgingReportTable';
import { AgingSummary } from './AgingSummary';
import { fetchAgingReportExport, useAgingReport } from '../../../hooks/reports/useAgingReport';
import { useReportMoney } from '../../../hooks/reports/useReportMoney';
import { downloadReportWorkbook } from '../../../lib/reports/reportWorkbook';
import {
  AGING_REPORT_TITLES, agingReportFileName, agingReportMeta, agingReportSheet, defaultAgingParams, type AgingReportParams,
} from '../../../lib/reports/agingReport';
import { getTodayIsoDate } from '../../../utils';

/**
 * v10.1.10 (D-03، طرح گزارش‌های مدیریتی §۳): زبانه «سن مطالبات و بدهی‌ها» صفحه «گزارش‌های مدیریتی». پالایه‌ها در حالت
 * صفحه‌اند و هر تغییر گزارش را از صفحه نخست می‌خواند؛ مانده، بازه‌ها و جمع‌ها از کارساز می‌آیند. خروجی اکسل همه ردیف‌ها
 * را (تا سقف خروجی) با همان پالایه‌ها می‌گیرد و چاپ همین صفحه با سربرگ است.
 */

export function AgingReportTab() {
  const todayIso = useMemo(() => getTodayIsoDate(), []);
  const [params, setParams] = useState<AgingReportParams>(() => defaultAgingParams(todayIso));
  const [partyLabel, setPartyLabel] = useState<string | undefined>(undefined);
  const { data: report, error, isLoading, isFetching, refetch } = useAgingReport(params);
  const money = useReportMoney(report?.currency ?? params.currency);

  const change = (patch: Partial<AgingReportParams>, label?: string | null) => {
    setParams(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));
    if (label !== undefined) setPartyLabel(label ?? undefined);
  };

  const filterParty = params.partyId ? partyLabel : undefined;
  const exportExcel = async () => {
    const full = await fetchAgingReportExport(params);
    await downloadReportWorkbook([agingReportSheet(full, filterParty)], agingReportFileName(full.kind, full.asOf));
  };

  const title = AGING_REPORT_TITLES[report?.kind ?? params.kind];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">سن مطالبات و بدهی‌ها</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            مانده هر طرف حساب از دفتر کل تا تاریخ گزارش؛ دریافت‌ها و پرداخت‌ها از قدیمی‌ترین ردیف کم می‌شوند و باقی‌مانده هر ردیف به سن تاریخ سند خودش است.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" aria-label="در حال به‌روزرسانی" />}
          <ReportActions onExport={exportExcel} disabled={!report} />
        </div>
      </div>
      <AgingReportFilters params={params} partyLabel={partyLabel} onChange={change} />
      <ReportPrintHeader title={title} meta={report ? agingReportMeta(report, filterParty) : []} />
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          در حال ساخت گزارش…
        </div>
      ) : error && !report ? (
        <ErrorStateView title="گزارش سن مطالبات و بدهی‌ها ساخته نشد" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />
      ) : report ? (
        <>
          {error && <ErrorStateView compact title="به‌روزرسانی گزارش ناموفق بود" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />}
          <AgingSummary report={report} money={money} />
          <AgingReportTable report={report} money={money} onPage={page => change({ page })} />
        </>
      ) : null}
    </div>
  );
}
