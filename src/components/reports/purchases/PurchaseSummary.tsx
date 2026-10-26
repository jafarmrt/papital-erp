import type { ReactNode } from 'react';
import { AlertTriangle, Package, Truck } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import { REPORT_COMPARE_LABELS, rangeLabel } from '../../../lib/reports/reportPeriods';
import type { PurchaseReport, PurchaseTopEntry } from '../../../lib/reports/purchaseReport';
import { formatPersianNumber, formatPersianCode } from '../../../utils';
import { percentText } from '../sales/SalesSummary';

/**
 * v10.1.15 (D-03 بخش ۴، ت۱۵): کارت‌های جمع گزارش خرید، مقایسه با دوره دیگر، هشدار سند ارزی بی نرخ و ده تأمین‌کننده بزرگ و
 * ده کالای پرخرید بازه.
 */

function Card({ title, value, hint, strong = false }: { title: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-1 text-base font-black font-mono ${strong ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-white'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function PurchaseSummary({ report, money }: { report: PurchaseReport; money: ReportMoney }) {
  const { totals, comparison } = report;
  const unit = ` ${money.label}`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          title="خرید خالص"
          value={money.format(totals.net) + unit}
          strong
          hint={comparison ? `${REPORT_COMPARE_LABELS[comparison.mode]}: ${money.format(comparison.totals.net)} (${percentText(comparison.changePercent)})` : undefined}
        />
        <Card title="مبلغ ناخالص" value={money.format(totals.gross) + unit} hint="پیش از تخفیف سطرها" />
        <Card title="تعداد سند خرید" value={formatPersianNumber(totals.documentCount)} />
        {totals.quantity !== null ? (
          <Card title="مقدار خریدشده" value={formatPersianNumber(totals.quantity, 4)} hint={`میانگین بها ${money.format(totals.averageUnitPrice)}`} />
        ) : (
          <Card title="تخفیف خرید" value={money.format(totals.discount) + unit} />
        )}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-2 border border-slate-200/70 dark:border-slate-700/70">
        رسید و سند خرید قطعی و باطل‌نشده به تاریخ خود سند؛ پیش‌فاکتور و پیش‌نویس خرید شمرده نمی‌شوند. کالای اهدایی فقط در مقدار
        می‌آید و برنامه سند برگشت از خرید ندارد.
        {comparison && ` ${REPORT_COMPARE_LABELS[comparison.mode]}: ${rangeLabel(comparison.range)}`}
      </p>
      {report.unconvertedDocuments > 0 && (
        <p className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {`${formatPersianNumber(report.unconvertedDocuments)} سند ارزی نرخ تبدیل ندارد و در جمع ریالی نیامده است.`}
        </p>
      )}
    </div>
  );
}

function TopList({ title, icon, entries, money, withQuantity }: {
  title: string;
  icon: ReactNode;
  entries: PurchaseTopEntry[];
  money: ReportMoney;
  withQuantity: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm p-4">
      <h3 className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100 mb-2">{icon}{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">خریدی نیست.</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex items-center justify-between gap-3 text-xs py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-5 text-center font-black text-slate-400">{formatPersianNumber(index + 1)}</span>
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{entry.label}</span>
                {entry.code && <span className="text-[11px] text-slate-500 font-mono">{formatPersianCode(entry.code)}</span>}
              </span>
              <span className="flex items-center gap-3 shrink-0 font-mono">
                {withQuantity && entry.quantity !== null && (
                  <span className="text-slate-500">{formatPersianNumber(entry.quantity, 4)}{entry.unit ? ` ${entry.unit}` : ''}</span>
                )}
                <span className="font-black text-indigo-700 dark:text-indigo-300">{money.format(entry.net)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PurchaseTopLists({ report, money }: { report: PurchaseReport; money: ReportMoney }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <TopList title={`ده تأمین‌کننده بزرگ (${money.label})`} icon={<Truck className="w-4 h-4 text-indigo-500" />} entries={report.topSuppliers} money={money} withQuantity={false} />
      <TopList title={`ده کالای پرخرید (${money.label})`} icon={<Package className="w-4 h-4 text-amber-500" />} entries={report.topItems} money={money} withQuantity />
    </div>
  );
}
