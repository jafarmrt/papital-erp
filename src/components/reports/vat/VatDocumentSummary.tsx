import { AlertTriangle, Info } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import {
  VAT_WARNINGS, VAT_WARNING_LABELS, vatRateLabel, type VatAmounts, type VatReport,
} from '../../../lib/reports/vatReport';
import { formatPersianNumber } from '../../../utils';

/**
 * v10.1.13 (D-03، طرح گزارش‌های مدیریتی §۴): بخش ۱ «مالیات بر ارزش افزوده»، از سندها: کارت‌های مالیات فروش، مالیات برگشت
 * و خالص؛ جدول به تفکیک درصد؛ هشدارهای سندها؛ و جای خالی مالیات خرید که در برنامه ثبت نمی‌شود (ت۱۳).
 */

const TH = 'px-3 py-2 text-[11px] font-black text-slate-600 dark:text-slate-300 whitespace-nowrap';
const TD = 'px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 whitespace-nowrap';

function Card({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-1 text-base font-black font-mono ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function AmountCells({ a, money }: { a: VatAmounts; money: ReportMoney }) {
  return (
    <>
      <td className={TD}>{formatPersianNumber(a.invoiceCount)}</td>
      <td className={TD}>{money.format(a.salesBase)}</td>
      <td className={`${TD} text-indigo-700 dark:text-indigo-300`}>{money.format(a.salesVat)}</td>
      <td className={TD}>{formatPersianNumber(a.returnCount)}</td>
      <td className={TD}>{money.format(a.returnBase)}</td>
      <td className={`${TD} text-rose-700 dark:text-rose-300`}>{money.format(a.returnVat)}</td>
      <td className={`${TD} font-black`}>{money.format(a.netVat)}</td>
    </>
  );
}

export function VatDocumentSummary({ report, money }: { report: VatReport; money: ReportMoney }) {
  const { totals } = report;
  const unit = ` ${money.label}`;
  const warnings = VAT_WARNINGS.filter(w => report.warnings[w] > 0);
  return (
    <section className="space-y-3" aria-labelledby="vat-part-documents">
      <h3 id="vat-part-documents" className="text-sm font-black text-slate-800 dark:text-slate-100">بخش ۱: از سندهای فروش</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card
          title="مالیات فاکتورهای فروش"
          value={money.format(totals.salesVat) + unit}
          tone="text-indigo-700 dark:text-indigo-300"
          hint={`${formatPersianNumber(totals.invoiceCount)} فاکتور، مبلغ خالص ${money.format(totals.salesBase)}`}
        />
        <Card
          title="مالیات برگشت از فروش (کاهنده)"
          value={money.format(totals.returnVat) + unit}
          tone="text-rose-700 dark:text-rose-300"
          hint={`${formatPersianNumber(totals.returnCount)} برگشت، مبلغ خالص ${money.format(totals.returnBase)}`}
        />
        <Card title="خالص مالیات فروش دوره" value={money.format(totals.netVat) + unit} tone="text-slate-900 dark:text-white" hint="مالیات فروش منهای مالیات برگشت" />
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className={TH}>درصد مالیات</th>
                <th className={TH}>شمار فاکتور</th>
                <th className={TH}>مبلغ خالص فروش ({money.label})</th>
                <th className={TH}>مالیات فروش</th>
                <th className={TH}>شمار برگشت</th>
                <th className={TH}>مبلغ خالص برگشت</th>
                <th className={TH}>مالیات برگشت</th>
                <th className={TH}>خالص مالیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {report.rates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">در این دوره فاکتور فروش یا برگشت قطعی نیست.</td>
                </tr>
              ) : report.rates.map(r => (
                <tr key={r.key} data-testid={`vat-rate-${r.key}`}>
                  <td className={`${TD} font-sans font-bold`}>{vatRateLabel(r.percent)}</td>
                  <AmountCells a={r} money={money} />
                </tr>
              ))}
            </tbody>
            {report.rates.length > 0 && (
              <tfoot className="bg-indigo-50/60 dark:bg-indigo-900/20 border-t-2 border-indigo-200 dark:border-indigo-800 font-black">
                <tr>
                  <td className={`${TD} font-sans font-black`}>جمع</td>
                  <AmountCells a={totals} money={money} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 space-y-1" role="note">
          <p className="flex items-center gap-2 font-black">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            سندهایی که پیش از اظهارنامه باید دیده شوند (فهرست سندها را روی «فقط سندهای دارای هشدار» بگذارید):
          </p>
          <ul className="list-disc pr-8 space-y-0.5">
            {warnings.map(w => (
              <li key={w} data-testid={`vat-warning-${w}`}>{VAT_WARNING_LABELS[w]}: {formatPersianNumber(report.warnings[w])} سند</li>
            ))}
          </ul>
        </div>
      )}
      <p className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-2 border border-slate-200/70 dark:border-slate-700/70">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
        مالیات خرید (اعتبار مالیاتی) در برنامه ثبت نمی‌شود و این گزارش فقط مالیات فروش را دارد. این گزارش کمک حسابدار است و فرم اظهارنامه نیست.
      </p>
    </section>
  );
}
