import { Search, Tag } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { rowNeedsAttention, type MaterialAvailabilityStatus, type MaterialRowState } from '../../lib/projects/materialAvailability';

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

const PROCUREMENT_LABELS: Record<string, string> = {
  reserved: 'رزرو انبار',
  fulfilled: 'تحویل‌شده',
};

/** متن ردیفی که ارقام آزاد آن خوانده نشده */
const unknownText = (status: MaterialAvailabilityStatus): string => (status === 'error' ? 'نامعلوم' : 'در حال خواندن…');

/**
 * v10.2.0 (TD-1289، یافتهٔ D1): «آزاد برای این پروژه»: موجودی کل منهای رزرو پیش‌فاکتورهای فروش و پروژه‌های دیگر، همان رقمی
 * که ثبت نهایی با آن رزرو می‌کند، و آنچه تاکنون به این پروژه داده شده. پیش‌تر موجودی کل انبار نشان داده می‌شد.
 */
export function FreeStockCell({ state, status }: { state: MaterialRowState; status: MaterialAvailabilityStatus }) {
  if (state.kind === 'unknown' || state.kind === 'unmatched') {
    return (
      <td className="p-2.5 text-center whitespace-nowrap border-l border-slate-100 align-middle">
        <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 text-xs">
          {state.kind === 'unmatched' ? 'بی کالای انبار' : unknownText(status)}
        </span>
      </td>
    );
  }
  return (
    <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap border-l border-slate-100 align-middle">
      <div className="flex flex-col items-center gap-1">
        <span className={`px-2 py-1 rounded-lg border text-xs ${state.free > 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {formatPersianNumber(state.free)} {state.unit}
        </span>
        {state.issued > 0 && (
          <span className="text-[10px] font-normal text-slate-500">داده‌شده به پروژه: {formatPersianNumber(state.issued)} {state.unit}</span>
        )}
      </div>
    </td>
  );
}

const STATUS_BADGE: Record<Exclude<MaterialRowState['kind'], 'unknown'>, { text: string; className: string }> = {
  available: { text: '✓ موجود', className: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  short: { text: '⚠ کسری', className: 'bg-rose-50 text-rose-700 border-rose-300' },
  unit_mismatch: { text: '⚠ تبدیل واحد لازم', className: 'bg-amber-100 text-amber-950 border-amber-400' },
  unmatched: { text: '⚠ بی کالای انبار', className: 'bg-amber-100 text-amber-950 border-amber-400' },
};

/**
 * v10.2.0 (TD-1289، یافتهٔ D1): وضعیت «موجود / کسری» خودکار است و از قاعدهٔ ثبت نهایی می‌آید؛ کاربر فقط «در حال سفارش» را
 * برای ردیف کسری یا ردیفی که پیش‌تر سفارش داده شده می‌گذارد. پیش‌تر وضعیت ردیف فهرستی دستی بود و می‌شد «موجود» گذاشت.
 */
export function MaterialStatusCell({ state, status, procurementStatus, onProcurementChange }: {
  state: MaterialRowState;
  status: MaterialAvailabilityStatus;
  procurementStatus?: string;
  onProcurementChange: (procurementStatus: 'pending' | 'in_progress') => void;
}) {
  const badge = state.kind === 'unknown'
    ? { text: unknownText(status), className: 'bg-slate-100 text-slate-500 border-slate-200' }
    : STATUS_BADGE[state.kind];
  const fixedProcurement = procurementStatus ? PROCUREMENT_LABELS[procurementStatus] : undefined;
  const showOrder = !fixedProcurement && (rowNeedsAttention(state) || procurementStatus === 'in_progress');
  return (
    <td className="p-2.5 border-l border-slate-100 align-middle min-w-[190px]">
      <div className="flex flex-col gap-1">
        <span className={`px-2 py-1 rounded-xl font-bold text-xs border text-center ${badge.className}`}>{badge.text}</span>
        {state.kind === 'short' && (
          <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-center">
            کسری کل پروژه: {formatPersianNumber(state.shortQty)} {state.unit}
          </span>
        )}
        {fixedProcurement && (
          <span className="text-[10px] font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-center">{fixedProcurement}</span>
        )}
        {showOrder && (
          <select
            value={procurementStatus === 'in_progress' ? 'in_progress' : 'pending'}
            onChange={(e) => onProcurementChange(e.target.value === 'in_progress' ? 'in_progress' : 'pending')}
            aria-label="وضعیت سفارش"
            className="px-2 py-1 rounded-xl font-bold text-[11px] border border-slate-300 bg-white text-slate-700 focus:outline-none cursor-pointer w-full"
          >
            <option value="pending">سفارش داده نشده</option>
            <option value="in_progress">در حال سفارش</option>
          </select>
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
