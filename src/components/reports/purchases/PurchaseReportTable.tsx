import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  PURCHASE_DIMENSION_LABELS, type PurchaseAmounts, type PurchaseGroup, type PurchaseReport,
} from '../../../lib/reports/purchaseReport';
import { formatPersianNumber, formatPersianCode } from '../../../utils';
import { ReportPager } from '../ReportPager';
import { percentText } from '../sales/SalesSummary';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۵): جدول گزارش خرید، یک صفحه از ردیف‌های کارساز با ردیف جمع همه ردیف‌ها. مقدار و میانگین بهای
 * خرید فقط وقتی ستون دارند که کالا در تفکیک یا پالایه است.
 */

interface PurchaseReportTableProps {
  report: PurchaseReport;
  money: ReportMoney;
  onPage: (page: number) => void;
}

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';

function GroupCell({ group }: { group: PurchaseGroup | null }) {
  if (!group) return <span className="text-slate-400">—</span>;
  return (
    <span className="font-bold font-sans">
      {group.label}
      {group.code && <span className="mr-1 text-[11px] text-slate-500 font-mono">{formatPersianCode(group.code)}</span>}
    </span>
  );
}

export function PurchaseReportTable({ report, money, onPage }: PurchaseReportTableProps) {
  const withQuantity = report.rows.some(r => r.quantity !== null) || report.totals.quantity !== null;
  const withPrevious = report.comparison !== null;
  const quantity = (value: string | null, unit?: string | null) => (value === null ? '—' : `${formatPersianNumber(value, 4)}${unit ? ` ${unit}` : ''}`);

  const amountCells = (a: PurchaseAmounts, unit?: string | null) => (
    <>
      <td className={TD}>{formatPersianNumber(a.documentCount)}</td>
      {withQuantity && <td className={TD}>{quantity(a.quantity, unit)}</td>}
      <td className={TD}>{money.format(a.gross)}</td>
      <td className={TD}>{money.format(a.discount)}</td>
      <td className={`${TD} font-black text-indigo-700 dark:text-indigo-300`}>{money.format(a.net)}</td>
      {withQuantity && <td className={TD}>{money.format(a.averageUnitPrice)}</td>}
    </>
  );

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className={TH}>{PURCHASE_DIMENSION_LABELS[report.groupBy]}</th>
              {report.thenBy && <th className={TH}>{PURCHASE_DIMENSION_LABELS[report.thenBy]}</th>}
              <th className={TH}>تعداد سند</th>
              {withQuantity && <th className={TH}>مقدار</th>}
              <th className={TH}>ناخالص ({money.label})</th>
              <th className={TH}>تخفیف</th>
              <th className={TH}>خرید خالص</th>
              {withQuantity && <th className={TH}>میانگین بهای خرید</th>}
              {withPrevious && <th className={TH}>دوره مقایسه</th>}
              {withPrevious && <th className={TH}>تغییر</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center text-sm text-slate-500">در این بازه و با این شرط‌ها خریدی نیست.</td>
              </tr>
            ) : report.rows.map(row => (
              <tr key={`${row.group.key}|${row.then?.key ?? ''}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/40">
                <td className={TD}><GroupCell group={row.group} /></td>
                {report.thenBy && <td className={TD}><GroupCell group={row.then} /></td>}
                {amountCells(row, row.then?.unit ?? row.group.unit)}
                {withPrevious && <td className={TD}>{money.format(row.previousNet)}</td>}
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
                {withPrevious && <td className={TD}>{money.format(report.comparison?.totals.net)}</td>}
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
