import React from 'react';
import { 
  Database, X, Search, Plus, Filter, AlertCircle, Info, ArrowRight 
} from 'lucide-react';
import { Item, Category, ProjectInventoryControlSectionData } from '../../types';
import { formatPersianNumber, toPersianDigits } from '../../utils';
import { COMMON_UNITS } from './projectInventoryUtils';
import { rawMaterialCategories } from '../../lib/pendingMaterials/materialRequestRules';
import { MaterialNameField, MaterialUnitSelect, MaterialNumberField, MaterialAttributeFields } from './materialFormFields';
import { useHasPermission } from '../../contexts/AuthContext';
import type { CustomMaterialForm } from '../../lib/pendingMaterials/customMaterialRequest';

interface AddMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  changingItemTarget: { secIdx: number; itemId: string; prodId?: string; gIdx?: number } | null;
  materialModalTab: 'warehouse' | 'custom';
  setMaterialModalTab: (tab: 'warehouse' | 'custom') => void;
  warehouseItems: Item[];
  filteredWarehouseItems: Item[];
  warehouseSearchQuery: string;
  setWarehouseSearchQuery: (query: string) => void;
  currentModalSection: ProjectInventoryControlSectionData | undefined;
  handleSelectWarehouseItem: (whItem: Item) => void;
  customMaterialForm: CustomMaterialForm;
  setCustomMaterialForm: React.Dispatch<React.SetStateAction<CustomMaterialForm>>;
  allCategories: Category[];
  codePrefix: string;
  handleCategoryChangeForCustom: (catName: string) => Promise<void>;
  handleAddCustomMaterial: (e: React.FormEvent) => Promise<void>;
}

