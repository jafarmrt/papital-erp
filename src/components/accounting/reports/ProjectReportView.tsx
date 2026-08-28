import React, { useEffect, useState } from 'react';
import { FolderKanban, RefreshCw } from 'lucide-react';
import { fetchJson } from '../../../api';
import { formatPersianNumber, formatPersianPrice, formatPersianDate, formatCurrencyLabel } from '../../../utils';
import { useAppCurrency } from '../../../hooks/useAppCurrency';

// V10-6.1: گزارش حسابداری per-project — خلاصه گردش + ریز با تراز جاری (فیلتر پروژه)
interface ProjectSummaryRow {
  projectId: number;
  projectCode: string;
  projectTitle: string;
  entriesCount: number;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

interface ProjectDetailRow {
  voucherNumber: string;
  voucherDate: string;
  voucherDescription: string;
  accountCode: string;
  accountName: string;
  lineDescription: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export const ProjectReportView: React.FC = () => {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);

  const [summary, setSummary] = useState<ProjectSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [detail, setDetail] = useState<ProjectDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummary = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchJson('/accounting/reports/project-summary', { signal });
      setSummary(Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []));
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (projectId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetchJson(`/accounting/reports/project-detail?projectId=${projectId}`);
      setDetail(Array.isArray(res?.detail) ? res.detail : []);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setDetail([]);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadSummary(controller.signal);
    return () => controller.abort();
  }, []);

  const handleSelectProject = (projectId: number | '') => {
    setSelectedProjectId(projectId);
    if (projectId !== '') loadDetail(Number(projectId));
    else setDetail([]);
  };

  const selectedSummary = summary.find(s => s.projectId === selectedProjectId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600 dark:text-indigo-400">
            <FolderKanban className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">گزارش حسابداری پروژه‌ها</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">گردش بدهکار/بستانکار اسناد دوبل مرتبط با هر پروژه و ریز تراکنش‌ها با تراز جاری</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedProjectId === '' ? '' : String(selectedProjectId)}
            onChange={(e) => handleSelectProject(e.target.value === '' ? '' : Number(e.target.value))}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 min-w-[220px]"
          >
            <option value="">-- انتخاب پروژه برای مشاهده ریز --</option>
            {summary.map(s => (
              <option key={s.projectId} value={s.projectId}>
                {s.projectCode ? `${s.projectCode} - ` : ''}{s.projectTitle}
              </option>
            ))}
          </select>
          <button
            onClick={() => loadSummary()}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition"
          >
            <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            بروزرسانی
          </button>
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
        <table className="w-full text-right border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black">
              <th className="p-3">کد پروژه</th>
              <th className="p-3">عنوان پروژه</th>
              <th className="p-3 text-center">تعداد آرتیکل</th>
              <th className="p-3 text-center">{`گردش بدهکار (${curLbl})`}</th>
              <th className="p-3 text-center">{`گردش بستانکار (${curLbl})`}</th>
              <th className="p-3 text-center">تراز</th>
              <th className="p-3 text-center no-print">ریز گردش</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-bold">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-400 animate-pulse">در حال محاسبه...</td></tr>
            ) : summary.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-400">هنوز آرتیکلی با تفصیلی پروژه در اسناد دوبل ثبت نشده است.</td></tr>
            ) : (
              summary.map(s => (
                <tr
                  key={s.projectId}
                  onClick={() => handleSelectProject(s.projectId)}
                  className={`hover:bg-slate-50/60 dark:hover:bg-slate-900/40 cursor-pointer ${selectedProjectId === s.projectId ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}`}
                >
                  <td className="p-3 font-mono text-slate-600 dark:text-slate-300">{s.projectCode || '-'}</td>
                  <td className="p-3 text-slate-800 dark:text-slate-200">{s.projectTitle}</td>
                  <td className="p-3 text-center font-mono text-slate-600 dark:text-slate-300">{formatPersianNumber(s.entriesCount)}</td>
                  <td className="p-3 text-center font-mono text-slate-700 dark:text-slate-300">{formatPersianPrice(s.totalDebit, appCurrency)}</td>
                  <td className="p-3 text-center font-mono text-slate-700 dark:text-slate-300">{formatPersianPrice(s.totalCredit, appCurrency)}</td>
                  <td className={`p-3 text-center font-mono font-black ${s.balance >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-rose-600'}`}>
                    {formatPersianPrice(s.balance, appCurrency)}
                  </td>
                  <td className="p-3 text-center no-print">
                    <span className="text-indigo-600 dark:text-indigo-400 text-[10px]">مشاهده ←</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Table */}
      {selectedProjectId !== '' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <h5 className="text-xs font-black text-slate-700 dark:text-slate-200">
              ریز گردش پروژه: {selectedSummary?.projectTitle || '-'} {selectedSummary?.projectCode ? `(${selectedSummary.projectCode})` : ''}
            </h5>
          </div>
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black">
                <th className="p-2.5">شماره سند</th>
                <th className="p-2.5">تاریخ</th>
                <th className="p-2.5">کد حساب</th>
                <th className="p-2.5">عنوان حساب</th>
                <th className="p-2.5">شرح</th>
                <th className="p-2.5 text-center">{`بدهکار (${curLbl})`}</th>
                <th className="p-2.5 text-center">{`بستانکار (${curLbl})`}</th>
                <th className="p-2.5 text-center">تراز جاری</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-bold">
              {detailLoading ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400 animate-pulse">در حال دریافت ریز گردش...</td></tr>
              ) : detail.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400">گردشی برای این پروژه یافت نشد.</td></tr>
              ) : (
                detail.map((d, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                    <td className="p-2.5 font-mono text-slate-700 dark:text-slate-300">{d.voucherNumber}</td>
                    <td className="p-2.5 font-mono text-slate-600 dark:text-slate-400">{formatPersianDate(d.voucherDate)}</td>
                    <td className="p-2.5 font-mono text-slate-600 dark:text-slate-400" dir="ltr">{d.accountCode || '-'}</td>
                    <td className="p-2.5 text-slate-700 dark:text-slate-300">{d.accountName || '-'}</td>
                    <td className="p-2.5 text-slate-600 dark:text-slate-400 max-w-[200px] truncate" title={d.lineDescription || d.voucherDescription}>
                      {d.lineDescription || d.voucherDescription || '-'}
                    </td>
                    <td className="p-2.5 text-center font-mono text-slate-700 dark:text-slate-300">{d.debit > 0 ? formatPersianPrice(d.debit, appCurrency) : '-'}</td>
                    <td className="p-2.5 text-center font-mono text-slate-700 dark:text-slate-300">{d.credit > 0 ? formatPersianPrice(d.credit, appCurrency) : '-'}</td>
                    <td className={`p-2.5 text-center font-mono font-black ${d.runningBalance >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-rose-600'}`}>
                      {formatPersianPrice(d.runningBalance, appCurrency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
