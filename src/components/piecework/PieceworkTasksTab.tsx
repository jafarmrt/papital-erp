import React from 'react';
import { Search, Plus, Award, Edit2, Trash2 } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkTasksTabProps {
  tasksList: PieceworkTask[];
  categoriesList: string[];
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenAddTaskModal: () => void;
  onEditTask: (task: PieceworkTask) => void;
  onDeleteTask: (task: PieceworkTask) => void;
}

export function PieceworkTasksTab({
  tasksList,
  categoriesList,
  categoryFilter,
  onCategoryFilterChange,
  searchQuery,
  onSearchChange,
  onOpenAddTaskModal,
  onEditTask,
  onDeleteTask
}: PieceworkTasksTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  return (
    <div className="space-y-4">
      {/* Search & Actions Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="جستجو در عناوین و دسته‌بندی کارها..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 shrink-0">
          <button
            onClick={() => onCategoryFilterChange('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            همه
          </button>
          {categoriesList.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryFilterChange(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          onClick={onOpenAddTaskModal}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>افزودن عنوان کاری جدید</span>
        </button>
      </div>

      {/* Tasks Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black">
                <th className="p-3">عنوان کاری</th>
                <th className="p-3">دسته‌بندی</th>
                <th className="p-3 text-center">واحد سنجش</th>
                <th className="p-3 text-center">{`نرخ پایه پیش‌فرض (${curLbl})`}</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold">
              {tasksList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    هیچ عنوان کاری ثبت نشده است.
                  </td>
                </tr>
              ) : (
                tasksList.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 transition-all text-slate-700">
                    <td className="p-3 font-black text-slate-900 flex items-center gap-2">
                      <Award size={16} className="text-blue-600 shrink-0" />
                      <span>{task.title}</span>
                    </td>
                    <td className="p-3">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold">
                        {task.category || 'عمومی'}
                      </span>
                    </td>
                    <td className="p-3 text-center text-slate-600">
                      {task.unit || 'عدد'}
                    </td>
                    <td className="p-3 text-center font-mono text-emerald-700 font-black">
                      {formatPersianPrice(task.defaultRate)}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onEditTask(task)}
                          title="ویرایش عنوان"
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => onDeleteTask(task)}
                          title="حذف عنوان"
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
