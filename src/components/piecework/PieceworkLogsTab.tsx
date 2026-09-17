import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { Search, Plus, Edit2, Trash2, CheckCircle2, Clock, FolderKanban } from 'lucide-react';
import { PieceworkLog } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { formatPersianPrice, formatQuantityOrTime, formatPersianDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkLogsTabProps {
  logsList: PieceworkLog[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedPersonnelFilter: string | number;
  onPersonnelFilterChange: (id: string | number) => void;
  selectedProjectFilter: string | number;
  onProjectFilterChange: (id: string | number) => void;
  statusFilter: string;
  onStatusFilterChange: (st: string) => void;
  startDateFilter: string;
  onStartDateChange: (d: string) => void;
  endDateFilter: string;
  onEndDateChange: (d: string) => void;
  personnelSelectOptions: { value: string; label: string }[];
  projectSelectOptions: { value: string; label: string }[];
  onOpenAddModal: () => void;
  onEditLog: (log: PieceworkLog) => void;
  onDeleteLog: (id: number) => void;
}

export function PieceworkLogsTab({
  logsList,
  loading,
  searchQuery,
  onSearchChange,
  selectedPersonnelFilter,
  onPersonnelFilterChange,
  selectedProjectFilter,
  onProjectFilterChange,
  statusFilter,
  onStatusFilterChange,
  startDateFilter,
  onStartDateChange,
  endDateFilter,
  onEndDateChange,
  personnelSelectOptions,
  projectSelectOptions,
  onOpenAddModal,
  onEditLog,
  onDeleteLog
}: PieceworkLogsTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو در کارکردها (پرسنل، عنوان کار، پروژه)..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={onOpenAddModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Plus size={16} />
            <span>ثبت کارکرد پرسنل</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">فیلتر پرسنل</label>
            <SearchableSelect
              options={[{ value: 'all', label: 'همه پرسنل' }, ...personnelSelectOptions]}
              value={String(selectedPersonnelFilter)}
              onChange={(val) => onPersonnelFilterChange(val)}
              placeholder="انتخاب پرسنل..."
              maxResults={50}
              className="w-full text-xs font-bold"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">فیلتر پروژه کارگاهی</label>
            <SearchableSelect
              options={[
                { value: 'all', label: 'همه پروژه‌ها (با و بدون پروژه)' },
                { value: 'none', label: 'بدون پروژه کارگاهی (عمومی)' },
                ...projectSelectOptions.filter(p => p.value !== '')
              ]}
              value={String(selectedProjectFilter)}
              onChange={(val) => onProjectFilterChange(val)}
              placeholder="انتخاب پروژه..."
              maxResults={50}
              className="w-full text-xs font-bold"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">از تاریخ</label>
            <DatePicker
              value={startDateFilter}
              onChange={(dateObj: any) => {
                onStartDateChange(extractDateString(dateObj));
              }}
              calendar={persian}
              locale={persian_fa}
              placeholder="از تاریخ..."
              inputClass="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none"
              containerClassName="w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">تا تاریخ</label>
            <DatePicker
              value={endDateFilter}
              onChange={(dateObj: any) => {
                onEndDateChange(extractDateString(dateObj));
              }}
              calendar={persian}
              locale={persian_fa}
              placeholder="تا تاریخ..."
              inputClass="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none"
              containerClassName="w-full"
            />
          </div>
        </div>

        {/* Status Pill Filters */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] font-bold text-slate-500">وضعیت تسویه:</span>
          {[
            { id: 'all', label: 'همه وضعیت‌ها' },
            { id: 'pending', label: 'در انتظار تسویه' },
            { id: 'processed', label: 'تسویه‌شده (فیش صادرشده)' }
          ].map(st => (
            <button
              key={st.id}
              onClick={() => onStatusFilterChange(st.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === st.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black">
                <th className="p-3">تاریخ</th>
                <th className="p-3">نام پرسنل</th>
                <th className="p-3">عنوان کاری</th>
                <th className="p-3">پروژه تولیدی</th>
                <th className="p-3 text-center">تعداد / کارکرد</th>
                <th className="p-3 text-center">{`نرخ واحد (${curLbl})`}</th>
                <th className="p-3 text-center">{`مبلغ کل (${curLbl})`}</th>
                <th className="p-3 text-center">وضعیت تسویه</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    در حال بارگذاری کارکردها...
                  </td>
                </tr>
              ) : logsList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    هیچ ردیف کارکردی با این فیلترها یافت نشد.
                  </td>
                </tr>
              ) : (
                logsList.map((log) => {
                  const isPending = log.status === 'pending';
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-all text-slate-700">
                      <td className="p-3 font-mono text-slate-800">{formatPersianDate(log.date)}</td>
                      <td className="p-3 font-black text-slate-900">{log.personnelName || '---'}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md font-bold text-[11px]">
                          {log.taskTitle || '---'}
                        </span>
                      </td>
                      <td className="p-3">
                        {log.projectTitle ? (
                          <span className="flex items-center gap-1 text-slate-800 font-bold text-[11px]">
                            <FolderKanban className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span>{log.projectTitle}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal text-[11px]">بدون پروژه</span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono text-slate-900 font-black">
                        {formatQuantityOrTime(log.quantity, log.unit)}
                      </td>
                      <td className="p-3 text-center font-mono text-slate-600">
                        {formatPersianPrice(log.unitRate)}
                      </td>
                      <td className="p-3 text-center font-mono text-blue-700 font-black">
                        {formatPersianPrice(log.totalAmount)}
                      </td>
                      <td className="p-3 text-center">
                        {isPending ? (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-[10px] inline-flex items-center gap-1">
                            <Clock size={12} />
                            در انتظار تسویه
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] inline-flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            فیش #{log.payrollId}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isPending && (
                            <>
                              <button
                                onClick={() => onEditLog(log)}
                                title="ویرایش کارکرد"
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => onDeleteLog(log.id)}
                                title="حذف کارکرد"
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
