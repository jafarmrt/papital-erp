import React from 'react';
import {
  Boxes, Plus, Trash2, Search, Scale, Tag, AlertCircle, CheckCircle2,
  HelpCircle, Layers, FilePlus
} from 'lucide-react';
import { ProjectInventoryControlSectionData, Item } from '../../types';
import { COMMON_UNITS, roundToOneDecimal } from './projectInventoryUtils';
import { formatPersianNumber } from '../../utils';

interface GlobalInventoryControlSectionProps {
  sections: ProjectInventoryControlSectionData[];
  warehouseItems: Item[];
  handleOpenAddMaterialModal: (secIdx: number, prodId?: string) => void;
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
  handleRemoveItemFromSection: (secIdx: number, itemId: string, prodIdOrItemIdx?: string | number, itemIdx?: number) => void;
  handleUpdateGlobalItem: (secIdx: number, gIdx: number, field: string, value: any) => void;
  handleAddNewSectionOnTheFly: () => void;
  handleRemoveSectionOnTheFly: (secIdx: number) => void;
  handleUpdateSectionDescription: (secIdx: number, newDesc: string) => void;
  handlePurchaseSection?: (secIdx: number) => void;
}

export function GlobalInventoryControlSection({
  sections,
  warehouseItems,
  handleOpenAddMaterialModal,
  handleOpenChangeMaterialModal,
  handleOpenUnitConversionModal,
  handleRemoveItemFromSection,
  handleUpdateGlobalItem,
  handleAddNewSectionOnTheFly,
  handleRemoveSectionOnTheFly,
  handleUpdateSectionDescription,
  handlePurchaseSection
}: GlobalInventoryControlSectionProps) {
  // Extract sections that are checkType === 'global'
  const globalSections = sections
    .map((sec, originalIdx) => ({ sec, originalIdx }))
    .filter(({ sec }) => sec.checkType === 'global');

  return (
    <div className="space-y-4 pt-4 border-t-2 border-slate-200 print:hidden">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-l from-slate-900 via-slate-800 to-slate-900 text-white p-4 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold shrink-0">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">
                کنترل کلی برای کل سفارش (مواد مصرفی عمومی و مشترک)
              </h3>
              <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 rounded-md text-[11px] font-mono font-bold border border-amber-400/30">
                {globalSections.length} بخش
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              مدیریت اقلامی که برای کل پروژه به صورت مشترک مصرف می‌شوند (مانند ملزومات بسته‌بندی، کارتن، لعاب، چسب و پخت کوره)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddNewSectionOnTheFly}
          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>افزودن بخش کنترل کلی جدید</span>
        </button>
      </div>

      {/* Global Sections List or Empty State */}
      {globalSections.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 bg-white rounded-2xl border border-slate-200 flex items-center justify-center mx-auto text-slate-400 shadow-2xs">
            <Boxes className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="font-bold text-sm text-slate-800">
              هیچ بخش کنترل کلی برای کل سفارش تعریف نشده است
            </h4>
            <p className="text-xs text-slate-500">
              اگر در این سفارش موادی مثل کارتن، جعبه، چسب، لعاب یا پخت کوره دارید که به کل پروژه تعلق دارد، می‌توانید یک بخش کنترل کلی اضافه کنید.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddNewSectionOnTheFly}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن اولین بخش کنترل کلی</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {globalSections.map(({ sec, originalIdx }) => {
            const items = sec.globalItems || [];

            // Calculate status for this section
            let shortfallCount = 0;
            items.forEach(item => {
              const effectiveCode = item.itemCode || '';
              const effectiveName = item.name || '';
              const matchWh = warehouseItems.find(i => 
                (effectiveCode && i.code === effectiveCode) ||
                (effectiveName && i.name.toLowerCase() === effectiveName.toLowerCase())
              );
              const currentStock = matchWh ? matchWh.current_stock : (item.stockQty ?? 0);
              const reqQty = Number(item.requiredQty || 1);
              const shortfall = Math.max(0, reqQty - currentStock);
              if (item.status === 'needs_procurement' || shortfall > 0) {
                shortfallCount++;
              }
            });

            return (
              <div 
                key={sec.id || originalIdx}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs space-y-3 p-4"
              >
                {/* Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 flex items-center justify-center font-mono text-xs font-bold">
                      {originalIdx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900">{sec.title}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-bold">
                          {items.length} قلم عمومی
                        </span>
                        {items.length > 0 && (
                          shortfallCount === 0 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              تامین کامل
                            </span>
                          ) : (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-bold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {shortfallCount} قلم کسری
                            </span>
                          )
                        )}
                      </div>
                      {sec.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{sec.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* V3.1.46 (TD-070): پل مستقیم خرید از ردیف بخش به سند سفارش خرید */}
                    {shortfallCount > 0 && handlePurchaseSection && (
                      <button
                        type="button"
                        onClick={() => handlePurchaseSection(originalIdx)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        title="صدور سند سفارش خرید برای کسری‌های همین بخش"
                      >
                        <FilePlus className="w-3.5 h-3.5" />
                        <span>ثبت سفارش خرید ({shortfallCount})</span>
                      </button>
                    )}
                    {/* Add Material to this Global Section */}
                    <button
                      type="button"
                      onClick={() => handleOpenAddMaterialModal(originalIdx)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>افزودن ماده مصرفی عمومی</span>
                    </button>

                    {/* Delete Section if extra */}
                    {sections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSectionOnTheFly(originalIdx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                        title="حذف این بخش کنترل"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Items Table or Empty State */}
                {items.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                    <span>ماده مصرفی عمومی برای این بخش ثبت نشده است.</span>
                    <button
                      type="button"
                      onClick={() => handleOpenAddMaterialModal(originalIdx)}
                      className="text-amber-600 font-bold hover:underline mr-2 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      افزودن اولین قلم
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-100/80 text-slate-700 font-bold">
                        <tr>
                          <th className="p-2.5 border-b border-slate-200">ماده اولیه / قطعه عمومی</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">موجودی انبار</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">مقدار مورد نیاز کل سفارش</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">وضعیت تامین و کسری</th>
                          <th className="p-2.5 border-b border-slate-200">یادداشت تامین</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">عملیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, gIdx) => {
                          const effectiveCode = item.itemCode || '';
                          const effectiveName = item.name || 'ماده مصرفی';

                          const matchWh = warehouseItems.find(i => 
                            (effectiveCode && i.code === effectiveCode) ||
                            (effectiveName && i.name.toLowerCase() === effectiveName.toLowerCase())
                          );

                          const currentStock = matchWh ? matchWh.current_stock : (item.stockQty ?? 0);
                          const effectiveWarehouseUnit = matchWh?.unit || item.warehouseUnit;
                          const reqUnit = item.unit || 'عدد';
                          const reqQty = Number(item.requiredQty || 1);
                          const shortfall = Math.max(0, reqQty - currentStock);
                          const isNeedsProcurement = item.status === 'needs_procurement' || shortfall > 0;
                          const displayCategory = item.category || matchWh?.category || 'عمومی';

                          const hasUnitMismatch = !!(
                            effectiveWarehouseUnit && 
                            reqUnit && 
                            effectiveWarehouseUnit.trim().toLowerCase() !== reqUnit.trim().toLowerCase()
                          );

                          return (
                            <tr 
                              key={item.itemId || gIdx}
                              className={isNeedsProcurement ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50'}
                            >
                              {/* Material Name + Category + Warehouse Link */}
                              <td className="p-2.5 font-semibold text-slate-800 border-l border-slate-100 align-middle min-w-[220px]">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
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

                                  <button
                                    type="button"
                                    onClick={() => handleOpenChangeMaterialModal(originalIdx, item.itemId, undefined, gIdx)}
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

                              {/* Required Quantity & Unit & Conversion */}
                              <td className="p-2.5 text-center border-l border-slate-100 align-middle min-w-[140px]">
                                <div className="flex flex-col items-center gap-1">
                                  <div className="flex items-center justify-center gap-1">
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={item.requiredQty || 1}
                                      onChange={(e) => handleUpdateGlobalItem(originalIdx, gIdx, 'requiredQty', e.target.value)}
                                      className="w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                                      title="مقدار مورد نیاز کل سفارش"
                                    />
                                    <select
                                      value={reqUnit}
                                      onChange={(e) => handleUpdateGlobalItem(originalIdx, gIdx, 'unit', e.target.value)}
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
                                        item.itemId,
                                        undefined,
                                        gIdx,
                                        effectiveName,
                                        effectiveCode,
                                        reqQty,
                                        reqUnit,
                                        effectiveWarehouseUnit || 'عدد',
                                        item.convertedUnit,
                                        item.conversionRate,
                                        item.convertedQty
                                      )}
                                      className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
                                    >
                                      <Scale className="w-3 h-3 text-amber-700 shrink-0" />
                                      <span>تبدیل ({effectiveWarehouseUnit})</span>
                                    </button>
                                  )}

                                  {item.convertedQty ? (
                                    <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
                                      = {formatPersianNumber(item.convertedQty)} {item.convertedUnit}
                                    </span>
                                  ) : null}
                                </div>
                              </td>

                              {/* Procurement Status & Shortfall */}
                              <td className="p-2.5 border-l border-slate-100 align-middle min-w-[190px]">
                                <div className="flex flex-col gap-1">
                                  <select
                                    value={item.status}
                                    onChange={(e) => handleUpdateGlobalItem(originalIdx, gIdx, 'status', e.target.value)}
                                    className={`px-2 py-1 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer w-full ${
                                      item.status === 'available'
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
                                  value={item.notes || ''}
                                  onChange={(e) => handleUpdateGlobalItem(originalIdx, gIdx, 'notes', e.target.value)}
                                  placeholder="یادداشت..."
                                  className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                />
                              </td>

                              {/* Actions */}
                              <td className="p-2.5 text-center align-middle whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItemFromSection(originalIdx, item.itemId, gIdx)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="حذف این ماده مصرفی"
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
      )}
    </div>
  );
}
