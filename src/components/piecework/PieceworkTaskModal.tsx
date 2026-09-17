import React, { FormEvent, useState, useEffect } from 'react';
import { X, Award } from 'lucide-react';
import { PieceworkTask } from '../../types';
import { TaskFormData } from '../../hooks/usePiecework';
import { formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { fetchJson } from '../../api';

interface PieceworkTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  editingTask: PieceworkTask | null;
  taskFormData: TaskFormData;
  setTaskFormData: React.Dispatch<React.SetStateAction<TaskFormData>>;
  isSaving?: boolean;
  categories?: { id: number | string; name: string; description?: string }[] | string[];
}

const MEASUREMENT_UNITS = ['عدد', 'جفت', 'ساعت', 'درصدی', 'سایر'] as const;

export function PieceworkTaskModal({
  isOpen,
  onClose,
  onSubmit,
  editingTask,
  taskFormData,
  setTaskFormData,
  isSaving = false,
  categories: propCategories = []
}: PieceworkTaskModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const [categories, setCategories] = useState<{ id: number | string; name: string }[]>([]);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);

  // Load task categories directly from system settings task categories management
  useEffect(() => {
    if (!isOpen) return;

    if (Array.isArray(propCategories) && propCategories.length > 0) {
      setCategories(
        propCategories.map(c => typeof c === 'string' ? { id: c, name: c } : { id: c.id, name: c.name })
      );
    }

    let isMounted = true;
    setLoadingCategories(true);
    fetchJson<any[]>('/piecework/categories')
      .then((res) => {
        if (!isMounted) return;
        if (Array.isArray(res)) {
          const list = res.map(c => typeof c === 'string' ? { id: c, name: c } : { id: c.id, name: c.name });
          setCategories(list);
          if (!taskFormData.category && list.length > 0) {
            setTaskFormData(prev => ({ ...prev, category: list[0].name }));
          }
        }
      })
      .catch((err) => {
        console.error('Failed to fetch task categories in modal:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingCategories(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[85vh] flex flex-col">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Award className="w-4 h-4 text-blue-600" />
            <span>{editingTask ? 'ویرایش عنوان کاری پرکیسی' : 'افزودن عنوان کاری پرکیسی جدید'}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-full cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">عنوان کاری *</label>
            <input
              type="text"
              required
              placeholder="مثلاً کاشی گردنبند بزرگ"
              value={taskFormData.title}
              onChange={(e) => setTaskFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                <span>دسته‌بندی کاری</span>
                {loadingCategories && <span className="text-[10px] text-blue-500 font-normal">در حال دریافت...</span>}
              </label>
              <select
                value={taskFormData.category}
                onChange={(e) => setTaskFormData(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
              >
                {categories.length === 0 ? (
                  <option value="">بدون دسته‌بندی (تعریف در تنظیمات سامانه)</option>
                ) : (
                  <>
                    {!categories.some(c => c.name === taskFormData.category) && taskFormData.category && (
                      <option value={taskFormData.category}>{taskFormData.category}</option>
                    )}
                    {categories.map((c, idx) => (
                      <option key={`task-modal-cat-${c.id || idx}-${idx}`} value={c.name}>{c.name}</option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">واحد اندازه‌گیری *</label>
              <select
                value={taskFormData.unit || 'عدد'}
                onChange={(e) => setTaskFormData(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 font-medium"
              >
                {!MEASUREMENT_UNITS.includes(taskFormData.unit as any) && taskFormData.unit && (
                  <option value={taskFormData.unit}>{taskFormData.unit}</option>
                )}
                {MEASUREMENT_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{`نرخ پایه پیش‌فرض (${curLbl})`}</label>
            <input
              type="number"
              min="0"
              step="any"
              value={taskFormData.defaultRate === 0 ? '' : taskFormData.defaultRate}
              onChange={(e) => setTaskFormData(prev => ({ ...prev, defaultRate: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 font-mono outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 cursor-pointer disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>در حال ذخیره...</span>
                </>
              ) : (
                <span>ذخیره عنوان کاری</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
