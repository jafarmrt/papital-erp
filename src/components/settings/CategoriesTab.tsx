import React from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { FolderTree, Plus, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { Category } from '../../types';
import { cn } from '../../utils';

interface CategoriesTabProps {
  categories: Category[];
  onOpenCreateModal: () => void;
  onOpenEditModal: (cat: Category) => void;
  onDeleteCategory: (id: number) => void;
  onResetDefaults?: () => void;
}

export function CategoriesTab({
  categories,
  onOpenCreateModal,
  onOpenEditModal,
  onDeleteCategory,
  onResetDefaults
}: CategoriesTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col min-h-[400px] max-w-4xl mx-auto text-right font-farsi">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
        <h3 className="font-bold border-0 p-0 m-0 text-slate-800 text-sm">📂 دسته‌بندی کالاها / مواد اولیه</h3>
        <div className="flex items-center gap-2">
          {onResetDefaults && (
            <button
              type="button"
              onClick={async () => {
                if (await confirmAction({ title: 'بازنشانی دسته‌بندی‌ها', message: 'آیا از بازنشانی و همگام‌سازی دسته‌بندی‌های استاندارد پیش‌فرض اطمینان دارید؟' })) {
                  onResetDefaults();
                }
              }}
              className="px-3 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 border border-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
              title="همگام‌سازی و بازنشانی دسته‌بندی‌های استاندارد"
            >
              <RotateCcw size={13} className="text-slate-500" /> بازنشانی به پیش‌فرض
            </button>
          )}
          <button
            onClick={onOpenCreateModal}
            className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Plus size={14} /> دسته‌بندی جدید
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {categories.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <FolderTree size={40} className="mx-auto text-slate-300" />
            <p className="font-bold text-sm">هیچ دسته‌بندی ثبت نشده است.</p>
            <p className="text-xs text-slate-400">
              با کلیک روی دکمه «دسته‌بندی جدید» می‌توانید دسته‌بندی‌های جدید ایجاد کنید.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs">
              <tr>
                <th className="p-3 font-medium">نام دسته‌بندی</th>
                <th className="p-3 font-medium">پیشوند کد</th>
                <th className="p-3 font-medium">نوع کالا</th>
                <th className="p-3 font-medium">واحد پیش‌فرض</th>
                <th className="p-3 font-medium text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {categories.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-800">{c.name}</td>
                  <td className="p-3 font-mono text-slate-500 text-left" dir="ltr">
                    {c.prefix}
                  </td>
                  <td className="p-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-bold',
                        c.type === 'product' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'
                      )}
                    >
                      {c.type === 'product' ? 'محصول نهایی' : 'ماده اولیه'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">{c.defaultUnit || c.default_unit || 'عدد'}</td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => onOpenEditModal(c)}
                        className="text-blue-500 hover:text-blue-700 bg-blue-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        title="ویرایش"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => onDeleteCategory(c.id)}
                        className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditing?: boolean;
  catForm: { name: string; prefix: string; type: string; defaultUnit: string };
  setCatForm: React.Dispatch<
    React.SetStateAction<{ name: string; prefix: string; type: string; defaultUnit: string }>
  >;
  isSaving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export function CategoryModal({
  isOpen,
  onClose,
  isEditing,
  catForm,
  setCatForm,
  isSaving,
  onSubmit
}: CategoryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-bold text-base text-slate-800">
            {isEditing ? 'ویرایش دسته‌بندی' : 'ثبت دسته‌بندی جدید'}
          </h3>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4 text-xs overflow-y-auto">
          <div>
            <label className="block font-medium mb-1 text-slate-700">نام دسته‌بندی</label>
            <input
              required
              type="text"
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block font-medium mb-1 text-slate-700">پیشوند کد (انگلیسی)</label>
            <input
              required
              type="text"
              value={catForm.prefix}
              onChange={(e) => setCatForm({ ...catForm, prefix: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-left focus:ring-1 focus:ring-blue-500 outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block font-medium mb-1 text-slate-700">واحد اندازه‌گیری پیش‌فرض</label>
            <input
              required
              type="text"
              value={catForm.defaultUnit || ''}
              onChange={(e) => setCatForm({ ...catForm, defaultUnit: e.target.value })}
              placeholder="مثال: عدد، کیلوگرم، متر"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block font-medium mb-1 text-slate-700">نوع کالا</label>
            <select
              value={catForm.type}
              onChange={(e) => setCatForm({ ...catForm, type: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="raw_material">مواد اولیه</option>
              <option value="product">محصول نهایی</option>
            </select>
          </div>
          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-bold cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
