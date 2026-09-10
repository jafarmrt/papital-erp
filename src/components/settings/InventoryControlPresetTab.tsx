import React from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { Plus, Trash2, Save, RefreshCw, ShoppingBag, HelpCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS, InventoryControlPresetSection } from '../../constants/inventoryControlPresets';
import toast from 'react-hot-toast';

interface InventoryControlPresetTabProps {
  sections: InventoryControlPresetSection[];
  setSections: React.Dispatch<React.SetStateAction<InventoryControlPresetSection[]>>;
  isSaving: boolean;
  onSave: () => void;
}

export function InventoryControlPresetTab({
  sections,
  setSections,
  isSaving,
  onSave
}: InventoryControlPresetTabProps) {
  const safeSections = Array.isArray(sections) ? sections : [];

  const handleAddSection = () => {
    const newSec: InventoryControlPresetSection = {
      id: `sec_${Date.now()}`,
      title: `${safeSections.length + 1}. بخش جدید کنترل موجودی`,
      description: 'توضیحات مربوط به این مرحله از کنترل مواد اولیه',
      checkType: 'per_item',
      filterType: 'all',
      allowedCategories: [],
      allowedItemCodes: [],
      items: []
    };
    setSections([...safeSections, newSec]);
    toast.success('بخش جدید به الگوی کنترل موجودی افزوده شد');
  };

  const handleUpdateSection = (index: number, field: keyof InventoryControlPresetSection, value: any) => {
    const updated = [...safeSections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  };

  const handleRemoveSection = (index: number) => {
    if (safeSections.length <= 1) {
      toast.error('حداقل یک بخش کنترل موجودی باید در سامانه وجود داشته باشد');
      return;
    }
    setSections(safeSections.filter((_, i) => i !== index));
    toast.success('بخش با موفقیت حذف شد');
  };

  const handleMoveSection = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === safeSections.length - 1)) return;
    const updated = [...safeSections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setSections(updated);
  };

  const handleResetToDefaults = async () => {
    if (await confirmAction({ title: 'بازنشانی الگوها', message: 'آیا از بازنشانی الگوهای کنترل موجودی به ۴ بخش پیش‌فرض سیستم اطمینان دارید؟' })) {
      setSections(DEFAULT_INVENTORY_CONTROL_SECTIONS);
      toast.success('الگوهای کنترل موجودی با موفقیت بازنشانی شدند');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-6 max-w-5xl mx-auto space-y-6 font-farsi text-right">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-amber-500" />
            الگوهای کنترل موجودی و لیست خرید مواد اولیه
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            تعریف سرفصل‌های مراحل کنترل موجودی کارگاه و مشخص‌کردن نوع بررسی (کد به کد یا کلی برای پروژه)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            بازنشانی به ۴ بخش پیش‌فرض
          </button>
          <button
            type="button"
            onClick={handleAddSection}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            افزودن بخش جدید
          </button>
        </div>
      </div>

      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-900 leading-relaxed">
        <HelpCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong className="block font-bold mb-0.5">راهنمای ساختار الگوی کنترل موجودی:</strong>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-800">
            <li><strong>کنترل کد به کد (per_item):</strong> برای مراحلی مانند موجودی کاغذ ترنسفر، کاشی خام، یا قاب که برای هر محصول به صورت اختصاصی با یک یا چند ماده اولیه کنترل می‌شود.</li>
            <li><strong>کنترل کلی سفارش (global):</strong> برای اقلام مصرفی کلی مانند کیلر، گلیز، کارتن و بسته‌بندی که به‌صورت تجمیعی برای کل پروژه کنترل می‌شوند.</li>
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        {safeSections.map((sec, secIdx) => (
          <div key={sec.id || secIdx} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 flex-1">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0">
                  {secIdx + 1}
                </span>
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => handleUpdateSection(secIdx, 'title', e.target.value)}
                  placeholder="عنوان بخش کنترل موجودی..."
                  className="font-bold text-slate-800 text-sm bg-white px-3 py-1.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none flex-1"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={sec.checkType}
                  onChange={(e) => handleUpdateSection(secIdx, 'checkType', e.target.value as any)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer ${
                    sec.checkType === 'per_item' 
                      ? 'bg-blue-50 text-blue-800 border-blue-300' 
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  }`}
                >
                  <option value="per_item">کنترل کد به کد (به تفکیک محصول)</option>
                  <option value="global">کنترل کلی برای کل سفارش</option>
                </select>

                <div className="flex items-center gap-1 border-r border-slate-200 pr-2 mr-1">
                  <button
                    type="button"
                    onClick={() => handleMoveSection(secIdx, 'up')}
                    disabled={secIdx === 0}
                    className="p-1 hover:bg-slate-200 rounded-lg disabled:opacity-30 text-slate-600 cursor-pointer"
                    title="انتقال به بالا"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveSection(secIdx, 'down')}
                    disabled={secIdx === safeSections.length - 1}
                    className="p-1 hover:bg-slate-200 rounded-lg disabled:opacity-30 text-slate-600 cursor-pointer"
                    title="انتقال به پایین"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveSection(secIdx)}
                    className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    title="حذف بخش"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">توضیحات و راهنمای این بخش:</label>
              <input
                type="text"
                value={sec.description || ''}
                onChange={(e) => handleUpdateSection(secIdx, 'description', e.target.value)}
                placeholder="توضیحات کوتاه جهت راهنمایی سرپرست کارگاه..."
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-200 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl flex items-center gap-2 transition-all shadow-sm disabled:opacity-50"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          ذخیره تنظیمات کنترل موجودی
        </button>
      </div>
    </div>
  );
}
