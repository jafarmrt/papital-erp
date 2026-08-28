import React from 'react';
import { Scale, X } from 'lucide-react';
import { COMMON_UNITS, roundToOneDecimal } from './projectInventoryUtils';

interface UnitConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversionTarget: {
    secIdx: number;
    prodId?: string;
    itemId: string;
    gIdx?: number;
    itemName: string;
    itemCode?: string;
    originalQty: number;
    originalUnit: string;
    warehouseUnit: string;
  } | null;
  conversionForm: {
    targetUnit: string;
    mode: 'rate' | 'direct';
    rate: number;
    directConvertedQty: number;
    notes: string;
  };
  setConversionForm: React.Dispatch<React.SetStateAction<{
    targetUnit: string;
    mode: 'rate' | 'direct';
    rate: number;
    directConvertedQty: number;
    notes: string;
  }>>;
  handleApplyUnitConversion: (e: React.FormEvent) => void;
}

export function UnitConversionModal({
  isOpen,
  onClose,
  conversionTarget,
  conversionForm,
  setConversionForm,
  handleApplyUnitConversion
}: UnitConversionModalProps) {
  if (!isOpen || !conversionTarget) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-fadeIn">
        <div className="bg-amber-500 text-slate-950 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-slate-950" />
            <h3 className="font-bold text-sm">تبدیل واحد شمارش کالا (پروژه به انبار)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-amber-600 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleApplyUnitConversion} className="p-5 space-y-4 font-farsi text-xs">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
            <p className="font-bold text-amber-950">
              نام کالا: {conversionTarget.itemName} {conversionTarget.itemCode ? `(${conversionTarget.itemCode})` : ''}
            </p>
            <p className="text-amber-900">
              مقدار مورد نیاز پروژه: <strong className="font-mono text-sm">{conversionTarget.originalQty} {conversionTarget.originalUnit}</strong>
            </p>
            <p className="text-amber-800 text-[11px]">
              واحد موجود در انبار: <strong>{conversionTarget.warehouseUnit}</strong>
            </p>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-700">واحد جدید / انبار جهت تبدیل:</label>
            <select
              value={conversionForm.targetUnit}
              onChange={(e) => setConversionForm({ ...conversionForm, targetUnit: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 focus:outline-none"
            >
              {COMMON_UNITS.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">هر {conversionForm.targetUnit} شامل چند {conversionTarget.originalUnit} است؟</label>
              <input
                type="number"
                min="0.001"
                step="any"
                value={conversionForm.rate}
                onChange={(e) => setConversionForm({
                  ...conversionForm,
                  mode: 'rate',
                  rate: Number(e.target.value) || 1,
                  directConvertedQty: Number(e.target.value) > 0 ? Math.ceil(conversionTarget.originalQty / Number(e.target.value)) : 1
                })}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-700">مقدار محاسبه شده به {conversionForm.targetUnit}:</label>
              <div className="p-2 bg-slate-100 rounded-xl font-mono font-bold text-amber-950 text-center text-sm border border-slate-200">
                {conversionForm.mode === 'rate'
                  ? roundToOneDecimal(conversionTarget.originalQty / Math.max(0.001, conversionForm.rate))
                  : roundToOneDecimal(conversionForm.directConvertedQty)} {conversionForm.targetUnit}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-700">توضیحات و فرمول تبدیل (اختیاری):</label>
            <input
              type="text"
              value={conversionForm.notes}
              onChange={(e) => setConversionForm({ ...conversionForm, notes: e.target.value })}
              placeholder="مثلا: تبدیل ۱۰۰ عدد سنگ قرمز به ۴ ریسه..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-800"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
            >
              انصراف
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
            >
              تایید و اعمال تبدیل واحد
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
