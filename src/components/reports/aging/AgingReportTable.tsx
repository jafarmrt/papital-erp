import { Link } from 'react-router-dom';
import { ReportPager } from '../ReportPager';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  AGING_ADVANCE_LABELS, AGING_BUCKETS, AGING_PARTY_LABELS, AGING_SETTLEMENT_LABELS, agingPartyTitle, agingStatementPath,
  type AgingAmounts, type AgingReport, type AgingRow,
} from '../../../lib/reports/agingReport';
import { formatPersianDate, formatPersianNumber } from '../../../utils';

/**
 * v10.1.10 (D-03، طرح گزارش‌های مدیریتی §۳): جدول «سن مطالبات و بدهی‌ها»، یک صفحه از ردیف‌های کارساز با ردیف جمع همه
 * ردیف‌ها. نام طرف حساب به صورت‌حساب او در گزارش‌های حسابداری می‌رود؛ ستون پیش‌نویس فقط وقتی پیش‌نویس شمرده می‌شود و
 * ستون‌های چک فقط در نمای ریالی (چک‌ها ریالی‌اند).
 */

interface AgingReportTableProps {
  report: AgingReport;
  money: ReportMoney;
  onPage: (page: number) => void;
}

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';
const BUCKET_TONES = ['', '', 'text-amber-700 dark:text-amber-300', 'text-orange-700 dark:text-orange-300', 'text-rose-700 dark:text-rose-300'];

function PartyCell({ report, row }: { report: AgingReport; row: AgingRow }) {
  const title = agingPartyTitle(row.party);
  const path = agingStatementPath(report.kind, row.party);
  const tone = row.party.kind === 'party' ? '' : 'text-slate-500 dark:text-slate-400';
  if (!path) return <span className={`font-bold font-sans ${tone}`}>{title}</span>;
  return (
    <Link to={path} className="font-bold font-sans text-indigo-700 dark:text-indigo-300 hover:underline" title="صورت‌حساب طرف حساب">
      {title}
    </Link>
  );
}

export function AgingReportTable({ report, money, onPage }: AgingReportTableProps) {
  const withDraft = !report.approvedOnly;
  const withBounced = report.chequesApply && report.kind === 'receivable';

  const amountCells = (a: AgingAmounts) => (
    <>
      <td className={`${TD} font-black text-indigo-700 dark:text-indigo-300`}>{money.format(a.balance)}</td>
      {AGING_BUCKETS.map((b, i) => <td key={b.key} className={`${TD} ${BUCKET_TONES[i]}`}>{money.format(a.buckets[b.key])}</td>)}
      <td className={`${TD} text-emerald-700 dark:text-emerald-300`}>{money.format(a.advance)}</td>
      {withDraft && <td className={`${TD} text-amber-700 dark:text-amber-300`}>{money.format(a.draft)}</td>}
      {report.chequesApply && <td className={TD}>{money.format(a.pendingCheques)}</td>}
      {withBounced && <td className={`${TD} text-rose-700 dark:text-rose-300`}>{money.format(a.bouncedCheques)}</td>}
    </>
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>{AGING_PARTY_LABELS[report.kind]}</th>
              <th className={TH}>مانده ({money.label})</th>
              {AGING_BUCKETS.map(b => <th key={b.key} className={TH}>{b.label}</th>)}
              <th className={TH}>{AGING_ADVANCE_LABELS[report.kind]}</th>
              {withDraft && <th className={TH}>از سندهای پیش‌نویس</th>}
              {report.chequesApply && <th className={TH}>چک وصول‌نشده</th>}
              {withBounced && <th className={TH}>چک برگشتی</th>}
              <th className={TH}>{AGING_SETTLEMENT_LABELS[report.kind]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={20} className="px-3 py-10 text-center text-sm text-slate-500">تا این تاریخ و با این شرط‌ها طرف حسابی مانده ندارد.</td>
              </tr>
            ) : report.rows.map(row => (
              <tr key={row.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/40">
                <td className={TD}><PartyCell report={report} row={row} /></td>
                {amountCells(row)}
                <td className={TD}>
                  {row.lastSettlement ? (
                    <span className="flex flex-col">
                      <span className="font-sans">{formatPersianDate(row.lastSettlement.date)}{row.lastSettlement.byCheque ? ' (چک)' : ''}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{money.format(row.lastSettlement.amount)}</span>
                    </span>
                  ) : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {report.rows.length > 0 && (
            <tfoot className="bg-indigo-50/60 dark:bg-indigo-900/20 border-t-2 border-indigo-200 dark:border-indigo-800 font-black">
              <tr>
                <td className={`${TD} font-sans font-black`}>جمع همه ردیف‌ها ({formatPersianNumber(report.totals.partyCount)})</td>
                {amountCells(report.totals)}
                <td className={TD} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <ReportPager total={report.total} page={report.page} limit={report.limit} onPage={onPage} />
    </div>
  );
}
