import { Scale } from 'lucide-react';
import type { ProjectInventoryControlItemResult } from '../../types';
import { COMMON_UNITS } from './projectInventoryUtils';
import { formatPersianNumber } from '../../utils';
import { DecimalInput } from '../common/DecimalInput';
import {
  isPerUnitRow, perItemRowRequiredQty, perUnitQtyFromTotal, perUnitRowFields, rowConvertedQty,
} from '../../lib/projects/materialQuantity';

interface PerItemQtyCellProps {
  material: ProjectInventoryControlItemResult;
  /** تعداد سفارش محصول (`productOrderQuantity`) */
  orderQty: number;
  unit: string;
  warehouseUnit?: string;
  hasUnitMismatch: boolean;
  onFields: (patch: Record<string, unknown>) => void;
  onOpenConversion: (total: number) => void;
}

/**
 * TD-1343 (بستهٔ ۱۲ بند ۲، گزینهٔ الف کارت ت۴۲): ستون مقدار ردیف کد به کد. ردیف «برای هر عدد» مقدار یک عدد محصول را می‌گیرد
 * و جمع سفارش (مقدار × تعداد سفارش امروز) زیر آن دیده می‌شود؛ ردیف پیشین عدد کل خود را با نشان «کل» نگه می‌دارد و با
 * «برای هر عدد» به مقدار یک عدد (کل ÷ تعداد سفارش) برده می‌شود.
 */
export function PerItemQtyCell({ material, orderQty, unit, warehouseUnit, hasUnitMismatch, onFields, onOpenConversion }: PerItemQtyCellProps) {
  const perUnit = isPerUnitRow(material);
  const total = perItemRowRequiredQty(material, orderQty);
  const converted = rowConvertedQty(material, total);
  const inputClass = 'w-16 text-center font-mono font-bold bg-white border border-slate-300 rounded-lg py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none';

  return (
    <td className="p-2.5 text-center border-l border-slate-100 align-middle min-w-[160px]">
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center justify-center gap-1">
          {perUnit ? (
            <DecimalInput
              min="0"
              step="any"
              value={material.qtyPerUnit}
              onValueChange={(text) => onFields(perUnitRowFields(text === '' ? 0 : Number(text), orderQty))}
              className={inputClass}
              aria-label="مقدار برای هر عدد محصول"
              title="مقدار برای هر عدد محصول؛ جمع سفارش با تعداد سفارش حساب می‌شود"
            />
          ) : (
            <>
              <DecimalInput
                min="0"
                step="any"
                value={material.requiredQty !== undefined ? material.requiredQty : 1}
                onValueChange={(text) => onFields({ requiredQty: text })}
                className={inputClass}
                aria-label="مقدار کل این ردیف"
                title="مقدار کل این ردیف؛ با تعداد سفارش عوض نمی‌شود"
              />
              <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-bold" title="مقدار کل این ردیف؛ با تعداد سفارش عوض نمی‌شود">کل</span>
            </>
          )}
          <select
            value={unit}
            onChange={(e) => onFields({ unit: e.target.value })}
            aria-label="واحد مقدار"
            className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-1 text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer"
          >
            {COMMON_UNITS.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {perUnit ? (
          <span className="text-[10px] text-slate-600">
            برای هر عدد؛ جمع سفارش: <span className="font-bold font-mono">{formatPersianNumber(total)}</span> {unit}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onFields(perUnitRowFields(perUnitQtyFromTotal(material.requiredQty !== undefined ? material.requiredQty : 1, orderQty), orderQty))}
            className="text-[10px] text-amber-800 hover:underline font-bold cursor-pointer"
            title="مقدار را برای هر عدد محصول بنویسید تا با تعداد سفارش حساب شود"
          >
            برای هر عدد
          </button>
        )}

        {hasUnitMismatch && (
          <button
            type="button"
            onClick={() => onOpenConversion(total)}
            className="inline-flex items-center gap-1 text-[10px] text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md font-bold shadow-2xs cursor-pointer transition-colors"
          >
            <Scale className="w-3 h-3 text-amber-700 shrink-0" />
            <span>تبدیل ({warehouseUnit})</span>
          </button>
        )}

        {converted ? (
          <span className="text-[10px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold font-mono">
            = {formatPersianNumber(converted)} {material.convertedUnit}
          </span>
        ) : null}
      </div>
    </td>
  );
}
