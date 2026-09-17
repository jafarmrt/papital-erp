import React, { useState, useEffect } from 'react';
import { TrendingUp, X, ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { formatPersianPrice, extractDateString } from '../../../utils';

interface CashFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadReport?: (startDate?: string, endDate?: string) => Promise<any>;
}

export const CashFlowModal: React.FC<CashFlowModalProps> = ({
  isOpen,
  onClose,
  onLoadReport,
}) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [report, setReport] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async (start?: string, end?: string) => {
    if (!onLoadReport) return;
    setIsLoading(true);
    try {
      const data = await onLoadReport(start || undefined, end || undefined);
      setReport(data);
    } catch {
      // Handled in parent
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchReport(dateFrom, dateTo);
    } else {
      setReport(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            گزارش جریان وجوه نقد (صورت گردش نقدینگی)
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Date Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-200 dark:border-slate-600">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-400">از تاریخ:</span>
            <DatePicker
              value={dateFrom}
              onChange={(d: any) => setDateFrom(extractDateString(d))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-400">تا تاریخ:</span>
            <DatePicker
              value={dateTo}
              onChange={(d: any) => setDateTo(extractDateString(d))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center"
            />
          </div>
          <button
            onClick={() => fetchReport(dateFrom, dateTo)}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition cursor-pointer disabled:opacity-50 mr-auto"
          >
            {isLoading ? 'در حال دریافت...' : 'اعمال فیلتر'}
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-400">در حال محاسبه و تجمیع داده‌های جریان نقد...</div>
        ) : report ? (
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-1">
                  <ArrowDownLeft size={14} />
                  ورودی نقدینگی
                </div>
                <div className="font-bold font-mono text-emerald-700 dark:text-emerald-300 text-sm">
                  {formatPersianPrice(report.summary?.totalInflow || 0)}
                </div>
              </div>

              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-center">
                <div className="flex items-center justify-center gap-1 text-rose-600 dark:text-rose-400 text-xs font-bold mb-1">
                  <ArrowUpRight size={14} />
                  خروجی نقدینگی
                </div>
                <div className="font-bold font-mono text-rose-700 dark:text-rose-300 text-sm">
                  {formatPersianPrice(report.summary?.totalOutflow || 0)}
                </div>
              </div>

              <div className={`p-3 border rounded-xl text-center ${
                (report.summary?.netCashFlow || 0) >= 0
                  ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
              }`}>
                <div className="flex items-center justify-center gap-1 text-xs font-bold mb-1">
                  <Scale size={14} />
                  جریان خالص نقد
                </div>
                <div className="font-bold font-mono text-sm">
                  {formatPersianPrice(report.summary?.netCashFlow || 0)}
                </div>
              </div>
            </div>

            {/* Monthly Trend Table */}
            {Array.isArray(report.monthly) && report.monthly.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">روند ماهانه جریان نقد</h4>
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-slate-50 dark:bg-slate-700/60 font-bold text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="p-2.5">ماه</th>
                        <th className="p-2.5 text-emerald-600">ورودی</th>
                        <th className="p-2.5 text-rose-600">خروجی</th>
                        <th className="p-2.5">جریان خالص</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {report.monthly.map((m: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="p-2.5 font-bold font-mono">{m.month}</td>
                          <td className="p-2.5 font-mono text-emerald-600">+{formatPersianPrice(m.inflow)}</td>
                          <td className="p-2.5 font-mono text-rose-600">-{formatPersianPrice(m.outflow)}</td>
                          <td className={`p-2.5 font-mono font-bold ${m.net >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>
                            {formatPersianPrice(m.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">اطلاعاتی برای نمایش وجود ندارد.</div>
        )}

        <div className="flex justify-end mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};
