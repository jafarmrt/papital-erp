import { 
  Calendar as CalendarIcon, Clock, UserCheck, TrendingUp, FileText, 
  Users, FileSpreadsheet, Printer, ChevronLeft, CalendarDays, X 
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianNumber, extractDateString } from '../../utils';
import { SimpleUserOption } from '../../hooks/useDailyLogs';

interface DailyLogSummaryViewProps {
  summaryMode: 'daily' | 'monthly';
  setSummaryMode: (mode: 'daily' | 'monthly') => void;
  summaryDateFilter: any;
  setSummaryDateFilter: (date: any) => void;
  summaryYear: string;
  setSummaryYear: (year: string) => void;
  summaryMonth: string;
  setSummaryMonth: (month: string) => void;
  summarySelectedUserId: string;
  setSummarySelectedUserId: (id: string) => void;
  summaryReportData: any;
  summaryLoading: boolean;
  systemUsers: SimpleUserOption[];
  selectedUserLogsModal: any;
  setSelectedUserLogsModal: (userModal: any) => void;
  onExportCSV: () => void;
  onPrint: () => void;
}

export function DailyLogSummaryView({
  summaryMode,
  setSummaryMode,
  summaryDateFilter,
  setSummaryDateFilter,
  summaryYear,
  setSummaryYear,
  summaryMonth,
  setSummaryMonth,
  summarySelectedUserId,
  setSummarySelectedUserId,
  summaryReportData,
  summaryLoading,
  systemUsers,
  selectedUserLogsModal,
  setSelectedUserLogsModal,
  onExportCSV,
  onPrint
}: DailyLogSummaryViewProps) {
  return (
    <div className="space-y-5 font-farsi text-right">
      {/* Summary Filter Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-4 print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          {/* Report Mode Toggle: Daily vs Monthly */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setSummaryMode('daily')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                summaryMode === 'daily'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              گزارش تجمیعی روزانه
            </button>
            <button
              onClick={() => setSummaryMode('monthly')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                summaryMode === 'monthly'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              گزارش تجمیعی ماهانه
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onExportCSV}
              className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              دریافت فایل اکسل (CSV)
            </button>
            <button
              onClick={onPrint}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              چاپ خروجی مدیریت
            </button>
          </div>
        </div>

        {/* Date & Personnel Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-center">
          {summaryMode === 'daily' ? (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">انتخاب روز شمسی:</label>
              <DatePicker
                value={summaryDateFilter}
                onChange={(dateObj: any) => {
                  setSummaryDateFilter(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white text-slate-800 text-center font-bold"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">ماه شمسی:</label>
                <select
                  value={summaryMonth}
                  onChange={(e) => setSummaryMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 focus:bg-white text-slate-800"
                >
                  <option value="01">فروردین</option>
                  <option value="02">اردیبهشت</option>
                  <option value="03">خرداد</option>
                  <option value="04">تیر</option>
                  <option value="05">مرداد</option>
                  <option value="06">شهریور</option>
                  <option value="07">مهر</option>
                  <option value="08">آبان</option>
                  <option value="09">آذر</option>
                  <option value="10">دی</option>
                  <option value="11">بهمن</option>
                  <option value="12">اسفند</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">سال شمسی:</label>
                <select
                  value={summaryYear}
                  onChange={(e) => setSummaryYear(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 focus:bg-white text-slate-800"
                >
                  <option value="1405">۱۴۰۵</option>
                  <option value="1404">۱۴۰۴</option>
                  <option value="1403">۱۴۰۳</option>
                  <option value="1402">۱۴۰۲</option>
                </select>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-slate-500 mb-1">فیلتر نیروی کاری / همکار:</label>
            <select
              value={summarySelectedUserId}
              onChange={(e) => setSummarySelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 focus:bg-white text-slate-800"
            >
              <option value="0">همه همکاران و پرسنل (تجمیعی)</option>
              {systemUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  👤 {u.full_name || u.username} ({u.username})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {summaryLoading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400 text-xs">
          در حال دریافت و محاسبه گزارش تجمیعی مدیریت...
        </div>
      ) : !summaryReportData ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 text-xs">
          اطلاعاتی جهت نمایش یافت نشد.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 p-4 rounded-2xl border border-indigo-100/80 shadow-2xs">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold">
                  <Clock className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-indigo-900">مجموع کارکرد کل</span>
              </div>
              <p className="text-xl font-black text-slate-900">
                {formatPersianNumber(summaryReportData.total_team_hours)} <span className="text-xs font-semibold text-slate-500">ساعت</span>
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <UserCheck className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-700">نیروهای دارای فعالیت</span>
              </div>
              <p className="text-xl font-black text-slate-900">
                {formatPersianNumber(summaryReportData.active_personnel_count)} <span className="text-xs font-normal text-slate-500">از {formatPersianNumber(summaryReportData.total_personnel_count)} نفر</span>
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-700">میانگین کارکرد هر نفر</span>
              </div>
              <p className="text-xl font-black text-slate-900">
                {formatPersianNumber(summaryReportData.avg_hours_per_person)} <span className="text-xs font-normal text-slate-500">ساعت</span>
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-700">کل گزارش‌های ثبت‌شده</span>
              </div>
              <p className="text-xl font-black text-slate-900">
                {formatPersianNumber(summaryReportData.total_logs_count)} <span className="text-xs font-normal text-slate-500">گزارش</span>
              </p>
            </div>
          </div>

          {/* Personnel Aggregated Breakdown Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-black text-slate-900">
                  جدول تجمیعی عملکرد پرسنل ({summaryMode === 'daily' ? 'روزانه' : 'ماهانه'})
                </h2>
              </div>
              <span className="text-xs font-bold text-slate-500">
                تعداد نیروها: {formatPersianNumber(summaryReportData.user_summaries?.length || 0)} نفر
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">همکار / نیروی کاری</th>
                    <th className="p-3.5">ساعات کارکرد</th>
                    <th className="p-3.5">روزهای کاری</th>
                    <th className="p-3.5">حالت کاری (حضوری / دورکاری)</th>
                    <th className="p-3.5">میانگین روزانه</th>
                    <th className="p-3.5">تعداد گزارش‌ها</th>
                    <th className="p-3.5 text-center">جزئیات و فعالیت‌ها</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaryReportData.user_summaries.map((u: any) => {
                    const maxHours = Math.max(...summaryReportData.user_summaries.map((x: any) => x.totalHours), 1);
                    const percent = Math.min(100, Math.round((u.totalHours / maxHours) * 100));

                    return (
                      <tr key={u.userId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-2xs">
                              {(u.userFullName || u.username)[0]}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">{u.userFullName}</p>
                              <p className="text-[11px] text-slate-400">@{u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <div className="space-y-1">
                            <span className="font-black text-indigo-900 text-sm">
                              {formatPersianNumber(u.totalHours)} ساعت
                            </span>
                            <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-indigo-600 rounded-full"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">
                          {formatPersianNumber(u.daysWorked)} روز
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-2 text-[11px]">
                            {u.onsiteCount > 0 && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold border border-blue-100">
                                🏢 {formatPersianNumber(u.onsiteCount)} حضوری
                              </span>
                            )}
                            {u.remoteCount > 0 && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold border border-emerald-100">
                                🏠 {formatPersianNumber(u.remoteCount)} دورکاری
                              </span>
                            )}
                            {u.onsiteCount === 0 && u.remoteCount === 0 && (
                              <span className="text-slate-400">بدون فعالیت</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">
                          {formatPersianNumber(u.avgDailyHours)} ساعت
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">
                          {formatPersianNumber(u.logsCount)} ثبت
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => setSelectedUserLogsModal(u)}
                            disabled={u.logsCount === 0}
                            className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>مشاهده کارکرد</span>
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SELECTED USER DETAILED LOGS MODAL */}
      {selectedUserLogsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden text-right flex flex-col max-h-[85vh]">
            <div className="p-4 bg-indigo-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-indigo-700 text-white font-black text-xs flex items-center justify-center">
                  {(selectedUserLogsModal.userFullName || selectedUserLogsModal.username)[0]}
                </div>
                <div>
                  <h3 className="font-bold text-sm">{selectedUserLogsModal.userFullName}</h3>
                  <p className="text-[11px] text-indigo-200">
                    لیست گزارش کارهای ثبت‌شده ({formatPersianNumber(selectedUserLogsModal.logsCount)} مورد - مجموع {formatPersianNumber(selectedUserLogsModal.totalHours)} ساعت)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedUserLogsModal(null)}
                className="p-1 rounded-lg hover:bg-indigo-800 text-indigo-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              {(!selectedUserLogsModal.logs || selectedUserLogsModal.logs.length === 0) ? (
                <p className="text-center text-xs text-slate-400 py-8">هیچ گزارش کاری ثبت نشده است.</p>
              ) : (
                selectedUserLogsModal.logs.map((log: any) => (
                  <div key={log.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900">{log.title}</span>
                        {log.work_mode === 'onsite' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 text-blue-800 font-bold">🏢 حضوری</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold">🏠 دورکاری</span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 font-bold">
                        📅 {formatPersianNumber(log.date)} ({formatPersianNumber(log.start_time)} تا {formatPersianNumber(log.end_time)} - {formatPersianNumber(log.work_hours)} ساعت)
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed bg-white p-2.5 rounded-lg border border-slate-100">
                      {log.content}
                    </p>

                    {log.project_name && (
                      <div className="text-[11px] font-bold text-indigo-700">
                        📦 پروژه مرتبط: {log.project_name}
                      </div>
                    )}

                    {log.manager_notes && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                        💬 بازخورد مدیریت: {log.manager_notes}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedUserLogsModal(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