export function AddMaterialModal({
  isOpen,
  onClose,
  changingItemTarget,
  materialModalTab,
  setMaterialModalTab,
  warehouseItems,
  filteredWarehouseItems,
  warehouseSearchQuery,
  setWarehouseSearchQuery,
  currentModalSection,
  handleSelectWarehouseItem,
  customMaterialForm,
  setCustomMaterialForm,
  allCategories,
  codePrefix,
  handleCategoryChangeForCustom,
  handleAddCustomMaterial
}: AddMaterialModalProps) {
  // v9.0.398 (TD-826): a new material is only a request to the warehouse queue, offered by the key its route asks
  const canRequestMaterial = useHasPermission('pending_materials.create');
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-farsi">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-sm">
              {changingItemTarget ? 'اتصال و لینک ردیف به کالای انبار' : 'افزودن ماده اولیه به کنترل موجودی'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 p-2 gap-2">
          <button
            type="button"
            onClick={() => setMaterialModalTab('warehouse')}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all flex-1 justify-center cursor-pointer ${
              materialModalTab === 'warehouse'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Search className="w-4 h-4" />
            انتخاب از انبار ({toPersianDigits(filteredWarehouseItems.length)} ماده اولیه موجود)
          </button>

          {canRequestMaterial && <button
            type="button"
            onClick={() => setMaterialModalTab('custom')}
            className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all flex-1 justify-center cursor-pointer ${
              materialModalTab === 'custom'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Plus className="w-4 h-4" />
            درخواست ماده اولیه جدید
          </button>}
        </div>

        {/* Modal Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {materialModalTab === 'warehouse' || !canRequestMaterial ? (
            <div className="space-y-4">
              {/* Filter Restriction Alert if Active */}
              {currentModalSection && currentModalSection.filterType && currentModalSection.filterType !== 'all' && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold">
                    <Filter className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {currentModalSection.filterType === 'category'
                        ? `فیلتر فعال: نمایش دسته‌بندی‌های (${(currentModalSection.allowedCategories || []).join(', ') || 'هیچ کدام'})`
                        : `فیلتر فعال: نمایش کدهای مجاز (${(currentModalSection.allowedItemCodes || []).join(', ') || 'هیچ کدام'})`}
                    </span>
                  </div>
                  <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md font-mono font-bold">
                    محدود شده به بخش
                  </span>
                </div>
              )}

              {/* Search Input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  value={warehouseSearchQuery}
                  onChange={(e) => setWarehouseSearchQuery(e.target.value)}
                  placeholder="جستجوی نام، کد کالا یا دسته‌بندی در انبار..."
                  className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {filteredWarehouseItems.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 space-y-2">
                  <AlertCircle className="w-6 h-6 text-slate-400 mx-auto" />
                  <p>هیچ کالایی با مشخصات وارد شده در انبار پیدا نشد.</p>
                  <button
                    type="button"
                    onClick={() => setMaterialModalTab('custom')}
                    className="text-amber-600 font-bold hover:underline text-xs cursor-pointer"
                  >
                    می‌توانید کالا را به عنوان ماده اولیه جدید ثبت نمایید
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {filteredWarehouseItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectWarehouseItem(item)}
                      className="p-3 flex items-center justify-between hover:bg-amber-50/60 cursor-pointer transition-colors group"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 group-hover:text-amber-900 flex items-center gap-2">
                          <span>{item.name}</span>
                          {item.code && <span className="font-mono text-[11px] text-slate-500">({item.code})</span>}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          دسته‌بندی: {item.category || 'عمومی'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-left font-mono">
                          <span className="font-bold text-slate-800 text-xs">{formatPersianNumber(item.current_stock)}</span>
                          <span className="text-[11px] text-slate-500 mr-1">{item.unit || 'عدد'}</span>
                          <div className="text-[10px] text-emerald-600 font-bold">موجودی انبار</div>
                        </div>
                        <span className="px-3 py-1.5 bg-amber-500 text-slate-950 font-bold rounded-lg text-xs group-hover:bg-amber-600 transition-colors flex items-center gap-1">
                          انتخاب
                          <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Custom Material Form */
            <form onSubmit={handleAddCustomMaterial} className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  این درخواست به صف «مواد اولیه در انتظار تأیید» می‌رود و کالا فقط با تأیید انباردار ساخته می‌شود. موجودی تنها با رسید خرید وارد انبار می‌شود.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">دسته‌بندی ماده اولیه *</label>
                  <select
                    required
                    value={customMaterialForm.category}
                    onChange={(e) => handleCategoryChangeForCustom(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  >
                    <option value="">- انتخاب دسته‌بندی -</option>
                    {rawMaterialCategories(allCategories).map(c => (
                      <option key={c.id} value={c.name}>{c.name} {c.prefix ? `(${c.prefix}XXX)` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 text-xs">کد کالا در انبار (خودکار / پیش‌فرض)</label>
                  <div className="flex w-full rounded-xl border border-slate-300 overflow-hidden bg-slate-50">
                    {codePrefix && (
                      <span className="inline-flex items-center px-3 border-l bg-slate-200 text-slate-700 font-mono text-xs font-bold">
                        {codePrefix}
                      </span>
                    )}
                    <input
                      type="text"
                      value={customMaterialForm.itemCode}
                      onChange={(e) => setCustomMaterialForm({ ...customMaterialForm, itemCode: e.target.value })}
                      placeholder={codePrefix ? "تولید شده" : "کد اختصاصی..."}
                      className="flex-1 px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none bg-transparent"
                    />
                  </div>
                </div>

                <MaterialNameField
                  label="عنوان ماده اولیه *"
                  value={customMaterialForm.name}
                  onChange={(v) => setCustomMaterialForm({ ...customMaterialForm, name: v })}
                  placeholder="مثلاً: کاغذ ترنسفر سفارشی ۷۰x۱۰۰"
                />
                <MaterialUnitSelect value={customMaterialForm.unit} onChange={(v) => setCustomMaterialForm({ ...customMaterialForm, unit: v })} units={COMMON_UNITS} />
                <MaterialNumberField label="نقطه سفارش" value={customMaterialForm.reorderPoint} onChange={(v) => setCustomMaterialForm({ ...customMaterialForm, reorderPoint: v })} />
                <MaterialNumberField label="قیمت تخمینی / هزینه واحد" value={customMaterialForm.weightedAverageCost} onChange={(v) => setCustomMaterialForm({ ...customMaterialForm, weightedAverageCost: v })} />
                <MaterialAttributeFields
                  color={customMaterialForm.color}
                  material={customMaterialForm.material}
                  size={customMaterialForm.size}
                  onChange={(field, v) => setCustomMaterialForm({ ...customMaterialForm, [field]: v })}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  ارسال درخواست به انباردار
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
