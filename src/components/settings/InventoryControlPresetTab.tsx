import React, { useState, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { Plus, Trash2, Save, RefreshCw, ShoppingBag, Layers, AlertCircle, HelpCircle, ArrowUp, ArrowDown, Filter, CheckSquare, Square, Tag, Key } from 'lucide-react';
import { DEFAULT_INVENTORY_CONTROL_SECTIONS, InventoryControlPresetSection, InventoryControlPresetItem } from '../../constants/inventoryControlPresets';
import { Category } from '../../types';
import { fetchJson } from '../../api';
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

  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/categories', { signal: controller.signal })
      .then((data: any) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load categories for inventory control presets:', err);
        toast.error('خطا در دریافت دسته‌بندی‌های کالا');
      });

    return () => controller.abort();
  }, []);

  const safeSections = Array.isArray(sections) ? sections : [];

  const handleAddSection = () => {
    const newSec: InventoryControlPresetSection = {
      id: `sec_${Date.now()}`,
      title: `${safeSections.length + 1}. بخش جدید کنترل موجودی`,
      description: 'توضیحات مربوط به این مرحله از کنترل مواد اولیه',
      checkType: 'global',
      filterType: 'all',
      allowedCategories: [],
      allowedItemCodes: [],
      items: [
        { id: `item_${Date.now()}`, name: 'ماده اولیه جدید', unit: 'عدد' }
      ]
    };
    setSections([...safeSections, newSec]);
    toast.success('بخش جدید به الگوی کنترل موجودی افزوده شد');
  };

  const handleUpdateSection = (index: number, field: keyof InventoryControlPresetSection, value: any) => {
    const updated = [...safeSections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  };

  const handleToggleCategory = (secIndex: number, catName: string) => {
    const updated = [...safeSections];
    const sec = { ...updated[secIndex] };
    const currentCats = Array.isArray(sec.allowedCategories) ? [...sec.allowedCategories] : [];
    if (currentCats.includes(catName)) {
      sec.allowedCategories = currentCats.filter(c => c !== catName);
    } else {
      sec.allowedCategories = [...currentCats, catName];
    }
    updated[secIndex] = sec;
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

  const handleAddItemToSection = (secIndex: number) => {
    const updated = [...safeSections];
    const targetSec = { ...updated[secIndex] };
    const safeItems = Array.isArray(targetSec.items) ? targetSec.items : [];
    const newItems: InventoryControlPresetItem[] = [
      ...safeItems,
      { id: `item_${Date.now()}`, name: '', unit: 'عدد' }
    ];
    targetSec.items = newItems;
    updated[secIndex] = targetSec;
    setSections(updated);
  };

  const handleUpdateSectionItem = (secIndex: number, itemIndex: number, field: keyof InventoryControlPresetItem, value: any) => {
    const updated = [...safeSections];
    const targetSec = { ...updated[secIndex] };
    const safeItems = Array.isArray(targetSec.items) ? targetSec.items : [];
    const items = [...safeItems];
    items[itemIndex] = { ...items[itemIndex], [field]: value };
    targetSec.items = items;
    updated[secIndex] = targetSec;
    setSections(updated);
  };

  const handleRemoveSectionItem = (secIndex: number, itemIndex: number) => {
    const updated = [...safeSections];
    const targetSec = { ...updated[secIndex] };
    const safeItems = Array.isArray(targetSec.items) ? targetSec.items : [];
    if (safeItems.length <= 1) {
      toast.error('هر بخش باید حداقل دارای یک آیتم ماده اولیه باشد');
      return;
    }
    targetSec.items = safeItems.filter((_, i) => i !== itemIndex);
    updated[secIndex] = targetSec;
    setSections(updated);
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
            تعریف بخش‌ها، نوع کنترل (کد به کد یا کلی برای سفارش) و کالاها/مواد اولیه پیش‌فرض در پروژه
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
            <li><strong>کنترل کد به کد (per_item):</strong> برای موادی مانند کاغذ ترنسفر یا کاشی خام که باید برای تک‌تک کدهای محصول در سفارش چک شوند. در صورت کسری، در لیست خرید صریحاً درج می‌شود: «کد [کد محصول] نیاز به تامین ترنسفر دارد».</li>
            <li><strong>کنترل کلی سفارش (global):</strong> برای موادی مانند کیلر، گلیز، سمباده، چسب و بسته‌بندی که به‌صورت تجمیعی برای کل پروژه چک می‌شوند و نیازی به تفکیک کد ندارند.</li>
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        {safeSections.map((sec, secIdx) => (
          <div key={sec.id || secIdx} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/70 space-y-4">
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
                  <option value="per_item">کنترل کد به کد (تک‌تک کالاها)</option>
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

            {/* Material Access Control & Filtering Configuration */}
            <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Filter className="w-4 h-4 text-amber-600" />
                  <span>کنترل دسترسی و فیلتر اقلام انبار برای این بخش:</span>
                </div>

                <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => handleUpdateSection(secIdx, 'filterType', 'all')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      (sec.filterType || 'all') === 'all'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    نمایش همه اقلام انبار
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateSection(secIdx, 'filterType', 'category')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      sec.filterType === 'category'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    فیلتر بر اساس دسته‌بندی
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateSection(secIdx, 'filterType', 'item_code')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      sec.filterType === 'item_code'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    فیلتر کد به کد (کدهای مجاز)
                  </button>
                </div>
              </div>

              {/* Category-based Filtering */}
              {sec.filterType === 'category' && (
                <div className="bg-white p-3 rounded-lg border border-amber-200 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-amber-600" />
                    دسته‌بندی‌های مجاز برای انتخاب مواد اولیه در این بخش را علامت بزنید:
                  </div>
                  {categories.length === 0 ? (
                    <div className="text-[11px] text-slate-400">دسته‌بندی‌ای یافت نشد</div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {categories.map(c => {
                        const isSelected = (sec.allowedCategories || []).includes(c.name);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleToggleCategory(secIdx, c.name)}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-2xs'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5 text-amber-600" />
                            ) : (
                              <Square className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            <span>{c.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Item Code-based Filtering */}
              {sec.filterType === 'item_code' && (
                <div className="bg-white p-3 rounded-lg border border-amber-200 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-amber-600" />
                    کدهای مجاز ماده اولیه در انبار (با کاما یا خط بعدی جدا کنید):
                  </div>
                  <input
                    type="text"
                    value={Array.isArray(sec.allowedItemCodes) ? sec.allowedItemCodes.join(', ') : (sec.allowedItemCodes || '')}
                    onChange={(e) => {
                      const codes = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      handleUpdateSection(secIdx, 'allowedItemCodes', codes);
                    }}
                    placeholder="مثال: RAW-01, RAW-02, RAW-TRANS-10"
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="text-[10px] text-slate-500">
                    در فرم انتخاب کالا از انبار، کاربران تنها به این کدهای تعریف شده دسترسی خواهند داشت.
                  </p>
                </div>
              )}
            </div>

            {/* Section Items */}
            <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between pb-1">
                <span className="font-bold text-slate-700 text-xs">مواد اولیه / کالاهای پیش‌فرض این بخش:</span>
                <button
                  type="button"
                  onClick={() => handleAddItemToSection(secIdx)}
                  className="px-2.5 py-1 bg-amber-50 text-amber-800 hover:bg-amber-100 font-bold text-[11px] rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  افزودن ماده اولیه
                </button>
              </div>

              <div className="space-y-2">
                {(sec.items || []).map((item, itemIdx) => (
                  <div key={item.id || itemIdx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-400 w-5 text-center shrink-0">#{itemIdx + 1}</span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => handleUpdateSectionItem(secIdx, itemIdx, 'name', e.target.value)}
                      placeholder="عنوان ماده اولیه (مثال: کیلر / کاغذ ترنسفر)"
                      className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-xs focus:ring-1 focus:ring-amber-500"
                    />
                    <div className="w-28 shrink-0">
                      <input
                        type="text"
                        value={item.unit}
                        onChange={(e) => handleUpdateSectionItem(secIdx, itemIdx, 'unit', e.target.value)}
                        placeholder="واحد (کیلو/ورق)"
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-center font-semibold text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSectionItem(secIdx, itemIdx)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg shrink-0 transition-colors"
                      title="حذف آیتم"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
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
