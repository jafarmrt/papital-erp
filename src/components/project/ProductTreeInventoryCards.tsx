import React, { useState } from 'react';
import { 
  Package, Layers, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, 
  Search, Scale, Trash2, ShieldCheck, ShoppingCart, Sparkles, ExternalLink, ArrowRight
} from 'lucide-react';
import { 
  ProjectProductItem, 
  ProjectInventoryControlSectionData, 
  Item 
} from '../../types';
import { COMMON_UNITS, roundToOneDecimal } from './projectInventoryUtils';

interface ProductTreeInventoryCardsProps {
  products: ProjectProductItem[];
  sections: ProjectInventoryControlSectionData[];
  warehouseItems: Item[];
  activeStepTab: number;
  handleUpdatePerItemResult: (secIdx: number, prodId: string, itemId: string, field: string, value: any) => void;
  handleOpenChangeMaterialModal: (secIdx: number, itemId: string, prodId?: string, gIdx?: number) => void;
  handleOpenUnitConversionModal: (
    secIdx: number,
    itemId: string,
    prodId: string | undefined,
    gIdx: number | undefined,
    itemName: string,
    itemCode: string | undefined,
    originalQty: number,
    originalUnit: string,
    warehouseUnit: string,
    convertedUnit?: string,
    conversionRate?: number,
    convertedQty?: number
  ) => void;
  handleRemoveItemFromSection: (secIdx: number, itemId: string, itemIdx?: number) => void;
  onJumpToSection?: (secIdx: number) => void;
}

