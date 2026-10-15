import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  SALES_DIMENSION_LABELS, type SalesAmounts, type SalesGroup, type SalesReport,
} from '../../../lib/reports/salesReport';
import { formatPersianNumber } from '../../../utils';
import { ReportPager } from '../ReportPager';
import { percentText } from './SalesSummary';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۲.۲): جدول گزارش فروش، یک صفحه از ردیف‌های کارساز با ردیف جمع همه ردیف‌ها.
 * مقدار فقط وقتی ستون دارد که کالا در تفکیک یا پالایه است؛ بها و سود فقط برای خواننده بهای کالا.
 */

interface SalesReportTableProps {
  report: SalesReport;
  money: ReportMoney;
  onPage: (page: number) => void;
}

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';

function GroupCell({ group }: { group: SalesGroup | null }) {
  if (!group) return <span className="text-slate-400">—</span>;
  return (
    <span className="font-bold font-sans">
      {group.label}
      {group.code && <span className="mr-1 text-[11px] text-slate-500 font-mono">{group.code}</span>}
    </span>
  );
}

export function SalesReportTable({ report, money, onPage }: SalesReportTableProps) {
  const withQuantity = report.rows.some(r => r.quantity !== null) || report.totals.quantity !== null;
  const withPrevious = report.comparison !== null;
  const quantity = (value: string | null, unit?: string | null) => (value === null ? '—' : `${formatPersianNumber(value, 4)}${unit ? ` ${unit}` : ''}`);

  const amountCells = (a: SalesAmounts, unit?: string | null) => (
    <>
      <td className={TD}>{formatPersianNumber(a.invoiceCount)}</td>
      {withQuantity && <td className={TD}>{quantity(a.quantity, unit)}</td>}
      {withQuantity && <td className={TD}>{quantity(a.returnQuantity, unit)}</td>}
      <td className={TD}>{money.format(a.gross)}</td>
      <td className={TD}>{money.format(a.discount)}</td>
      <td className={TD}>{money.format(a.net)}</td>
      <td className={`${TD} text-rose-700 dark:text-rose-300`}>{money.format(a.returnAmount)}</td>
      <td className={`${TD} font-black text-indigo-700 dark:text-indigo-300`}>{money.format(a.netAfterReturns)}</td>
      {report.costVisible && <td className={TD}>{money.format(a.cost)}</td>}
      {report.costVisible && <td className={`${TD} text-emerald-700 dark:text-emerald-300`}>{money.format(a.grossProfit)}</td>}
      {report.costVisible && <td className={TD}>{percentText(a.marginPercent).replace('+', '')}</td>}
    </>
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>{SALES_DIMENSION_LABELS[report.groupBy]}</th>
              {report.thenBy && <th className={TH}>{SALES_DIMENSION_LABELS[report.thenBy]}</th>}
              <th className={TH}>تعداد فاکتور</th>
              {withQuantity && <th className={TH}>مقدار</th>}
              {withQuantity && <th className={TH}>مقدار برگشتی</th>}
              <th className={TH}>ناخالص ({money.label})</th>
              <th className={TH}>تخفیف</th>
              <th className={TH}>فروش خالص</th>
              <th className={TH}>برگشت از فروش</th>
              <th className={TH}>خالص پس از برگشت</th>
              {report.costVisible && <th className={TH}>بهای تمام‌شده</th>}
              {report.costVisible && <th className={TH}>سود ناخالص</th>}
              {report.costVisible && <th className={TH}>حاشیه سود</th>}
              {withPrevious && <th className={TH}>دوره مقایسه</th>}
              {withPrevious && <th className={TH}>تغییر</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={20} className="px-3 py-10 text-center text-sm text-slate-500">در این بازه و با این شرط‌ها فروشی نیست.</td>
              </tr>
            ) : report.rows.map(row => (
              <tr key={`${row.group.key}|${row.then?.key ?? ''}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/40">
                <td className={TD}><GroupCell group={row.group} /></td>
                {report.thenBy && <td className={TD}><GroupCell group={row.then} /></td>}
                {amountCells(row, row.then?.unit ?? row.group.unit)}
                {withPrevious && <td className={TD}>{money.format(row.previousNetAfterReturns)}</td>}
                {withPrevious && <td className={TD}>{percentText(row.changePercent)}</td>}
              </tr>
            ))}
          </tbody>
          {report.rows.length > 0 && (
            <tfoot className="bg-indigo-50/60 dark:bg-indigo-900/20 border-t-2 border-indigo-200 dark:border-indigo-800 font-black">
              <tr>
                <td className={`${TD} font-sans font-black`}>جمع همه ردیف‌ها</td>
                {report.thenBy && <td className={TD} />}
                {amountCells(report.totals)}
                {withPrevious && <td className={TD}>{money.format(report.comparison?.totals.netAfterReturns)}</td>}
                {withPrevious && <td className={TD}>{percentText(report.comparison?.changePercent)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <ReportPager total={report.total} page={report.page} limit={report.limit} onPage={onPage} />
    </div>
  );
}
