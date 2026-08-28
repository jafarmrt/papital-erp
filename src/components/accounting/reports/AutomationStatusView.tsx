import React, { useEffect, useState } from 'react';
import { Factory, RefreshCw, FileWarning, CheckCircle2, AlertTriangle } from 'lucide-react';
import { fetchJson } from '../../../api';
import { formatPersianNumber } from '../../../utils';

// V10-6.1: پنل وضعیت اتوماسیون صدور اسناد دوبل — پوشش واقعی voucherها به تفکیک نوع سند
interface AutomationRow {
  docType: string;
  label: string;
  autoSupported: boolean;
  totalDocs: number;
  withVoucher: number;
  missingVoucher: number;
}

interface AutomationSummary {
  totalDocs: number;
  coveredDocs: number;
  coveragePercent: number;
  gapTypes: string[];
}

export const AutomationStatusView: React.FC = () => {
  const [report, setReport] = useState<AutomationRow[]>([]);
  const [summary, setSummary] = useState<AutomationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchJson('/accounting/automation-status', { signal });
      setReport(Array.isArray(res?.report) ? res.report : []);
      setSummary(res?.summary || null);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      // toast handled globally? keep local minimal
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl text-emerald-600 dark:text-emerald-400">
            <Factory className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">وضعیت اتوماسیون صدور اسناد دوبل</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">پوشش سند حسابداری خودکار برای اسناد نهایی، به تفکیک نوع سند</p>
          </div>
        </div>
        <button
          onClick={() => load()}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition"
        >
          <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          بروزرسانی
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
            <p className="text-xs text-slate-500 dark:text-slate-400">کل اسناد نهایی و پیش‌فاکتورها</p>
            <p className="text-xl font-black text-slate-800 dark:text-white mt-1 font-mono">{formatPersianNumber(summary.totalDocs)}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
            <p className="text-xs text-slate-500 dark:text-slate-400">دارای سند دوبل خودکار</p>
            <p className="text-xl font-black text-emerald-600 mt-1 font-mono">{formatPersianNumber(summary.coveredDocs)}</p>
          </div>
          <div className={`p-4 rounded-2xl border ${summary.coveragePercent >= 90 ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'}`}>
            <p className="text-xs text-slate-600 dark:text-slate-300">ضریب پوشش اتوماسیون</p>
            <p className={`text-xl font-black mt-1 font-mono ${summary.coveragePercent >= 90 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
              {formatPersianNumber(summary.coveragePercent)}٪
            </p>
          </div>
        </div>
      )}

      {summary && summary.gapTypes.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex items-start gap-3 no-print">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            <strong>شکاف اتوماسیون شناسایی‌شده:</strong> برای «{summary.gapTypes.join('، ')}» هنوز سناریوی پیش‌نویس ← تایید ← صدور خودکار سند دوبل پیاده‌سازی نشده است. این اسناد نیازمند صدور دستی سند حسابداری هستند.
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
        <table className="w-full text-right border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black">
              <th className="p-3">نوع سند</th>
              <th className="p-3 text-center">تعداد اسناد</th>
              <th className="p-3 text-center">دارای سند دوبل</th>
              <th className="p-3 text-center">بدون سند ( orphan )</th>
              <th className="p-3 text-center">وضعیت اتوماسیون</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-bold">
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400 animate-pulse">در حال محاسبه...</td></tr>
            ) : report.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">داده‌ای یافت نشد.</td></tr>
            ) : (
              report.map(r => (
                <tr key={r.docType} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                  <td className="p-3 text-slate-800 dark:text-slate-200">{r.label}</td>
                  <td className="p-3 text-center font-mono text-slate-700 dark:text-slate-300">{formatPersianNumber(r.totalDocs)}</td>
                  <td className="p-3 text-center font-mono text-emerald-600">{formatPersianNumber(r.withVoucher)}</td>
                  <td className={`p-3 text-center font-mono ${r.missingVoucher > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {formatPersianNumber(r.missingVoucher)}
                  </td>
                  <td className="p-3 text-center">
                    {r.autoSupported ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-[10px]">
                        <CheckCircle2 size={11} />
                        خودکار
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 text-[10px]">
                        <FileWarning size={11} />
                        دستی / فاز آینده
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