export function ProductTreeInventoryCards({
  products,
  sections,
  warehouseItems,
  activeStepTab,
  handleUpdatePerItemResult,
  handleOpenChangeMaterialModal,
  handleOpenUnitConversionModal,
  handleRemoveItemFromSection,
  onJumpToSection
}: ProductTreeInventoryCardsProps) {
  // Keep track of which product cards are expanded
  const [expandedProductIds, setExpandedProductIds] = useState<Record<string, boolean>>(() => {
    // By default, open the first 2 products for quick visibility
    const initial: Record<string, boolean> = {};
    products.slice(0, 3).forEach(p => {
      initial[p.id] = true;
    });
    return initial;
  });

  // Filter state for product search or shortage only
  const [filterShortageOnly, setFilterShortageOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  if (!products || products.length === 0) return null;

  const toggleExpand = (id: string) => {
    setExpandedProductIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    products.forEach(p => { all[p.id] = true; });
    setExpandedProductIds(all);
  };

  const collapseAll = () => {
    setExpandedProductIds({});
  };

  // Find all sections that are per_item
  const perItemSections = sections
    .map((sec, idx) => ({ sec, originalIdx: idx }))
    .filter(({ sec }) => sec.checkType === 'per_item');

  return (
    <div className="space-y-4 print:hidden">
      {/* Action Bar for Product Tree view */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجو در نام یا کد محصول..."
              className="pr-8 pl-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs w-48 sm:w-64 focus:ring-2 focus:ring-amber-400 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setFilterShortageOnly(prev => !prev)}
            className={`px-3 py-1.5 rounded-xl font-bold transition-colors flex items-center gap-1.5 cursor-pointer border ${
              filterShortageOnly 
                ? 'bg-rose-500 text-white border-rose-600 shadow-xs' 
                : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300'
            }`}
          >
            <AlertCircle className={`w-3.5 h-3.5 ${filterShortageOnly ? 'text-white' : 'text-rose-500'}`} />
            <span>فقط اقلام دارای کسری خرید</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={expandAll}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-300 transition-colors"
          >
            باز کردن همه
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-300 transition-colors"
          >
            بستن همه
          </button>
        </div>
      </div>

      {/* Product Cards List */}
      <div className="space-y-3">
        {products
          .filter(prod => {
            if (searchQuery.trim()) {
              const q = searchQuery.toLowerCase();
              const matchName = (prod.item_name || '').toLowerCase().includes(q);
              const matchCode = (prod.item_code || '').toLowerCase().includes(q);
              if (!matchName && !matchCode) return false;
            }
            return true;
          })
          .map((prod, pIdx) => {
            const isExpanded = !!expandedProductIds[prod.id];

            // Collect all materials required for this product across all per_item sections
            const productMaterials: Array<{
              secIdx: number;
              sectionTitle: string;
              itemSchema: { id: string; name: string; unit?: string; itemCode?: string };
              itemRes: any;
              matchWh: Item | undefined;
              currentStock: number;
              effectiveWarehouseUnit: string;
              reqUnit: string;
              reqQty: number;
              shortfall: number;
              isNeedsProcurement: boolean;
              hasUnitMismatch: boolean;
            }> = [];

            let prodTotalNeeds = 0;
            let prodShortfallCount = 0;

            perItemSections.forEach(({ sec, originalIdx }) => {
              const prodRes = sec.perItemResults?.[prod.id] || {};
              const itemsSchema = sec.itemsSchema || [{ id: 'item_default', name: 'ماده اولیه', unit: 'عدد' }];

              itemsSchema.forEach(itemSchema => {
                prodTotalNeeds++;
                const itemRes = prodRes[itemSchema.id] || {
                  itemId: itemSchema.id,
                  name: itemSchema.name,
                  itemCode: itemSchema.itemCode,
                  unit: itemSchema.unit || 'عدد',
                  status: 'available',
                  requiredQty: prod.quantity || 100,
                  stockQty: 0
                };

                const effectiveCode = itemRes.itemCode || itemSchema.itemCode || '';
                const effectiveName = itemRes.name || itemSchema.name;

                const matchWh = warehouseItems.find(i => 
                  (effectiveCode && i.code === effectiveCode) ||
                  (i.name.toLowerCase() === effectiveName.toLowerCase())
                );

                const currentStock = matchWh ? matchWh.current_stock : (itemRes.stockQty ?? 0);
                const effectiveWarehouseUnit = matchWh?.unit || itemRes.warehouseUnit;
                const reqUnit = itemRes.unit || itemSchema.unit || 'عدد';
                const reqQty = Number(itemRes.requiredQty) || prod.quantity || 100;
                const shortfall = Math.max(0, reqQty - currentStock);
                const isNeedsProcurement = itemRes.status === 'needs_procurement' || shortfall > 0;

                if (isNeedsProcurement) {
                  prodShortfallCount++;
                }

                const hasUnitMismatch = !!(
                  effectiveWarehouseUnit && 
                  reqUnit && 
                  effectiveWarehouseUnit.trim().toLowerCase() !== reqUnit.trim().toLowerCase()
                );

                productMaterials.push({
                  secIdx: originalIdx,
                  sectionTitle: sec.title,
                  itemSchema,
                  itemRes,
                  matchWh,
                  currentStock,
                  effectiveWarehouseUnit,
                  reqUnit,
                  reqQty,
                  shortfall,
                  isNeedsProcurement,
                  hasUnitMismatch
                });
              });
            });

            // Filter by shortage if enabled
            if (filterShortageOnly && prodShortfallCount === 0) {
              return null;
            }

            const isFullyAvailable = prodTotalNeeds > 0 && prodShortfallCount === 0;

            return (
              <div 
                key={prod.id || pIdx}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl overflow-hidden shadow-2xs transition-all duration-200"
              >
                {/* Product Header Row */}
                <div 
                  onClick={() => toggleExpand(prod.id)}
                  className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
                    isExpanded ? 'bg-slate-900 text-white' : 'bg-slate-50 hover:bg-slate-100/80 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shrink-0 transition-colors ${
                      isExpanded 
                        ? 'bg-amber-400 text-slate-950 shadow-xs' 
                        : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}>
                      <Package className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className={`font-bold text-sm truncate ${isExpanded ? 'text-white' : 'text-slate-900'}`}>
                          {prod.item_name || 'محصول سفارش'}
                        </h4>
                        {prod.item_code && (
                          <span className={`font-mono text-xs px-2 py-0.5 rounded-lg border ${
                            isExpanded 
                              ? 'bg-slate-800 text-amber-300 border-slate-700' 
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}>
                            کد سیستم: {prod.item_code}
                          </span>
                        )}
                        {prod.customer_code && (
                          <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg border ${
                            isExpanded 
                              ? 'bg-blue-900/60 text-blue-200 border-blue-700' 
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            کد مشتری: {prod.customer_code}
                          </span>
                        )}
                        <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg border ${
                          isExpanded 
                            ? 'bg-slate-800 text-slate-200 border-slate-700' 
                            : 'bg-slate-200 text-slate-800 border-slate-300'
                        }`}>
                          سفارش: {prod.quantity} {prod.unit || 'عدد'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className={isExpanded ? 'text-slate-300' : 'text-slate-500'}>
                          نیاز به مونتاژ: {prod.needs_assembly ? 'بله' : 'خیر'}
                        </span>
                        <span className={isExpanded ? 'text-slate-600' : 'text-slate-300'}>•</span>
                        <span className={isExpanded ? 'text-slate-300' : 'text-slate-500'}>
                          {productMaterials.length} قلم مواد اولیه تعریف شده
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Badges & Expand Arrow */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {prodTotalNeeds > 0 && (
                      isFullyAvailable ? (
                        <span className="px-2.5 py-1 bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تامین کامل ({productMaterials.length})</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-2xs animate-pulse">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>{prodShortfallCount} قلم کسری انبار</span>
                        </span>
                      )
                    )}

                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                      isExpanded ? 'bg-slate-800 text-slate-300' : 'bg-white text-slate-500 border border-slate-200'
                    }`}>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Materials Breakdown Accordion Body */}
                {isExpanded && (
                  <div className="border-t border-slate-200 p-3 sm:p-4 space-y-3 bg-white animate-fadeIn">
                    <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
                      <span className="font-bold text-slate-700">زیرشاخه مواد اولیه و اجزای مورد نیاز برای این محصول:</span>
                      <span>برای ویرایش سریع مقدار یا وضعیت، کنترل‌های زیر را مستقیماً تغییر دهید</span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold">
                          <tr>
                            <th className="p-2.5 border-b border-slate-200 text-center">مرحله کنترل</th>
                            <th className="p-2.5 border-b border-slate-200">ماده اولیه / قطعه</th>
                            <th className="p-2.5 border-b border-slate-200 text-center">موجودی انبار</th>
                            <th className="p-2.5 border-b border-slate-200 text-center">مقدار مورد نیاز</th>
                            <th className="p-2.5 border-b border-slate-200 text-center">وضعیت تامین و کسری</th>
                            <th className="p-2.5 border-b border-slate-200">یادداشت تامین</th>
                            <th className="p-2.5 border-b border-slate-200 text-center">عملیات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {productMaterials.map((mat, mIdx) => {
                            const effectiveCode = mat.itemRes.itemCode || mat.itemSchema.itemCode || '';
                            const effectiveName = mat.itemRes.name || mat.itemSchema.name;

                            return (
                              <tr 
                                key={`${mat.secIdx}_${mat.itemSchema.id}_${mIdx}`} 
                                className={mat.isNeedsProcurement ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50'}
                              >
                                {/* Section Step */}
                                <td className="p-2.5 border-l border-slate-100 text-center align-middle whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => onJumpToSection && onJumpToSection(mat.secIdx)}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg inline-flex items-center gap-1 transition-colors border border-slate-200"
                                    title={`پرش به مرحله ${mat.sectionTitle}`}
                                  >
                                    <span>{mat.sectionTitle}</span>
                                    <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                                  </button>
                                </td>

                                {/* Material Name & Code */}
                                <td className="p-2.5 font-semibold text-slate-800 border-l border-slate-100 align-middle min-w-[180px]">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-bold text-slate-900 text-xs truncate" title={effectiveName}>
                                        {effectiveName}
                                      </div>
                                      {effectiveCode && (
                                        <span className="inline-block font-mono text-[10px] text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mt-0.5">
                                          کد: {effectiveCode}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenChangeMaterialModal(mat.secIdx, mat.itemSchema.id, prod.id)}
                                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors shrink-0 cursor-pointer border border-slate-200"
                                      title="تغییر یا اتصال به کالای انبار"
                                    >
                                      <Search className="w-3 h-3 text-slate-500" />
                                      اتصال انبار
                                    </button>
                                  </div>
                                </td>

                                {/* Current Stock */}
                                <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap border-l border-slate-100 align-middle">
                                  {mat.currentStock > 0 ? (
                                    <span className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-xs">
                                      {mat.currentStock} {mat.effectiveWarehouseUnit || mat.reqUnit}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-xs">
                                      0 {mat.effectiveWarehouseUnit || mat.reqUnit}
                                    </span>
                                  )}
                                </td>

                                {/* Required Qty & Unit & Conversion */}
                                <td className="p-2.5 text-center border-l border-slate-100 align-middle min-w-[140px]">
                                  <div className="flex flex-col items-center gap-1">
                                    <div className="flex items-center justify-center gap-1">
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={mat.itemRes.requiredQty ?? prod.quantity ?? 100}
                                        onChange={(e) => handleUpdatePerItemResult(mat.secIdx, prod.id, mat.itemSchema.id, 'requiredQty', e.target.value)}
                                        className="w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                                      />
                                      <select
                                        value={mat.reqUnit}
                                        onChange={(e) => handleUpdatePerItemResult(mat.secIdx, prod.id, mat.itemSchema.id, 'unit', e.target.value)}
                                        className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-1 text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer"
                                      >
                                        {COMMON_UNITS.map(u => (
                                          <option key={u} value={u}>{u}</option>
                                        ))}
                                      </select>
                                    </div>

                                    {mat.hasUnitMismatch && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenUnitConversionModal(
                                          mat.secIdx,
                                          mat.itemSchema.id,
                                          prod.id,
                                          undefined,
                                          effectiveName,
                                          effectiveCode,
                                          mat.reqQty,
                                          mat.reqUnit,
                                          mat.effectiveWarehouseUnit || 'ریسه',
                                          mat.itemRes.convertedUnit,
                                          mat.itemRes.conversionRate,
                                          mat.itemRes.convertedQty
                                        )}
                                        className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
                                      >
                                        <Scale className="w-3 h-3 text-amber-700 shrink-0" />
                                        <span>تبدیل ({mat.effectiveWarehouseUnit})</span>
                                      </button>
                                    )}

                                    {mat.itemRes.convertedQty ? (
                                      <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
                                        = {roundToOneDecimal(mat.itemRes.convertedQty)} {mat.itemRes.convertedUnit}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>

                                {/* Procurement Status & Shortfall */}
                                <td className="p-2.5 border-l border-slate-100 align-middle min-w-[200px]">
                                  <div className="flex flex-col gap-1">
                                    <select
                                      value={mat.itemRes.status}
                                      onChange={(e) => handleUpdatePerItemResult(mat.secIdx, prod.id, mat.itemSchema.id, 'status', e.target.value)}
                                      className={`px-2 py-1 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer w-full ${
                                        mat.itemRes.status === 'available'
                                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                          : 'bg-amber-100 text-amber-950 border-amber-400'
                                      }`}
                                    >
                                      <option value="available">✓ موجود در انبار</option>
                                      <option value="needs_procurement">⚠ نیاز به تامین / ساخت</option>
                                    </select>
                                    {mat.shortfall > 0 && (
                                      <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
                                        کسری خرید: {mat.shortfall} {mat.reqUnit}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Notes */}
                                <td className="p-2.5 border-l border-slate-100 align-middle">
                                  <input
                                    type="text"
                                    value={mat.itemRes.notes || ''}
                                    onChange={(e) => handleUpdatePerItemResult(mat.secIdx, prod.id, mat.itemSchema.id, 'notes', e.target.value)}
                                    placeholder="یادداشت..."
                                    className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                  />
                                </td>

                                {/* Actions */}
                                <td className="p-2.5 text-center align-middle whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItemFromSection(mat.secIdx, mat.itemSchema.id)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="حذف این ماده اولیه از کنترل"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
