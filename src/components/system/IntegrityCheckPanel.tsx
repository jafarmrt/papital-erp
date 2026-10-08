import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { formatPercent } from '../../lib/system/healthText';

/**
 * v9.0.392 (TD-622، B01-42، تصمیم ت۸): بخش «بررسی یکپارچگی سامانه» صفحه سلامت (پیش‌تر «اسکن انطباق»)، با شاخص و
 * شمارش‌ها به رقم فارسی. متن هر بررسی از سرور (`SystemReconciliationService`) می‌آید.
 */

export interface IntegrityCheckView {
  id: string;
  category: string;
  title: string;
  status: 'ok' | 'warning' | 'error';
  details: string;
}

export interface IntegrityReportView {
  healthScorePercentage: number;
  totalChecks: number;
  okChecks: number;
  checks: IntegrityCheckView[];
  timestamp: string;
}

function CheckIcon({ status }: { status: IntegrityCheckView['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (status === 'warning') return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  return <XCircle size={14} className="text-rose-500 shrink-0" />;
}

export function IntegrityCheckPanel({ report, running, onRun }: {
  report: IntegrityReportView | null;
  running: boolean;
  onRun: () => void;
}) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return (
    <div className="border dark:border-gray-700 rounded-xl p-5 bg-slate-50/60 dark:bg-gray-900/40 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b dark:border-gray-700 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Activity size={18} className="text-indigo-600" />
            بررسی یکپارچگی سامانه
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            ساختار پایگاه‌داده، صف رویدادها، تراز اسناد، کاردکس و مهلت‌های گردش کار
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all self-start sm:self-auto disabled:opacity-60"
        >
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} />
          <span>{running ? 'در حال بررسی…' : 'اجرای بررسی'}</span>
        </button>
      </div>

      {report && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-white dark:bg-gray-800 p-3.5 rounded-xl border dark:border-gray-700">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
              report.healthScorePercentage >= 90
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
            }`}>
              {formatPercent(report.healthScorePercentage)}
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                شاخص سلامت سامانه: {formatPercent(report.healthScorePercentage)}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {formatPersianNumber(report.okChecks)} بررسی از {formatPersianNumber(report.totalChecks)} بی مشکل بود.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-2.5">
            {checks.map(item => (
              <div key={item.id} className="bg-white dark:bg-gray-800 border dark:border-gray-700 p-3 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <CheckIcon status={item.status} />
                    <span>{item.title}</span>
                  </span>
                  <span className="text-[10px] bg-slate-100 dark:bg-gray-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 font-medium">
                    {item.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed pr-5">{item.details}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
