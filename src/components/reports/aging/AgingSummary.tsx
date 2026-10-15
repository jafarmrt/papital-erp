import { AlertTriangle, BookOpen } from 'lucide-react';
import type { ReportMoney } from '../../../hooks/reports/useReportMoney';
import { fin } from '../../../lib/financialDecimal';
import { AGING_ADVANCE_LABELS, AGING_BUCKETS, agingOverdue, type AgingReport } from '../../../lib/reports/agingReport';
import { formatPersianNumber, toPersianDigits } from '../../../utils';

/**
 * v10.1.10 (D-03، طرح گزارش‌های مدیریتی §۳): کارت‌های جمع «سن مطالبات و بدهی‌ها»: جمع مانده سن‌دار، بالای ۹۰ روز،
 * پیش‌دریافت یا پیش‌پرداخت و مانده خالص حساب دفتر کل؛ نوار سهم هر بازه؛ سهم سندهای پیش‌نویس و چک‌های وصول‌نشده.
 */

export function agingPercentText(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${formatPersianNumber(value, 1)}٪`;
}

const BAR_TONES = ['bg-emerald-500', 'bg-lime-500', 'bg-amber-500', 'bg-orange-500', 'bg-rose-600'];

function Card({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-1 text-base font-black font-mono ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function AgingSummary({ report, money }: { report: AgingReport; money: ReportMoney }) {
  const { totals } = report;
  const unit = ` ${money.label}`;
  const aged = AGING_BUCKETS.reduce((acc, b) => acc.add(totals.buckets[b.key]), fin(0));
  const overdue = agingOverdue(totals.buckets);
  const overduePercent = aged.isZero() ? null : Math.round(overdue / aged.toNumber() * 1000) / 10;
  const isReceivable = report.kind === 'receivable';
  const hasDraft = totals.draft !== null && !fin(totals.draft).isZero();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          title={isReceivable ? 'جمع مطالبات سن‌دار' : 'جمع بدهی‌های سن‌دار'}
          value={money.format(aged.toString()) + unit}
          tone="text-indigo-700 dark:text-indigo-300"
          hint={`${formatPersianNumber(totals.partyCount)} طرف حساب`}
        />
        <Card
          title="مانده بالای ۹۰ روز"
          value={money.format(String(overdue)) + unit}
          tone="text-rose-700 dark:text-rose-300"
          hint={`${agingPercentText(overduePercent)} از مانده سن‌دار`}
        />
        <Card title={AGING_ADVANCE_LABELS[report.kind]} value={money.format(totals.advance) + unit} tone="text-emerald-700 dark:text-emerald-300" hint="بی سن، جدا از مانده سن‌دار" />
        <Card
          title="مانده خالص حساب"
          value={money.format(totals.balance) + unit}
          tone="text-slate-900 dark:text-white"
          hint={`${report.account.name} (${toPersianDigits(report.account.code)})`}
        />
      </div>
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-2">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
          {AGING_BUCKETS.map((b, i) => (
            <div key={b.key} className={BAR_TONES[i]} style={{ width: `${report.bucketPercents[b.key] ?? 0}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {AGING_BUCKETS.map((b, i) => (
            <div key={b.key} className="flex items-start gap-1.5" data-testid={`aging-bucket-${b.key}`}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${BAR_TONES[i]}`} aria-hidden />
              <div>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{b.label}</p>
                <p className="text-xs font-black font-mono text-slate-800 dark:text-slate-100">{money.format(totals.buckets[b.key])}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{agingPercentText(report.bucketPercents[b.key])}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-2 border border-slate-200/70 dark:border-slate-700/70">
        <span className="flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5 text-slate-400" aria-hidden />
          از دفتر کل، حساب {report.account.name} و زیرحساب‌هایش؛ دریافت‌ها و پرداخت‌ها از قدیمی‌ترین ردیف کم شده‌اند.
        </span>
        {report.chequesApply && (
          <span>
            {isReceivable ? 'چک‌های دریافتی وصول‌نشده' : 'چک‌های پرداختی وصول‌نشده'}: {money.format(totals.pendingCheques)}{unit}
          </span>
        )}
        {report.chequesApply && isReceivable && (
          <span>چک‌های برگشتی: {money.format(totals.bouncedCheques)}{unit}</span>
        )}
      </div>
      {hasDraft && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-xs font-bold text-amber-800 dark:text-amber-200" role="note">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {money.format(totals.draft)}{unit} از این مانده از سندهای پیش‌نویس است که هنوز تأیید نشده‌اند؛ برای دیدن فقط سندهای تأییدشده، گزینه بالا را بزنید.
        </div>
      )}
    </div>
  );
}
