import React from 'react';
import { 
  Info, Plus, Trash2, Search, Scale, Package 
} from 'lucide-react';
import { 
  ProjectInventoryControlSectionData, 
  ProjectProductItem, 
  Item 
} from '../../types';
import { COMMON_UNITS, roundToOneDecimal } from './projectInventoryUtils';

interface InventorySectionsListProps {
  activeStepTab: number;
  setActiveStepTab: (step: number) => void;
  sections: ProjectInventoryControlSectionData[];
  products: ProjectProductItem[];
  warehouseItems: Item[];
  handleUpdateSectionDescription: (secIdx: number, newDesc: string) => void;
  handleOpenAddMaterialModal: (secIdx: number) => void;
  handleRemoveSectionOnTheFly: (secIdx: number) => void;
  handleOpenChangeMaterialModal: (secIdx: number, itemId: string, prodId?: string, gIdx?: number) => void;
  handleUpdatePerItemResult: (secIdx: number, prodId: string, itemId: string, field: string, value: any) => void;
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
  handleUpdateGlobalItem: (secIdx: number, gIdx: number, field: string, value: any) => void;
}

export function InventorySectionsList({
  activeStepTab,
  setActiveStepTab,
  sections,
  products,
  warehouseItems,
  handleUpdateSectionDescription,
  handleOpenAddMaterialModal,
  handleRemoveSectionOnTheFly,
  handleOpenChangeMaterialModal,
  handleUpdatePerItemResult,
  handleOpenUnitConversionModal,
  handleRemoveItemFromSection,
  handleUpdateGlobalItem
}: InventorySectionsListProps) {
  if (activeStepTab >= sections.length) return null;

  const currentSec = sections[activeStepTab];
  if (!currentSec) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5 shadow-xs animate-fadeIn print:hidden">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-slate-900 text-amber-400 font-bold rounded-lg text-xs shrink-0">
              مرحله {activeStepTab + 1}
            </span>
            <h4 className="font-bold text-slate-900 text-sm bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 flex-1">
              {currentSec.title}
            </h4>
          </div>
          <input
            type="text"
            value={currentSec.description || ''}
            onChange={(e) => handleUpdateSectionDescription(activeStepTab, e.target.value)}
            placeholder="توضیحات راهنما..."
            className="w-full text-slate-500 text-xs bg-transparent border-b border-dashed border-slate-200 py-0.5 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-3 py-1 rounded-xl font-bold text-xs border ${
            currentSec.checkType === 'per_item' 
              ? 'bg-blue-50 text-blue-800 border-blue-200' 
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}>
            {currentSec.checkType === 'per_item' ? 'بررسی کد به کد' : 'بررسی کلی پروژه'}
          </span>

          <button
            type="button"
            onClick={() => handleOpenAddMaterialModal(activeStepTab)}
            className="px-3.5 py-1.5 bg-amber-50 text-amber-950 hover:bg-amber-100 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-amber-200 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700" />
            افزودن ماده اولیه جدید
          </button>

          <button
            type="button"
            onClick={() => handleRemoveSectionOnTheFly(activeStepTab)}
            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
            title="حذف این بخش"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* If PER_ITEM Section (کد به کد) */}
      {currentSec.checkType === 'per_item' ? (
        <div className="space-y-4">
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex items-start gap-2 text-xs text-blue-900">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              <strong>کنترل کد به کد:</strong> در این بخش وضعیت داشتن موجودی برای تک‌تک کدهای سفارش همراه با مقدار مورد نیاز و واحد شمارش کنترل می‌شود. چنانچه برای کدی گزینه <strong>«نیازمند تامین»</strong> انتخاب شود، عنوان آن صریحاً در لیست خرید قرار می‌گیرد.
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold">
                <tr>
                  <th className="p-3 border-b border-slate-200 text-center">#</th>
                  <th className="p-3 border-b border-slate-200">کد / نام محصول سفارش</th>
                  <th className="p-3 border-b border-slate-200 text-center">تعداد سفارش</th>
                  <th className="p-3 border-b border-slate-200">ماده اولیه / موضوع کنترل</th>
                  <th className="p-3 border-b border-slate-200 text-center">موجودی فعلی انبار</th>
                  <th className="p-3 border-b border-slate-200 text-center">مقدار مورد نیاز و واحد</th>
                  <th className="p-3 border-b border-slate-200">وضعیت تامین انبار</th>
                  <th className="p-3 border-b border-slate-200">توضیحات و یادداشت</th>
                  <th className="p-3 border-b border-slate-200 text-center">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {products.map((prod, pIdx) => {
                  const prodRes = currentSec.perItemResults?.[prod.id] || {};
                  const itemsSchema = currentSec.itemsSchema || [{ id: 'item_default', name: 'ماده اولیه', unit: 'عدد' }];

                  return itemsSchema.map((itemSchema, iIdx) => {
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

                    const hasUnitMismatch = !!(
                      effectiveWarehouseUnit && 
                      reqUnit && 
                      effectiveWarehouseUnit.trim().toLowerCase() !== reqUnit.trim().toLowerCase()
                    );

                    return (
                      <tr key={`${prod.id}_${itemSchema.id}`} className={isNeedsProcurement ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                        {iIdx === 0 && (
                          <>
                            <td rowSpan={itemsSchema.length} className="p-2.5 font-bold text-slate-500 border-l border-slate-100 text-center align-middle">
                              {pIdx + 1}
                            </td>
                            <td rowSpan={itemsSchema.length} className="p-2.5 font-bold text-slate-800 border-l border-slate-100 align-middle max-w-[220px]">
                              <div className="flex items-start gap-1.5" title={`${prod.item_name || 'محصول سفارش'} ${prod.item_code ? `(${prod.item_code})` : ''}`}>
                                <Package className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                  <div className="font-bold text-slate-900 text-xs truncate max-w-[180px]">
                                    {prod.item_name || 'محصول سفارش'}
                                  </div>
                                  {prod.item_code && (
                                    <span className="inline-block font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 mt-0.5">
                                      کد: {prod.item_code}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td rowSpan={itemsSchema.length} className="p-2.5 text-center font-bold text-slate-700 border-l border-slate-100 align-middle font-mono whitespace-nowrap">
                              {prod.quantity} {prod.unit || 'عدد'}
                            </td>
                          </>
                        )}

                        <td className="p-2.5 font-semibold text-slate-800 max-w-[220px]">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1" title={effectiveName}>
                              <div className="font-bold text-slate-900 text-xs truncate max-w-[160px]">
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
                              onClick={() => handleOpenChangeMaterialModal(activeStepTab, itemSchema.id, prod.id)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors shrink-0 cursor-pointer border border-slate-200"
                              title="تغییر یا لینک به کالا از انبار"
                            >
                              <Search className="w-3 h-3 text-slate-500" />
                              لینک انبار
                            </button>
                          </div>
                        </td>

                        <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap">
                          {currentStock > 0 ? (
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-xs">
                              {currentStock} {effectiveWarehouseUnit || reqUnit}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-xs">
                              0 {effectiveWarehouseUnit || reqUnit}
                            </span>
                          )}
                        </td>

                        <td className="p-2.5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={itemRes.requiredQty ?? prod.quantity ?? 100}
                                onChange={(e) => handleUpdatePerItemResult(activeStepTab, prod.id, itemSchema.id, 'requiredQty', e.target.value)}
                                className="w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                              />
                              <select
                                value={reqUnit}
                                onChange={(e) => handleUpdatePerItemResult(activeStepTab, prod.id, itemSchema.id, 'unit', e.target.value)}
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
                                  activeStepTab,
                                  itemSchema.id,
                                  prod.id,
                                  undefined,
                                  effectiveName,
                                  effectiveCode,
                                  reqQty,
                                  reqUnit,
                                  effectiveWarehouseUnit || 'ریسه',
                                  itemRes.convertedUnit,
                                  itemRes.conversionRate,
                                  itemRes.convertedQty
                                )}
                                className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
                              >
                                <Scale className="w-3 h-3 text-amber-700 shrink-0" />
                                <span>تبدیل واحد ({effectiveWarehouseUnit})</span>
                              </button>
                            )}

                            {itemRes.convertedQty ? (
                              <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
                                = {roundToOneDecimal(itemRes.convertedQty)} {itemRes.convertedUnit}
                              </span>
                            ) : null}
                          </div>
                        </td>

                        <td className="p-2.5">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={itemRes.status}
                              onChange={(e) => handleUpdatePerItemResult(activeStepTab, prod.id, itemSchema.id, 'status', e.target.value)}
                              className={`px-2.5 py-1.5 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer ${
                                itemRes.status === 'available'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : 'bg-amber-100 text-amber-950 border-amber-400'
                              }`}
                            >
                              <option value="available">بله - در انبار موجود است</option>
                              <option value="needs_procurement">خیر - نیاز به تامین / ساخت دارد</option>
                            </select>
                            {shortfall > 0 && (
                              <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 shrink-0">
                                {shortfall} کسری
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="p-2.5">
                          <input
                            type="text"
                            value={itemRes.notes || ''}
                            onChange={(e) => handleUpdatePerItemResult(activeStepTab, prod.id, itemSchema.id, 'notes', e.target.value)}
                            placeholder="یادداشت تامین..."
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                          />
                        </td>

                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItemFromSection(activeStepTab, itemSchema.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="حذف این ردیف ماده اولیه"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* If GLOBAL Section (کلی برای کل سفارش) */
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-start gap-2 text-xs text-emerald-900">
            <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>کنترل کلی سفارش:</strong> موادی مانند کیلر، گلیز، سمباده، چسب و کارتن بسته‌بندی به‌صورت یکجا برای کل پروژه محاسبه شده و موجودی آن‌ها با انبار مطابقت داده می‌شود.
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold">
                <tr>
                  <th className="p-3 border-b border-slate-200 text-center">#</th>
                  <th className="p-3 border-b border-slate-200">عنوان ماده اولیه / ملزومات</th>
                  <th className="p-3 border-b border-slate-200 text-center">مقدار مورد نیاز کل</th>
                  <th className="p-3 border-b border-slate-200 text-center">موجودی فعلی انبار</th>
                  <th className="p-3 border-b border-slate-200 text-center">کسری / نیاز خرید</th>
                  <th className="p-3 border-b border-slate-200">وضعیت تامین</th>
                  <th className="p-3 border-b border-slate-200">یادداشت</th>
                  <th className="p-3 border-b border-slate-200 text-center">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {(currentSec.globalItems || []).map((gItem, gIdx) => {
                  const matchWh = warehouseItems.find(i => 
                    (gItem.itemCode && i.code === gItem.itemCode) ||
                    (i.name && i.name.toLowerCase().includes(gItem.name.toLowerCase()))
                  );
                  const stQty = matchWh ? matchWh.current_stock : (gItem.stockQty ?? 0);
                  const effectiveWarehouseUnit = matchWh?.unit || gItem.warehouseUnit;
                  const reqUnit = gItem.unit || 'عدد';
                  const reqQty = Number(gItem.requiredQty) || 0;
                  const shortfall = Math.max(0, reqQty - stQty);
                  const isNeedsProcurement = gItem.status === 'needs_procurement' || shortfall > 0;

                  const hasUnitMismatch = !!(
                    effectiveWarehouseUnit && 
                    reqUnit && 
                    effectiveWarehouseUnit.trim().toLowerCase() !== reqUnit.trim().toLowerCase()
                  );

                  return (
                    <tr key={gItem.itemId || gIdx} className={isNeedsProcurement ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                      <td className="p-2.5 font-bold text-slate-500 text-center">{gIdx + 1}</td>
                      <td className="p-2.5 font-bold text-slate-800 max-w-[220px]">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <input
                              type="text"
                              value={gItem.name}
                              onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'name', e.target.value)}
                              className="w-full font-bold text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 truncate"
                            />
                            {gItem.itemCode && (
                              <span className="inline-block font-mono text-[10px] text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mt-0.5">
                                کد: {gItem.itemCode}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenChangeMaterialModal(activeStepTab, gItem.itemId, undefined, gIdx)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors shrink-0 cursor-pointer border border-slate-200"
                            title="لینک به کالا در انبار"
                          >
                            <Search className="w-3 h-3 text-slate-500" />
                            انبار
                          </button>
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={gItem.requiredQty || 0}
                              onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'requiredQty', e.target.value)}
                              className="w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs"
                            />
                            <select
                              value={reqUnit}
                              onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'unit', e.target.value)}
                              className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-1 text-[11px] font-bold text-slate-700 cursor-pointer"
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
                                activeStepTab,
                                gItem.itemId,
                                undefined,
                                gIdx,
                                gItem.name,
                                gItem.itemCode,
                                reqQty,
                                reqUnit,
                                effectiveWarehouseUnit || 'ریسه',
                                gItem.convertedUnit,
                                gItem.conversionRate,
                                gItem.convertedQty
                              )}
                              className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
                            >
                              <Scale className="w-3 h-3 text-amber-700 shrink-0" />
                              <span>تبدیل واحد ({effectiveWarehouseUnit})</span>
                            </button>
                          )}

                          {gItem.convertedQty ? (
                            <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
                              = {roundToOneDecimal(gItem.convertedQty)} {gItem.convertedUnit}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={stQty}
                            onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'stockQty', e.target.value)}
                            className="w-16 text-center font-mono bg-white border border-slate-300 rounded-lg py-1 text-xs font-bold"
                          />
                          <span className="text-slate-500 text-[11px] font-bold">{effectiveWarehouseUnit || reqUnit}</span>
                        </div>
                      </td>
                      <td className="p-3 text-center font-bold font-mono text-xs">
                        {shortfall > 0 ? (
                          <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                            {shortfall} {gItem.unit} کسری
                          </span>
                        ) : (
                          <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            کافی است
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <select
                          value={gItem.status}
                          onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'status', e.target.value)}
                          className={`px-3 py-1.5 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer ${
                            gItem.status === 'available'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-amber-100 text-amber-950 border-amber-400'
                          }`}
                        >
                          <option value="available">موجود در انبار</option>
                          <option value="needs_procurement">نیازمند خرید / تامین</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={gItem.notes || ''}
                          onChange={(e) => handleUpdateGlobalItem(activeStepTab, gIdx, 'notes', e.target.value)}
                          placeholder="یادداشت..."
                          className="w-full px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                        />
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItemFromSection(activeStepTab, gItem.itemId, gIdx)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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

      {/* Step Controls */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setActiveStepTab(Math.max(0, activeStepTab - 1))}
          disabled={activeStepTab === 0}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl disabled:opacity-40 transition-colors cursor-pointer"
        >
          گام قبلی
        </button>

        <button
          type="button"
          onClick={() => setActiveStepTab(activeStepTab + 1)}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer"
        >
          {activeStepTab < sections.length - 1 ? 'گام بعدی' : 'مشاهده لیست جامع خرید'}
        </button>
      </div>
    </div>
  );
}
