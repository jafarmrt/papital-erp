import { useState } from 'react';
import { Package, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Search, Scale, Trash2, Plus, Tag } from 'lucide-react';
import { 
  ProjectProductItem, 
  ProjectInventoryControlSectionData, 
  Item 
} from '../../types';
import { COMMON_UNITS } from './projectInventoryUtils';
import { formatPersianNumber } from '../../utils';

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
  handleRemoveItemFromSection: (secIdx: number, itemId: string, prodId?: string, itemIdx?: number) => void;
  handleOpenAddMaterialModal: (secIdx: number, prodId?: string) => void;
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
  handleOpenAddMaterialModal
}: ProductTreeInventoryCardsProps) {
  // Keep track of which product cards are expanded
  const [expandedProductIds, setExpandedProductIds] = useState<Record<string, boolean>>(() => {
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
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-300 transition-colors cursor-pointer"
          >
            باز کردن همه
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-300 transition-colors cursor-pointer"
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

            // Match product image from warehouse items or product props
            const matchingItem = warehouseItems.find(i => 
              (prod.item_id && i.id === prod.item_id) || 
              (prod.item_code && i.code === prod.item_code) ||
              (prod.item_name && i.name.toLowerCase() === prod.item_name.toLowerCase())
            );
            const prodImage = (prod as any).image || (prod as any).thumbnail || matchingItem?.image || matchingItem?.thumbnail;

            // Compute overall status for this product across all per_item stages
            let totalMaterialsCount = 0;
            let prodShortfallCount = 0;

            perItemSections.forEach(({ sec }) => {
              const prodRes = sec.perItemResults?.[prod.id] || {};
              const materials = Object.values(prodRes);
              if (materials.length > 0) {
                materials.forEach(mat => {
                  totalMaterialsCount++;
                  const effectiveCode = mat.itemCode || '';
                  const effectiveName = mat.name || '';
                  const matchWh = warehouseItems.find(i => 
                    (effectiveCode && i.code === effectiveCode) ||
                    (effectiveName && i.name.toLowerCase() === effectiveName.toLowerCase())
                  );
                  const currentStock = matchWh ? matchWh.current_stock : (mat.stockQty ?? 0);
                  const reqQty = Number(mat.requiredQty !== undefined ? mat.requiredQty : 1);
                  const shortfall = Math.max(0, reqQty - currentStock);
                  if (mat.status === 'needs_procurement' || shortfall > 0) {
                    prodShortfallCount++;
                  }
                });
              } else if ((sec.itemsSchema || []).length > 0) {
                totalMaterialsCount += sec.itemsSchema.length;
              }
            });

            // Filter by shortage if enabled
            if (filterShortageOnly && prodShortfallCount === 0) {
              return null;
            }

            const isFullyAvailable = totalMaterialsCount > 0 && prodShortfallCount === 0;

            return (
              <div 
                key={prod.id || pIdx}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl overflow-hidden shadow-2xs transition-all duration-200"
              >
                {/* Product Header Row (Black / Dark Slate Card) */}
                <div 
                  onClick={() => toggleExpand(prod.id)}
                  className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors select-none ${
                    isExpanded ? 'bg-slate-900 text-white' : 'bg-slate-50 hover:bg-slate-100/80 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Product Image Display with Graceful Fallback */}
                    {prodImage ? (
                      <div className="relative shrink-0">
                        <img 
                          src={prodImage} 
                          alt={prod.item_name} 
                          className="w-12 h-12 rounded-xl object-cover border border-amber-400/50 bg-slate-800 shadow-xs" 
                          onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                        />
                      </div>
                    ) : (
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0 transition-colors ${
                        isExpanded 
                          ? 'bg-amber-400 text-slate-950 shadow-xs' 
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}>
                        <Package className="w-6 h-6" />
                      </div>
                    )}

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
                            کد: {prod.item_code}
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
                          سفارش: {formatPersianNumber(prod.quantity)} {prod.unit || 'عدد'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className={isExpanded ? 'text-slate-300' : 'text-slate-500'}>
                          نیاز به مونتاژ: {prod.needs_assembly ? 'بله' : 'خیر'}
                        </span>
                        <span className={isExpanded ? 'text-slate-600' : 'text-slate-300'}>•</span>
                        <span className={isExpanded ? 'text-slate-300' : 'text-slate-500'}>
                          {totalMaterialsCount} قلم مواد اولیه تعریف شده برای این کد
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Badges & Expand Arrow */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {totalMaterialsCount > 0 && (
                      isFullyAvailable ? (
                        <span className="px-2.5 py-1 bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تامین کامل ({totalMaterialsCount})</span>
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
                  <div className="border-t border-slate-200 p-3 sm:p-4 space-y-4 bg-white animate-fadeIn">
                    <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
                      <span className="font-bold text-slate-800">
                        مراحل و ساختار درختی مواد اولیه اختصاصی کد «{prod.item_name}»:
                      </span>
                      <span className="text-[11px] text-slate-500">
                        مواد اولیه در این بخش مستقلاً برای همین کد محصول مدیریت می‌شوند.
                      </span>
                    </div>

                    {/* Group materials by stage/section for this product */}
                    <div className="space-y-4">
                      {perItemSections.map(({ sec, originalIdx }) => {
                        const prodRes = sec.perItemResults?.[prod.id] || {};
                        let materials = Object.values(prodRes);

                        // If no specific per-item result yet, check if there are legacy default schemas
                        if (materials.length === 0 && (sec.itemsSchema || []).length > 0) {
                          materials = (sec.itemsSchema || []).map(s => ({
                            itemId: s.id,
                            name: s.name,
                            itemCode: s.itemCode,
                            unit: s.unit || 'عدد',
                            category: (s as any).category,
                            requiredQty: 1,
                            stockQty: 0,
                            status: 'available' as const
                          }));
                        }

                        return (
                          <div 
                            key={sec.id || originalIdx} 
                            className="bg-slate-50/70 rounded-xl border border-slate-200 p-3 space-y-3"
                          >
                            {/* Stage Header with dedicated Add Material Button */}
                            <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-200/80">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-900 text-amber-400 flex items-center justify-center font-mono text-[10px] font-bold">
                                  {originalIdx + 1}
                                </span>
                                <span className="font-bold text-xs text-slate-800">{sec.title}</span>
                                {sec.description && (
                                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                                    — {sec.description}
                                  </span>
                                )}
                              </div>

                              {/* Button: Add Material to THIS Stage for THIS Product */}
                              <button
                                type="button"
                                onClick={() => handleOpenAddMaterialModal(originalIdx, prod.id)}
                                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>افزودن ماده اولیه به این مرحله</span>
                              </button>
                            </div>

                            {/* Materials Table or Empty State */}
                            {materials.length === 0 ? (
                              <div className="py-4 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-white">
                                <span>ماده اولیه‌ای برای این مرحله تعریف نشده است.</span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenAddMaterialModal(originalIdx, prod.id)}
                                  className="text-amber-600 font-bold hover:underline mr-2 cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  افزودن اولین ماده اولیه
                                </button>
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="w-full text-right text-xs">
                                  <thead className="bg-slate-100/80 text-slate-700 font-bold">
                                    <tr>
                                      <th className="p-2.5 border-b border-slate-200">ماده اولیه / قطعه</th>
                                      <th className="p-2.5 border-b border-slate-200 text-center">موجودی انبار</th>
                                      <th className="p-2.5 border-b border-slate-200 text-center">مقدار مورد نیاز</th>
                                      <th className="p-2.5 border-b border-slate-200 text-center">وضعیت تامین و کسری</th>
                                      <th className="p-2.5 border-b border-slate-200">یادداشت تامین</th>
                                      <th className="p-2.5 border-b border-slate-200 text-center">عملیات</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {materials.map((mat, mIdx) => {
                                      const effectiveCode = mat.itemCode || '';
                                      const effectiveName = mat.name || 'ماده اولیه';

                                      const matchWh = warehouseItems.find(i => 
                                        (effectiveCode && i.code === effectiveCode) ||
                                        (effectiveName && i.name.toLowerCase() === effectiveName.toLowerCase())
                                      );

                                      const currentStock = matchWh ? matchWh.current_stock : (mat.stockQty ?? 0);
                                      const effectiveWarehouseUnit = matchWh?.unit || mat.warehouseUnit;
                                      const reqUnit = mat.unit || 'عدد';
                                      const reqQty = Number(mat.requiredQty !== undefined ? mat.requiredQty : 1);
                                      const shortfall = Math.max(0, reqQty - currentStock);
                                      const isNeedsProcurement = mat.status === 'needs_procurement' || shortfall > 0;
                                      const displayCategory = mat.category || matchWh?.category || 'عمومی';

                                      const hasUnitMismatch = !!(
                                        effectiveWarehouseUnit && 
                                        reqUnit && 
                                        effectiveWarehouseUnit.trim().toLowerCase() !== reqUnit.trim().toLowerCase()
                                      );

                                      return (
                                        <tr 
                                          key={mat.itemId || mIdx} 
                                          className={isNeedsProcurement ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50'}
                                        >
                                          {/* Column 1: Material / Part + CATEGORY Display + Warehouse Link */}
                                          <td className="p-2.5 font-semibold text-slate-800 border-l border-slate-100 align-middle min-w-[220px]">
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  {/* Category Badge Display */}
                                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                    <Tag className="w-2.5 h-2.5 text-slate-500" />
                                                    {displayCategory}
                                                  </span>
                                                  <span className="font-bold text-slate-900 text-xs truncate" title={effectiveName}>
                                                    {effectiveName}
                                                  </span>
                                                </div>

                                                {effectiveCode && (
                                                  <div className="font-mono text-[10px] text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 inline-block">
                                                    کد: {effectiveCode}
                                                  </div>
                                                )}
                                              </div>

                                              {/* Warehouse Link Button */}
                                              <button
                                                type="button"
                                                onClick={() => handleOpenChangeMaterialModal(originalIdx, mat.itemId, prod.id)}
                                                className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors shrink-0 cursor-pointer border border-slate-300 shadow-2xs"
                                                title="اتصال این ردیف به کالای موجود در انبار"
                                              >
                                                <Search className="w-3 h-3 text-slate-500" />
                                                <span>اتصال انبار</span>
                                              </button>
                                            </div>
                                          </td>

                                          {/* Current Stock */}
                                          <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap border-l border-slate-100 align-middle">
                                            {currentStock > 0 ? (
                                              <span className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-xs">
                                                {formatPersianNumber(currentStock)} {effectiveWarehouseUnit || reqUnit}
                                              </span>
                                            ) : (
                                              <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-xs">
                                                ۰ {effectiveWarehouseUnit || reqUnit}
                                              </span>
                                            )}
                                          </td>

                                          {/* Required Qty & Unit (Decoupled from order quantity) & Unit Conversion */}
                                          <td className="p-2.5 text-center border-l border-slate-100 align-middle min-w-[140px]">
                                            <div className="flex flex-col items-center gap-1">
                                              <div className="flex items-center justify-center gap-1">
                                                <input
                                                  type="number"
                                                  min="0"
                                                  step="any"
                                                  value={mat.requiredQty !== undefined ? mat.requiredQty : 1}
                                                  onChange={(e) => handleUpdatePerItemResult(originalIdx, prod.id, mat.itemId, 'requiredQty', e.target.value)}
                                                  className="w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                                                  title="مقدار مورد نیاز برای این محصول (مستقل از تعداد سفارش)"
                                                />
                                                <select
                                                  value={reqUnit}
                                                  onChange={(e) => handleUpdatePerItemResult(originalIdx, prod.id, mat.itemId, 'unit', e.target.value)}
                                                  className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-1 text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer"
                                                >
                                                  {COMMON_UNITS.map(u => (
                                                    <option key={u} value={u}>{u}</option>
                                                  ))}
                                                </select>
                                              </div>

                                              {hasUnitMismatch && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleOpenUnitConversionModal(
                                                    originalIdx,
                                                    mat.itemId,
                                                    prod.id,
                                                    undefined,
                                                    effectiveName,
                                                    effectiveCode,
                                                    reqQty,
                                                    reqUnit,
                                                    effectiveWarehouseUnit || 'ریسه',
                                                    mat.convertedUnit,
                                                    mat.conversionRate,
                                                    mat.convertedQty
                                                  )}
                                                  className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
                                                >
                                                  <Scale className="w-3 h-3 text-amber-700 shrink-0" />
                                                  <span>تبدیل ({effectiveWarehouseUnit})</span>
                                                </button>
                                              )}

                                              {mat.convertedQty ? (
                                                <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
                                                  = {formatPersianNumber(mat.convertedQty)} {mat.convertedUnit}
                                                </span>
                                              ) : null}
                                            </div>
                                          </td>

                                          {/* Procurement Status & Shortfall */}
                                          <td className="p-2.5 border-l border-slate-100 align-middle min-w-[190px]">
                                            <div className="flex flex-col gap-1">
                                              <select
                                                value={mat.status}
                                                onChange={(e) => handleUpdatePerItemResult(originalIdx, prod.id, mat.itemId, 'status', e.target.value)}
                                                className={`px-2 py-1 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer w-full ${
                                                  mat.status === 'available'
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                                    : 'bg-amber-100 text-amber-950 border-amber-400'
                                                }`}
                                              >
                                                <option value="available">✓ موجود در انبار</option>
                                                <option value="needs_procurement">⚠ نیاز به تامین / خرید</option>
                                              </select>
                                              {shortfall > 0 && (
                                                <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
                                                  کسری خرید: {formatPersianNumber(shortfall)} {reqUnit}
                                                </span>
                                              )}
                                            </div>
                                          </td>

                                          {/* Notes */}
                                          <td className="p-2.5 border-l border-slate-100 align-middle">
                                            <input
                                              type="text"
                                              value={mat.notes || ''}
                                              onChange={(e) => handleUpdatePerItemResult(originalIdx, prod.id, mat.itemId, 'notes', e.target.value)}
                                              placeholder="یادداشت..."
                                              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                            />
                                          </td>

                                          {/* Actions: Delete only from THIS product */}
                                          <td className="p-2.5 text-center align-middle whitespace-nowrap">
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveItemFromSection(originalIdx, mat.itemId, prod.id)}
                                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                              title="حذف این ماده اولیه از این محصول"
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
                            )}
                          </div>
                        );
                      })}
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
