import { AlertTriangle, CheckCircle2, DatabaseBackup, HelpCircle, XCircle } from 'lucide-react';
import { formatPersianNumber } from '../../utils/persianNumber';
import { formatPersianDateTime } from '../../utils/dateUtils';
import { NIGHTLY_VERIFY_MESSAGES, type NightlyVerifyHealth } from '../../lib/system/nightlyVerify';

const BADGES: Record<NightlyVerifyHealth['status'], { label: string; className: string }> = {
  ok: { label: 'سالم', className: 'bg-emerald-100 text-emerald-800' },
  warning: { label: 'بدتر از شب پیش', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'ناموفق', className: 'bg-rose-100 text-rose-800' },
  stale: { label: 'اجرا نشده', className: 'bg-amber-100 text-amber-800' },
  never: { label: 'هنوز اجرا نشده', className: 'bg-slate-200 text-slate-700' },
  unknown: { label: 'نامعلوم', className: 'bg-slate-200 text-slate-700' },
};

/**
 * v10.2.14 (O-04): کارت «بررسی شبانهٔ پشتیبان» در صفحه سلامت؛ آخرین بازیابی پشتیبان دیشب روی رونوشت جدا و نتیجهٔ بررسی
 * حساب‌ها و انبار روی آن. خطاهای کهنه فقط شمرده می‌شوند؛ هشدار وقتی است که چیزی از شب پیش بدتر شده باشد.
 */
export function NightlyVerifyHealthCard({ nightly }: { nightly?: NightlyVerifyHealth }) {
  const status = nightly?.status ?? 'unknown';
  const tone = status === 'ok'
    ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
    : status === 'failed' ? 'bg-rose-50/50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-800'
      : status === 'warning' || status === 'stale' ? 'bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'
        : 'bg-slate-50 border-slate-200 dark:bg-gray-900/40 dark:border-gray-700';
  const badge = BADGES[status];
  const count = (n: number | null | undefined) => (n === null || n === undefined ? 'نامعلوم' : formatPersianNumber(n));
  const messages = Array.isArray(nightly?.messages) && nightly.messages.length > 0 ? nightly.messages : [NIGHTLY_VERIFY_MESSAGES.unknown];
  const Icon = status === 'ok' ? CheckCircle2 : status === 'failed' ? XCircle : status === 'warning' || status === 'stale' ? AlertTriangle : HelpCircle;
  return (
    <div className={`p-4 border rounded-xl transition-all ${tone}`} data-status={status} data-testid="nightly-verify-health">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          <DatabaseBackup size={18} className="text-slate-500" />
          <span>بررسی شبانهٔ پشتیبان</span>
        </div>
        <span className={`${badge.className} text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1`}>
          <Icon size={12} /> {badge.label}
        </span>
      </div>
      {nightly?.finishedAt && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
          <dt>آخرین اجرا</dt>
          <dd data-field="finished">{formatPersianDateTime(nightly.finishedAt)}</dd>
          <dt>بررسی‌های سلامت مالی با خطا</dt>
          <dd data-field="health-errors">{count(nightly.healthErrorCount)}</dd>
          <dt>بررسی‌های سلامت مالی با هشدار</dt>
          <dd data-field="health-warnings">{count(nightly.healthWarningCount)}</dd>
          <dt>ناهمخوانی‌های حساب و انبار</dt>
          <dd data-field="invariants">{count(nightly.invariantViolationCount)}</dd>
        </dl>
      )}
      <ul className="mt-3 space-y-1 text-xs">
        {messages.map(message => (
          <li key={message} className={status === 'ok' || status === 'never' ? 'text-slate-600 dark:text-slate-300' : 'text-amber-800 dark:text-amber-300 font-bold'}>{message}</li>
        ))}
      </ul>
      {(nightly?.backupFile || (nightly?.worse.length ?? 0) > 0) && (
        <details className="mt-2 text-[10px] text-slate-500" data-technical>
          <summary className="cursor-pointer">جزئیات فنی</summary>
          {nightly?.backupFile && <p className="truncate" dir="ltr">{nightly.backupFile}</p>}
          {nightly?.worse.map(w => <p key={w} dir="ltr">{w}</p>)}
        </details>
      )}
    </div>
  );
}
