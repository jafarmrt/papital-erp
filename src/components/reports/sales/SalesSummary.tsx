import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import { REPORT_COMPARE_LABELS, rangeLabel } from '../../../lib/reports/reportPeriods';
import type { SalesReport } from '../../../lib/reports/salesReport';
import { fin } from '../../../lib/financialDecimal';
import { formatPersianNumber } from '../../../utils';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۲.۳ و §۲.۴): کارت‌های جمع گزارش فروش، مقایسه با دوره دیگر، سطر هم‌خوانی با دفتر کل
 * و هشدار سند ارزی بی نرخ. مالیات و حمل سطح سندند و با پالایه کالا یا دسته جدا نمی‌شوند.
 */

export function percentText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${formatPersianNumber(value, 1)}٪`;
}

function Card({ title, value, hint, tone = 'slate' }: { title: string; value: string; hint?: string; tone?: 'slate' | 'emerald' | 'indigo' | 'rose' }) {
  const tones = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
    rose: 'text-rose-700 dark:text-rose-300',
  };
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-1 text-base font-black font-mono ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function SalesSummary({ report, money }: { report: SalesReport; money: ReportMoney }) {
  const { totals, comparison } = report;
  const unit = ` ${money.label}`;
  const vatNet = totals.vat !== null && totals.returnVat !== null ? fin(totals.vat).subtract(fin(totals.returnVat)).toString() : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          title="فروش خالص پس از برگشت"
          value={money.format(totals.netAfterReturns) + unit}
          tone="indigo"
          hint={comparison ? `${REPORT_COMPARE_LABELS[comparison.mode]}: ${money.format(comparison.totals.netAfterReturns)} (${percentText(comparison.changePercent)})` : undefined}
        />
        <Card title="فروش خالص (پس از تخفیف)" value={money.format(totals.net) + unit} hint={`ناخالص ${money.format(totals.gross)}، تخفیف ${money.format(totals.discount)}`} />
        <Card title="برگشت از فروش" value={money.format(totals.returnAmount) + unit} tone="rose" hint={`${formatPersianNumber(totals.returnCount)} سند برگشت`} />
        {report.costVisible ? (
          <Card
            title="سود ناخالص"
            value={money.format(totals.grossProfit) + unit}
            tone="emerald"
            hint={`بهای تمام‌شده ${money.format(totals.cost)}، حاشیه سود ${percentText(totals.marginPercent).replace('+', '')}`}
          />
        ) : (
          <Card title="تعداد فاکتور" value={formatPersianNumber(totals.invoiceCount)} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-2 border border-slate-200/70 dark:border-slate-700/70">
        <span>تعداد فاکتور: <b>{formatPersianNumber(totals.invoiceCount)}</b></span>
        {vatNet !== null ? (
          <>
            <span>مالیات بر ارزش افزوده فروش: <b>{money.format(totals.vat)}</b></span>
            <span>مالیات برگشت: <b>{money.format(totals.returnVat)}</b></span>
            <span>مالیات خالص: <b>{money.format(vatNet)}</b></span>
            <span>حمل و خدمات: <b>{money.format(totals.serviceCharge)}</b></span>
          </>
        ) : (
          <span>مالیات و حمل و خدمات در سطح سندند و با پالایه کالا یا دسته جدا نمی‌شوند.</span>
        )}
        {comparison && <span>{REPORT_COMPARE_LABELS[comparison.mode]}: {rangeLabel(comparison.range)}</span>}
      </div>
      <SalesLedgerLine report={report} money={money} />
      {report.unconvertedDocuments > 0 && (
        <p className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {report.currency === 'all'
            ? `${formatPersianNumber(report.unconvertedDocuments)} سند ارزی نرخ تبدیل ندارد و در جمع ریالی نیامده است.`
            : `${formatPersianNumber(report.unconvertedDocuments)} سند این ارز نرخ تبدیل ندارد و بهای آن در سود ناخالص نیامده است.`}
        </p>
      )}
    </div>
  );
}

function SalesLedgerLine({ report, money }: { report: SalesReport; money: ReportMoney }) {
  if (report.ledgerUnavailable === 'filtered') {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
        <Scale className="w-4 h-4 shrink-0" />
        هم‌خوانی با دفتر کل فقط بی پالایه مشتری، کالا، دسته، پروژه و کانال سنجیده می‌شود.
      </p>
    );
  }
  const ledger = report.ledger;
  if (!ledger) return null;
  // مبلغ ردیف ارزی دفتر به ریال گرد می‌شود (TD-260)، پس تفاوت کمتر از یک ریال گرد کردن است
  const tolerance = report.currency === 'all' || report.currency === 'IRR' ? 1 : 0.01;
  const matched = fin(ledger.difference).abs().lessThan(tolerance);
  const accounts = ledger.accounts.map(a => `${a.code} ${a.name}`).join('، ');
  return (
    <div className={`text-xs rounded-xl px-4 py-2 border ${matched
      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100'}`}
    >
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
        {matched ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Scale className="w-4 h-4 shrink-0" />}
        <span>هم‌خوانی با دفتر کل</span>
        <span>گزارش: {money.format(ledger.reportNet)}</span>
        <span>دفتر کل: {money.format(ledger.ledgerTotal)} (تأییدشده {money.format(ledger.approved)}، پیش‌نویس {money.format(ledger.draft)})</span>
        <span>تفاوت: {money.format(ledger.difference)}</span>
      </p>
      <p className="mt-1 font-normal">
        {matched
          ? 'فروش این گزارش با مانده حساب‌های فروش در دفتر کل برابر است.'
          : 'تفاوت یعنی سند حسابداری فاکتوری هنوز صادر نشده یا سند دستی روی حساب‌های فروش ثبت شده است.'}
        {accounts && ` حساب‌ها: ${accounts}.`}
      </p>
    </div>
  );
}
