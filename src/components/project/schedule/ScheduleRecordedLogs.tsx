import { RefreshCw, Briefcase } from 'lucide-react';
import { formatPersianDate, formatPersianNumber, toPersianDigits } from '../../../utils';
import { useRialDisplay } from '../../../hooks/useAppCurrency';
import type { ProjectWorkLog } from '../../../hooks/queries/useProjectWorkspaceQueries';

interface ScheduleRecordedLogsProps {
  recordedLogs: ProjectWorkLog[];
  loadingLogs: boolean;
  onReload: () => void;
  totalLaborBudget: number;
}

const amountOf = (log: ProjectWorkLog) => Number(log.quantity || 0) * Number(log.unitRate || log.unit_rate || 0);

/** the project's work logs in the payroll, against the plan's estimate */
export function ScheduleRecordedLogs({ recordedLogs, loadingLogs, onReload, totalLaborBudget }: ScheduleRecordedLogsProps) {
  const rial = useRialDisplay();
  const totalActualRecordedCost = recordedLogs.reduce((sum, log) => sum + amountOf(log), 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
            <Briefcase className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-2">
              کارمزدهای قطعی ثبت‌شده برای این پروژه در ماژول حقوق و دستمزد
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-mono font-bold">
                {toPersianDigits(recordedLogs.length)} رکورد
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              مقایسه برآورد اولیه بودجه با کارکردهای واقعی تایید و ثبت‌شده در سامانه
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReload}
          disabled={loadingLogs}
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          title="به‌روزرسانی کارمزدها"
        >
          <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Real-time Summary Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-slate-500 block text-[11px]">کل برآورد بودجه دستمزد:</span>
          <span className="font-bold font-mono text-slate-800 text-sm mt-0.5 block">
            {rial.amount(totalLaborBudget)}
          </span>
        </div>

        <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200">
          <span className="text-emerald-700 block text-[11px]">مجموع کارمزدهای قطعی ثبت‌شده:</span>
          <span className="font-bold font-mono text-emerald-900 text-sm mt-0.5 block">
            {rial.amount(totalActualRecordedCost)}
          </span>
        </div>

        <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200">
          <span className="text-amber-800 block text-[11px]">انحراف از برآورد اولیه:</span>
          <span className={`font-bold font-mono text-sm mt-0.5 block ${totalActualRecordedCost > totalLaborBudget ? 'text-rose-600' : 'text-slate-700'}`}>
            {rial.amount(Math.abs(totalActualRecordedCost - totalLaborBudget))}
            <span className="text-[10px] font-sans mr-1">
              {totalActualRecordedCost > totalLaborBudget ? '(مازاد بر بودجه)' : '(باقی‌مانده تا سقف بودجه)'}
            </span>
          </span>
        </div>
      </div>

      {/* Logged Rows Mini Table */}
      {recordedLogs.length > 0 ? (
        <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
          <table className="w-full text-right text-[11px]">
            <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
              <tr>
                <th className="p-2">تاریخ</th>
                <th className="p-2">نام پرسنل</th>
                <th className="p-2">عنوان وظیفه کارمزدی</th>
                <th className="p-2 text-center">تعداد</th>
                <th className="p-2 text-center">نرخ واحد</th>
                <th className="p-2 text-center">مبلغ کل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {recordedLogs.map((log, lIdx) => {
                const qty = Number(log.quantity || 0);
                const rate = Number(log.unitRate || log.unit_rate || 0);
                return (
                  <tr key={log.id || lIdx} className="hover:bg-slate-50">
                    <td className="p-2 font-mono text-slate-500">{log.date ? formatPersianDate(log.date) : '---'}</td>
                    <td className="p-2 font-bold text-slate-800">
                      {log.personnelName || log.personnel_name || `پرسنل #${toPersianDigits(log.personnelId || log.personnel_id)}`}
                    </td>
                    <td className="p-2 text-slate-700">
                      {log.taskTitle || log.task_title || log.taskCode || log.notes || 'کارکرد کارمزدی'}
                    </td>
                    <td className="p-2 text-center font-mono font-bold text-slate-800">{formatPersianNumber(qty)}</td>
                    <td className="p-2 text-center font-mono text-slate-600">{rial.amount(rate)}</td>
                    <td className="p-2 text-center font-mono font-bold text-emerald-700">
                      {rial.amount(qty * rate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-xs">
          هنوز رکوردی در ماژول کارمزد برای این پروژه ثبت نشده است. می‌توانید از دکمه‌های «ثبت کارمزد» یا «ثبت گروهی کارکرد مرحله» برای ثبت فوری کارکردها استفاده کنید.
        </div>
      )}
    </div>
  );
}
