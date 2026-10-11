import { Search, Tag } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

/**
 * v7.0.140: سلول‌های مشترک ردیف ماده اولیه در کنترل موجودی پروژه — پیش‌تر در GlobalInventoryControlSection (اقلام
 * عمومی) و ProductTreeInventoryCards (اقلام هر محصول) تکرار شده بود.
 */
export type OpenUnitConversionModalHandler = (
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

/** نام، دسته و کد ماده با دکمه «اتصال انبار» */
export function MaterialNameCell({ displayCategory, effectiveName, effectiveCode, onLinkWarehouse }: {
  displayCategory: string;
  effectiveName: string;
  effectiveCode?: string;
  onLinkWarehouse: () => void;
}) {
  return (
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
          onClick={onLinkWarehouse}
          className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors shrink-0 cursor-pointer border border-slate-300 shadow-2xs"
          title="اتصال این ردیف به کالای موجود در انبار"
        >
          <Search className="w-3 h-3 text-slate-500" />
          <span>اتصال انبار</span>
        </button>
      </div>
    </td>
  );
}

/** موجودی فعلی انبار */
export function CurrentStockCell({ currentStock, unit }: { currentStock: number; unit: string }) {
  return (
    <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap border-l border-slate-100 align-middle">
      {currentStock > 0 ? (
        <span className="px-2 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-xs">
          {formatPersianNumber(currentStock)} {unit}
        </span>
      ) : (
        <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-xs">
          ۰ {unit}
        </span>
      )}
    </td>
  );
}

/** وضعیت تامین (موجود / نیاز به خرید) و کسری */
export function ProcurementStatusCell({ status, onChange, shortfall, unit }: {
  status: string;
  onChange: (status: string) => void;
  shortfall: number;
  unit: string;
}) {
  // v10.0.146 (TD-1214): a row short of stock needs procurement whatever was stored, so the list never says «موجود» beside a shortfall
  const shown = shortfall > 0 ? 'needs_procurement' : status;
  return (
    <td className="p-2.5 border-l border-slate-100 align-middle min-w-[190px]">
      <div className="flex flex-col gap-1">
        <select
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          className={`px-2 py-1 rounded-xl font-bold text-xs border focus:outline-none cursor-pointer w-full ${
            shown === 'available'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-amber-100 text-amber-950 border-amber-400'
          }`}
        >
          <option value="available" disabled={shortfall > 0}>✓ موجود در انبار</option>
          <option value="needs_procurement">⚠ نیاز به تامین / خرید</option>
        </select>
        {shortfall > 0 && (
          <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
            کسری خرید: {formatPersianNumber(shortfall)} {unit}
          </span>
        )}
      </div>
    </td>
  );
}

/** یادداشت ردیف */
export function NotesCell({ value, onChange }: { value: string; onChange: (notes: string) => void }) {
  return (
    <td className="p-2.5 border-l border-slate-100 align-middle">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="یادداشت..."
        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
      />
    </td>
  );
}
