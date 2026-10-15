import { ReportPager } from '../ReportPager';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  VAT_DOCUMENT_KIND_LABELS, VAT_LIST_FILTERS, VAT_LIST_FILTER_LABELS, VAT_WARNING_LABELS, vatCurrencyText, vatRateLabel,
  type VatDocumentRow, type VatListFilter, type VatReport,
} from '../../../lib/reports/vatReport';
import { formatPersianDate, formatPersianNumber, formatPersianPrice, toPersianDigits } from '../../../utils';

/**
 * v10.1.13 (D-03، طرح گزارش‌های مدیریتی §۴): فهرست سندهای بخش ۱ «مالیات بر ارزش افزوده»، یک صفحه از کارساز، با
 * گزینه «فقط سندهای دارای هشدار». سند ارزی مبلغ ارز خودش را هم زیر مبلغ ریالی نشان می‌دهد و برای ناهمخوانی درصد،
 * مالیات درست به ارز سند کنار هشدار می‌آید.
 */

interface VatDocumentTableProps {
  report: VatReport;
  money: ReportMoney;
  onList: (list: VatListFilter) => void;
  onPage: (page: number) => void;
}

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';

function OwnAmount({ row, value }: { row: VatDocumentRow; value: string }) {
  if (row.currency === 'IRR') return null;
  return <span className="block text-[10px] text-slate-500 dark:text-slate-400">{formatPersianPrice(value, undefined, 2)}</span>;
}

function WarningCell({ row }: { row: VatDocumentRow }) {
  if (!row.warning) return <span className="text-slate-400">—</span>;
  return (
    <span className="font-sans font-bold text-amber-700 dark:text-amber-300">
      {VAT_WARNING_LABELS[row.warning]}
      {row.expectedVatOwn !== null && (
        <span className="block text-[10px] font-mono font-normal">مالیات درصد: {formatPersianPrice(row.expectedVatOwn, undefined, 2)}</span>
      )}
    </span>
  );
}

export function VatDocumentTable({ report, money, onList, onPage }: VatDocumentTableProps) {
  return (
    <section className="space-y-2" aria-labelledby="vat-part-list">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <h3 id="vat-part-list" className="text-sm font-black text-slate-800 dark:text-slate-100">فهرست سندها</h3>
        <div className="flex gap-1" role="group" aria-label="سندهای فهرست">
          {VAT_LIST_FILTERS.map(f => (
            <button
              key={f}
              type="button"
              aria-pressed={report.list === f}
              onClick={() => onList(f)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                report.list === f
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
              }`}
            >
              {VAT_LIST_FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right" data-testid="vat-documents">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className={TH}>نوع</th>
                <th className={TH}>شماره</th>
                <th className={TH}>تاریخ</th>
                <th className={TH}>مشتری</th>
                <th className={TH}>ارز</th>
                <th className={TH}>مبلغ خالص ({money.label})</th>
                <th className={TH}>درصد</th>
                <th className={TH}>مالیات</th>
                <th className={TH}>هشدار</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {report.documents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-500">
                    {report.list === 'warnings' ? 'در این دوره سند دارای هشدار نیست.' : 'در این دوره فاکتور فروش یا برگشت قطعی نیست.'}
                  </td>
                </tr>
              ) : report.documents.map(row => (
                <tr key={row.id} data-testid={`vat-document-${row.id}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/40">
                  <td className={`${TD} font-sans font-bold ${row.kind === 'return' ? 'text-rose-700 dark:text-rose-300' : ''}`}>{VAT_DOCUMENT_KIND_LABELS[row.kind]}</td>
                  <td className={TD}>{toPersianDigits(row.refNumber)}</td>
                  <td className={TD}>{formatPersianDate(row.date)}</td>
                  <td className={`${TD} font-sans`}>{row.party ?? '—'}</td>
                  <td className={`${TD} font-sans text-[11px]`}>{vatCurrencyText(row)}</td>
                  <td className={TD}>{money.format(row.net)}<OwnAmount row={row} value={row.netOwn} /></td>
                  <td className={`${TD} font-sans`}>{vatRateLabel(row.percent)}</td>
                  <td className={`${TD} font-black`}>{money.format(row.vat)}<OwnAmount row={row} value={row.vatOwn} /></td>
                  <td className={`${TD} whitespace-normal min-w-[10rem]`}><WarningCell row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ReportPager total={report.total} page={report.page} limit={report.limit} onPage={onPage} />
      </div>
      {report.total > 0 && report.total <= report.limit && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 no-print">{formatPersianNumber(report.total)} سند</p>
      )}
    </section>
  );
}
