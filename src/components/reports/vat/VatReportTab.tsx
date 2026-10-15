import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorStateView } from '../../common/ErrorStateView';
import { ReportActions } from '../ReportActions';
import { ReportPrintHeader } from '../ReportPrintHeader';
import { ReportRangeFields } from '../ReportRangeFields';
import { VatDocumentSummary } from './VatDocumentSummary';
import { VatDocumentTable } from './VatDocumentTable';
import { VatLedgerSection } from './VatLedgerSection';
import { fetchVatReportExport, useVatReport } from '../../../hooks/reports/useVatReport';
import { useReportMoney } from '../../../hooks/reports/useReportMoney';
import { presetRange } from '../../../lib/reports/reportPeriods';
import { downloadReportWorkbook } from '../../../lib/reports/reportWorkbook';
import { VAT_REPORT_TITLE, defaultVatParams, vatReportMeta, type VatReportParams } from '../../../lib/reports/vatReport';
import { vatReportFileName, vatReportSheets } from '../../../lib/reports/vatReportSheets';
import { getTodayIsoDate } from '../../../utils';

/**
 * v10.1.11 (D-03، طرح گزارش‌های مدیریتی §۴): زبانه «مالیات بر ارزش افزوده» صفحه «گزارش‌های مدیریتی». بازه پیش‌فرض از
 * آغاز فصل جاری تا امروز است (ت۱۲)؛ بخش ۱ از سندها، بخش ۲ از دفتر کل با هم‌خوانی، و فهرست سندها. هر تغییر بازه یا
 * فهرست گزارش را از صفحه نخست می‌خواند. خروجی اکسل همه سندها و همه تفاوت‌ها را (تا سقف خروجی) در چهار برگه می‌گیرد.
 */

export function VatReportTab() {
  const todayIso = useMemo(() => getTodayIsoDate(), []);
  const [params, setParams] = useState<VatReportParams>(
    () => defaultVatParams(presetRange('this_quarter', todayIso) ?? { from: todayIso, to: todayIso }),
  );
  const { data: report, error, isLoading, isFetching, refetch } = useVatReport(params);
  const money = useReportMoney('IRR');

  const change = (patch: Partial<VatReportParams>) => setParams(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  const exportExcel = async () => {
    const full = await fetchVatReportExport(params);
    await downloadReportWorkbook(vatReportSheets(full), vatReportFileName(full));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-white">{VAT_REPORT_TITLE}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            مالیات فروش دوره از فاکتورها و برگشت‌های قطعی، کنار گردش حساب مالیات در دفتر کل، برای آماده کردن اظهارنامه.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" aria-label="در حال به‌روزرسانی" />}
          <ReportActions onExport={exportExcel} disabled={!report} />
        </div>
      </div>
      <div className="no-print">
        <ReportRangeFields range={{ from: params.from, to: params.to }} todayIso={todayIso} onChange={range => change(range)} />
      </div>
      <ReportPrintHeader title={VAT_REPORT_TITLE} meta={report ? vatReportMeta(report) : []} />
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          در حال ساخت گزارش…
        </div>
      ) : error && !report ? (
        <ErrorStateView title="گزارش مالیات بر ارزش افزوده ساخته نشد" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />
      ) : report ? (
        <>
          {error && <ErrorStateView compact title="به‌روزرسانی گزارش ناموفق بود" error={error instanceof Error ? error : String(error)} onRetry={() => void refetch()} />}
          <VatDocumentSummary report={report} money={money} />
          <VatLedgerSection report={report} money={money} />
          <VatDocumentTable report={report} money={money} onList={list => change({ list })} onPage={page => change({ page })} />
        </>
      ) : null}
    </div>
  );
}
