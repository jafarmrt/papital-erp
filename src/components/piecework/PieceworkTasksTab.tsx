import { Search, Plus, Award, Edit2, Trash2, FileSpreadsheet, Download, Upload, History, RotateCcw, Archive, CheckCircle2 } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkTasksTabProps {
  tasksList: PieceworkTask[];
  categoriesList: string[];
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  taskStatusFilter: 'active' | 'archived' | 'all';
  onTaskStatusFilterChange: (status: 'active' | 'archived' | 'all') => void;
  onOpenAddTaskModal: () => void;
  onEditTask: (task: PieceworkTask) => void;
  onDeleteTask: (task: PieceworkTask) => void;
  onRestoreTask: (task: PieceworkTask) => void;
  onOpenTaskHistory: (task: PieceworkTask) => void;
  onOpenGlobalHistory: () => void;
  onOpenExcelModal: () => void;
  onDownloadTemplate: () => void;
}

export function PieceworkTasksTab({
  tasksList,
  categoriesList,
  categoryFilter,
  onCategoryFilterChange,
  searchQuery,
  onSearchChange,
  taskStatusFilter,
  onTaskStatusFilterChange,
  onOpenAddTaskModal,
  onEditTask,
  onDeleteTask,
  onRestoreTask,
  onOpenTaskHistory,
  onOpenGlobalHistory,
  onOpenExcelModal,
  onDownloadTemplate
}: PieceworkTasksTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);

  return (
    <div className="space-y-4">
      {/* Top Action & Search Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-slate-200 dark:border-gray-700 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="جستجو در عناوین، کدها و دسته‌بندی کارها..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-3 pr-9 py-2 bg-slate-50 dark:bg-gray-900/50 border border-slate-200 dark:border-gray-700 rounded-xl text-xs font-bold text-slate-800 dark:text-gray-100 outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Rate History Global Button */}
            <button
              onClick={onOpenGlobalHistory}
              className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800/60 active:scale-98 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="مشاهده گاه‌شمار کامل تمام تغییرات، نرخ‌های قدیمی، ویرایش‌ها و حذف‌ها"
            >
              <History size={16} className="text-amber-600 dark:text-amber-400" />
              <span>تاریخچه نرخ‌ها و سوابق</span>
            </button>

            {/* Excel Management Button */}
            <button
              onClick={onOpenExcelModal}
              className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-800/60 active:scale-98 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="بارگذاری فایل اکسل، خروجی اکسل یا دانلود الگو"
            >
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>مدیریت اکسل (ورود / خروج)</span>
            </button>

            {/* Download Template Shortcut */}
            <button
              onClick={onDownloadTemplate}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-slate-700 dark:text-gray-200 active:scale-98 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title="دانلود فایل نمونه اکسل جهت پر کردن داده‌ها"
            >
              <Download size={15} />
              <span className="hidden sm:inline">قالب اکسل</span>
            </button>

            {/* Add Task Button */}
            <button
              onClick={onOpenAddTaskModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={16} />
              <span>افزودن عنوان کاری</span>
            </button>

          </div>
        </div>

        {/* Status Switcher (Active vs Archived) & Category Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-gray-700">
          
          {/* Active / Archived Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-gray-900/60 p-1 rounded-xl">
            <button
              onClick={() => onTaskStatusFilterChange('active')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                taskStatusFilter === 'active'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 size={13} />
              <span>عناوین فعال</span>
            </button>

            <button
              onClick={() => onTaskStatusFilterChange('archived')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                taskStatusFilter === 'archived'
                  ? 'bg-white dark:bg-gray-800 text-rose-600 dark:text-rose-400 shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
              }`}
            >
              <Archive size={13} />
              <span>حذف‌شده / بایگانی</span>
            </button>

            <button
              onClick={() => onTaskStatusFilterChange('all')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                taskStatusFilter === 'all'
                  ? 'bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-gray-400 hover:text-slate-900'
              }`}
            >
              <span>همه</span>
            </button>
          </div>

          {/* Category Filters Bar */}
          {categoriesList.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
              <span className="text-[11px] font-bold text-slate-400 dark:text-gray-500 shrink-0 ml-1">
                دسته:
              </span>
              <button
                onClick={() => onCategoryFilterChange('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                  categoryFilter === 'all'
                    ? 'bg-slate-900 dark:bg-gray-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-gray-700/60 text-slate-600 dark:text-gray-300 hover:bg-slate-200'
                }`}
              >
                همه ({formatPersianNumber(tasksList.length)})
              </button>
              {categoriesList.map((cat) => (
                <button
                  key={cat}
                  onClick={() => onCategoryFilterChange(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-slate-900 dark:bg-gray-100 text-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-gray-700/60 text-slate-600 dark:text-gray-300 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tasks Table or Empty State */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        {tasksList.length === 0 ? (
          <div className="py-16 px-4 text-center max-w-lg mx-auto flex flex-col items-center justify-center space-y-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-3xl border border-blue-100 dark:border-blue-900/50 shadow-inner">
              {taskStatusFilter === 'archived' ? <Archive size={40} /> : <FileSpreadsheet size={40} />}
            </div>
            
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {taskStatusFilter === 'archived'
                  ? 'هیچ عنوان کاری حذف‌شده یا بایگانی‌شده‌ای یافت نشد'
                  : 'هیچ عنوان کاری در سیستم ثبت نشده است'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 font-medium mt-1.5 leading-relaxed">
                {taskStatusFilter === 'archived'
                  ? 'عناوینی که در سیستم حذف شوند به این بخش منتقل شده و تاریخچه نرخ‌های گذشته آن‌ها برای همیشه در دسترس خواهد بود.'
                  : 'برای مدیریت کارمزد پرکیسی پرسنل، می‌توانید عناوین و نرخ‌های پایه کارگاه خود را از طریق فایل اکسل بارگذاری کنید یا به صورت تکی تعریف فرمایید.'}
              </p>
            </div>

            {taskStatusFilter === 'active' && (
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                <button
                  onClick={onOpenExcelModal}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Upload size={16} />
                  <span>بارگذاری از طریق فایل اکسل</span>
                </button>

                <button
                  onClick={onDownloadTemplate}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-slate-700 dark:text-gray-200 active:scale-98 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Download size={16} />
                  <span>دانلود قالب نمونه اکسل</span>
                </button>

                <button
                  onClick={onOpenAddTaskModal}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Plus size={16} />
                  <span>تعریف دستی عنوان کاری</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900/40 border-b border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 font-black">
                  <th className="p-3 w-16 text-center">کد</th>
                  <th className="p-3">عنوان کاری</th>
                  <th className="p-3">دسته‌بندی</th>
                  <th className="p-3 text-center">واحد سنجش</th>
                  <th className="p-3 text-left">{`نرخ پایه جاری (${curLbl})`}</th>
                  <th className="p-3 text-center w-28">عملیات و سوابق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-700/60 font-bold">
                {tasksList.map((task) => {
                  const isDeleted = Number(task.isDeleted) === 1;

                  return (
                    <tr
                      key={task.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-gray-700/40 transition-all ${
                        isDeleted ? 'bg-rose-50/30 dark:bg-rose-950/10 text-slate-400 dark:text-gray-500' : 'text-slate-700 dark:text-gray-200'
                      }`}
                    >
                      <td className="p-3 text-center font-mono text-[11px] text-slate-500 dark:text-gray-400">
                        {task.code || `PW-${String(task.id).padStart(3, '0')}`}
                      </td>
                      <td className="p-3 font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Award size={16} className={isDeleted ? 'text-rose-400 shrink-0' : 'text-blue-600 dark:text-blue-400 shrink-0'} />
                        <span className={isDeleted ? 'line-through opacity-75' : ''}>{task.title}</span>
                        {isDeleted && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                            بایگانی‌شده
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="px-2.5 py-1 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-300 rounded-lg text-[11px] font-bold">
                          {task.category || 'عمومی'}
                        </span>
                      </td>
                      <td className="p-3 text-center text-slate-600 dark:text-gray-400">
                        {task.unit || 'عدد'}
                      </td>
                      <td className="p-3 text-left font-mono text-emerald-700 dark:text-emerald-400 font-black">
                        {formatPersianPrice(task.defaultRate)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* History button */}
                          <button
                            onClick={() => onOpenTaskHistory(task)}
                            title="مشاهده سوابق و نرخ‌های پیشین این عنوان"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition-colors cursor-pointer"
                          >
                            <History size={15} />
                          </button>

                          {!isDeleted ? (
                            <>
                              <button
                                onClick={() => onEditTask(task)}
                                title="ویرایش عنوان"
                                className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors cursor-pointer"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => onDeleteTask(task)}
                                title="حذف و انتقال به بایگانی"
                                className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => onRestoreTask(task)}
                              title="بازیابی عنوان به لیست فعال"
                              className="p-1.5 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 rounded-lg transition-colors cursor-pointer flex items-center gap-1 font-bold text-xs"
                            >
                              <RotateCcw size={14} />
                              <span>بازیابی</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
