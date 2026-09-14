import React, { useState, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { Layers, Plus, Edit3, Trash2, Search, FolderPlus, Tag, Check, X } from 'lucide-react';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { toast } from 'react-hot-toast';

interface TaskCategory {
  id: number | string;
  name: string;
  description?: string;
}

interface PieceworkTask {
  id: number;
  code: string;
  title: string;
  category: string;
  defaultRate: number;
  unit: string;
  description?: string;
}

export function TaskTitlesSettingsTab() {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const [tasks, setTasks] = useState<PieceworkTask[]>([]);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCatFilter, setSelectedCatFilter] = useState<string>('ALL');

  // Task Modal State
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PieceworkTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    code: '',
    title: '',
    category: '',
    defaultRate: 0,
    unit: 'عدد',
    description: ''
  });
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Category Modal State
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<TaskCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [isSavingCat, setIsSavingCat] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tData, cData] = await Promise.all([
        fetchJson('/piecework/tasks'),
        fetchJson('/piecework/categories')
      ]);
      setTasks(Array.isArray(tData) ? tData : []);
      setCategories(Array.isArray(cData) ? cData : []);
    } catch (err) {
      console.error('Error loading task titles and categories:', err);
      toast.error('خطا در دریافت اطلاعات عناوین کاری');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save Task (Create or Edit)
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title.trim()) {
      toast.error('عنوان کاری الزامی است');
      return;
    }
    setIsSavingTask(true);
    try {
      if (editingTask) {
        await fetchJson(`/piecework/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskForm)
        });
        toast.success('عنوان کاری ویرایش شد');
      } else {
        await fetchJson('/piecework/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(taskForm)
        });
        toast.success('عنوان کاری جدید اضافه شد');
      }
      setIsTaskModalOpen(false);
      setEditingTask(null);
      loadData();
    } catch (err) {
      toast.error(err.message || 'خطا در ذخیره عنوان کاری');
    } finally {
      setIsSavingTask(false);
    }
  };

  // Delete Task
  const handleDeleteTask = async (task: PieceworkTask) => {
    if (!(await confirmAction({ title: 'حذف عنوان کاری', message: `آیا از حذف عنوان کاری «${task.title}» اطمینان دارید؟` }))) return;
    try {
      await fetchJson(`/piecework/tasks/${task.id}`, { method: 'DELETE' });
      toast.success('عنوان کاری حذف شد');
      loadData();
    } catch (err) {
      toast.error(err.message || 'خطا در حذف عنوان کاری');
    }
  };

  // Save Category
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) {
      toast.error('نام دسته‌بندی الزامی است');
      return;
    }
    setIsSavingCat(true);
    try {
      if (editingCat) {
        await fetchJson(`/piecework/categories/${editingCat.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: catName, description: catDesc })
        });
        toast.success('دسته‌بندی کاری ویرایش شد');
      } else {
        await fetchJson('/piecework/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: catName, description: catDesc })
        });
        toast.success('دسته‌بندی کاری جدید اضافه شد');
      }
      setIsCatModalOpen(false);
      setEditingCat(null);
      setCatName('');
      setCatDesc('');
      loadData();
    } catch (err) {
      toast.error(err.message || 'خطا در ذخیره دسته‌بندی');
    } finally {
      setIsSavingCat(false);
    }
  };

  // Delete Category
  const handleDeleteCategory = async (cat: TaskCategory) => {
    if (!(await confirmAction({ title: 'حذف دسته‌بندی', message: `آیا از حذف دسته‌بندی «${cat.name}» اطمینان دارید؟` }))) return;
    try {
      await fetchJson(`/piecework/categories/${cat.id}`, { method: 'DELETE' });
      toast.success('دسته‌بندی حذف شد');
      loadData();
    } catch (err) {
      toast.error(err.message || 'خطا در حذف دسته‌بندی');
    }
  };

  const filteredTasks = tasks.filter(t => {
    if (selectedCatFilter !== 'ALL' && t.category !== selectedCatFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || (t.category && t.category.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-farsi text-right">
      {/* HEADER & CATEGORIES MANAGEMENT CARD */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-4">
          <div>
            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
              <FolderPlus size={18} className="text-blue-600" />
              مدیریت دسته‌بندی‌های عناوین کاری
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              تعریف و ویرایش گروه‌بندی‌های اصلی کارهای تولیدی و کارگاهی (قابل استفاده در ثبت کارکرد و کنترل پروژه)
            </p>
          </div>
          <button
            onClick={() => {
              setEditingCat(null);
              setCatName('');
              setCatDesc('');
              setIsCatModalOpen(true);
            }}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto shrink-0 shadow-sm"
          >
            <Plus size={15} /> افزودن دسته‌بندی جدید
          </button>
        </div>

        {/* Categories Chips */}
        <div className="flex flex-wrap gap-2 items-center">
          {categories.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-3 w-full flex items-center justify-between">
              <span>هیچ دسته‌بندی کاری هنوز تعریف نشده است. با کلیک بر روی «افزودن دسته‌بندی جدید» می‌توانید دسته‌بندی‌های مورد نیاز کارگاه خود را از صفر تعریف کنید.</span>
            </div>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                className="group flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium transition-colors"
              >
                <Tag size={13} className="text-slate-500" />
                <span>{cat.name}</span>
                <div className="flex items-center gap-1 border-r border-slate-300 pr-1.5 mr-0.5">
                  <button
                    onClick={() => {
                      setEditingCat(cat);
                      setCatName(cat.name);
                      setCatDesc(cat.description || '');
                      setIsCatModalOpen(true);
                    }}
                    className="p-1 text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                    title="ویرایش نام دسته‌بندی"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(cat)}
                    className="p-1 text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                    title="حذف دسته‌بندی"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* WORK TASKS TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-slate-800 text-sm">عناوین کاری و نرخ‌های پایه کارگاه ({formatPersianNumber(filteredTasks.length)} عنوان)</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Category Filter */}
            <select
              value={selectedCatFilter}
              onChange={(e) => setSelectedCatFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="ALL">همه دسته‌بندی‌ها</option>
              {categories.map((c, idx) => (
                <option key={`task-cat-flt-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="جستجوی کد یا عنوان..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9 pl-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500/50 outline-none w-44 md:w-56"
              />
            </div>

            {/* Add Task Button */}
            <button
              onClick={() => {
                setEditingTask(null);
                setTaskForm({
                  code: '',
                  title: '',
                  category: categories[0]?.name || '',
                  defaultRate: 0,
                  unit: 'عدد',
                  description: ''
                });
                setIsTaskModalOpen(true);
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus size={15} /> افزودن عنوان کاری جدید
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-100/80 text-slate-600 border-b border-slate-200 text-xs">
              <tr>
                <th className="p-3.5 font-bold">#</th>
                <th className="p-3.5 font-bold">کد کار</th>
                <th className="p-3.5 font-bold">عنوان کاری</th>
                <th className="p-3.5 font-bold">دسته‌بندی</th>
                <th className="p-3.5 font-bold text-center">واحد شمارش</th>
                <th className="p-3.5 font-bold text-center">{`نرخ پایه (${curLbl})`}</th>
                <th className="p-3.5 font-bold text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    در حال بارگذاری اطلاعات...
                  </td>
                </tr>
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    هیچ عنوان کاری یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task, idx) => (
                  <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 text-slate-400 font-mono">{idx + 1}</td>
                    <td className="p-3.5 font-mono text-slate-700 font-bold">{task.code}</td>
                    <td className="p-3.5 font-bold text-slate-900">{task.title}</td>
                    <td className="p-3.5">
                      <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold">
                        {task.category || 'سایر'}
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-700">
                      {task.unit === 'ساعت' ? (
                        <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md">ساعت (زمان)</span>
                      ) : (
                        task.unit
                      )}
                    </td>
                    <td className="p-3.5 text-center font-bold font-mono text-blue-700">
                      {formatPersianPrice(task.defaultRate)}
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditingTask(task);
                            setTaskForm({
                              code: task.code,
                              title: task.title,
                              category: task.category || (categories[0]?.name || ''),
                              defaultRate: task.defaultRate,
                              unit: task.unit,
                              description: task.description || ''
                            });
                            setIsTaskModalOpen(true);
                          }}
                          className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors cursor-pointer"
                          title="ویرایش"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task)}
                          className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition-colors cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* TASK MODAL */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 p-6 pb-3">
              <h3 className="font-bold text-slate-800 text-base">
                {editingTask ? 'ویرایش عنوان کاری' : 'افزودن عنوان کاری جدید'}
              </h3>
              <button
                onClick={() => setIsTaskModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 pb-6"><form onSubmit={handleSaveTask} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">کد عنوان کاری</label>
                  <input
                    type="text"
                    placeholder="مثلا PW-001 (اختیاری)"
                    value={taskForm.code}
                    onChange={(e) => setTaskForm({ ...taskForm, code: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">دسته‌بندی</label>
                  <select
                    value={taskForm.category}
                    onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none"
                  >
                    {categories.length === 0 ? (
                      <option value="">بدون دسته‌بندی</option>
                    ) : (
                      <>
                        {!categories.some(c => c.name === taskForm.category) && taskForm.category && (
                          <option value={taskForm.category}>{taskForm.category}</option>
                        )}
                        {categories.map((c, idx) => (
                          <option key={`task-cat-form-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">عنوان کامل کار *</label>
                <input
                  type="text"
                  required
                  placeholder="مثلا: ساخت کاشی 20*20"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">واحد شمارش *</label>
                  <select
                    value={taskForm.unit}
                    onChange={(e) => setTaskForm({ ...taskForm, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none font-bold text-blue-800"
                  >
                    <option value="عدد">عدد</option>
                    <option value="ساعت">ساعت (زمانی HH:MM)</option>
                    <option value="متر">متر</option>
                    <option value="مترمربع">مترمربع</option>
                    <option value="کادر">کادر</option>
                    <option value="کیلوگرم">کیلوگرم</option>
                    <option value="ست">ست</option>
                    <option value="دسته">دسته</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">نرخ پایه (ریال) *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={taskForm.defaultRate === 0 ? '' : taskForm.defaultRate}
                    onChange={(e) => setTaskForm({ ...taskForm, defaultRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">توضیحات (اختیاری)</label>
                <textarea
                  rows={2}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTaskModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-bold transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingTask}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSavingTask ? 'در حال ذخیره...' : 'ثبت عنوان کاری'}
                </button>
              </div>
              </form></div>
          </div>
        </div>
      )}

      {/* CATEGORY MODAL */}
      {isCatModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 p-6 pb-3">
              <h3 className="font-bold text-slate-800 text-base">
                {editingCat ? 'ویرایش دسته‌بندی کاری' : 'تعریف دسته‌بندی کاری جدید'}
              </h3>
              <button
                onClick={() => setIsCatModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 pb-6">
            <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">نام دسته‌بندی *</label>
                <input
                  type="text"
                  required
                  placeholder="مثلا: بسته‌بندی، روتوش، کاشی..."
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">توضیحات (اختیاری)</label>
                <input
                  type="text"
                  placeholder="توضیحات کوتاه درباره این دسته‌بندی"
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCatModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-bold transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingCat}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSavingCat ? 'در حال ذخیره...' : 'ثبت دسته‌بندی'}
                </button>
              </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
