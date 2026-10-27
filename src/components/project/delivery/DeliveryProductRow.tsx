import { CheckSquare, Square, AlertCircle, DollarSign, RefreshCw, ArrowDownRight } from 'lucide-react';
import type { Item, ProjectProductItem } from '../../../types';
import { formatPersianNumber, toPersianDigits, formatPersianCode } from '../../../utils';
import { DecimalInput } from '../../common/DecimalInput';
import type { ProjectDelivery } from './useProjectDelivery';

interface DeliveryProductRowProps {
  product: ProjectProductItem;
  index: number;
  /** the project's own item, for a product row without one */
  projectItemId: number | null | undefined;
  /** the catalog row of the product's item, for its weighted average cost and stock */
  catalogItem: Item | null | undefined;
  delivery: ProjectDelivery;
}

/** one product of the delivery tab: its selection, item and stock, the quantity and unit cost to deliver, and «ورود به انبار» */
export function DeliveryProductRow({ product: p, index: idx, projectItemId, catalogItem: catItem, delivery }: DeliveryProductRowProps) {
  const { selectedIds, setSelectedIds, targetLocation, producedQuantities, unitCosts, handleQtyChange, handleCostChange, computedCostOf, canDeliver, submitting, batchSubmitting, handleAddToInventory } = delivery;
  const isSelected = selectedIds.has(p.id);
  const hasCatalogLink = Boolean(p.item_id || projectItemId);
  const defaultWac = catItem?.weightedAverageCost || catItem?.costPrice || 0;
  const enteredCost = unitCosts[p.id];
  // v11 phase 6.1ث (decision ت۵۲-۳): an empty field posts the cost the server computes from the project's 1402, shown as its hint
  const computedCost = computedCostOf(p);
  const currentStockInLoc = catItem?.stocks && targetLocation ? (catItem.stocks as Record<string, number>)[targetLocation] || 0 : catItem?.currentStock || 0;
  const toggleSelect = () => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(p.id)) next.delete(p.id);
    else next.add(p.id);
    return next;
  });

  return (
    <div
      className={`bg-white p-3.5 rounded-2xl border transition-all shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
        isSelected ? 'border-amber-400 bg-amber-50/20' : 'border-slate-200/90 hover:border-slate-300'
      }`}
    >
      {/* Product Info */}
      <div className="flex items-center gap-3 min-w-[260px]">
        <button type="button" onClick={toggleSelect} className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0">
          {isSelected ? <CheckSquare className="w-4 h-4 text-amber-600" /> : <Square className="w-4 h-4 text-slate-300" />}
        </button>

        <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
          {formatPersianNumber(idx + 1)}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-900 text-xs">{p.item_name}</p>
            {p.customer_code && (
              <span className="text-[10px] font-mono text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 font-bold" title="کد مشتری">
                {p.customer_code}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
            {hasCatalogLink ? (
              <span className="flex items-center gap-1">
                کد انبار: <strong className="font-mono text-slate-700">{formatPersianCode(p.item_code) || formatPersianCode(catItem?.code)}</strong>
              </span>
            ) : (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> فاقد اتصال انبار
              </span>
            )}
            <span>
              • موجودی فعلی در انبار {targetLocation}: <strong className="font-mono text-slate-800">{toPersianDigits(currentStockInLoc)} {p.unit || 'عدد'}</strong>
            </span>
            <span>
              • سفارش کل: <strong className="font-mono text-slate-700">{toPersianDigits(p.quantity)} {p.unit || 'عدد'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Entry Inputs: Quantity & Unit Cost Basis */}
      <div className="flex flex-wrap items-center gap-3 self-end lg:self-center">
        {/* Delivered Quantity */}
        <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
          <span className="text-slate-600 font-semibold text-[11px]">تعداد تحویلی:</span>
          <DecimalInput
            min="1"
            value={producedQuantities[p.id] ? producedQuantities[p.id] : ''}
            onValueChange={(v) => handleQtyChange(p.id, Number(v) || 0)}
            className="w-20 px-1.5 py-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none"
          />
          <span className="text-slate-500 font-semibold text-[11px]">{p.unit || 'عدد'}</span>
        </div>

        {/* Unit Cost Basis (Optional WAC Override) */}
        <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200" title="خالی بماند تا بهای واقعی تولید از کالای در جریان ساخت پروژه ثبت شود؛ بهای دیگر دلیل می‌خواهد">
          <DollarSign className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-600 font-semibold text-[11px]">بهای واحد:</span>
          <DecimalInput
            min="0"
            step="any"
            placeholder={computedCost !== null ? `بهای واقعی: ${formatPersianNumber(computedCost, 4)}` : defaultWac > 0 ? `میانگین موزون بها: ${toPersianDigits(defaultWac)}` : 'بهای واقعی'}
            value={enteredCost !== undefined && enteredCost > 0 ? enteredCost : ''}
            onValueChange={(v) => handleCostChange(p.id, Number(v) || 0)}
            className="w-24 px-1.5 py-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none placeholder:text-slate-400"
          />
          <span className="text-slate-400 text-[10px]">ریال</span>
        </div>

        {/* Single Delivery Button */}
        {canDeliver && (
          <button
            type="button"
            onClick={() => void handleAddToInventory(p)}
            disabled={submitting || batchSubmitting}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 transition-all shadow-2xs hover:shadow disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            <span>ورود به انبار</span>
          </button>
        )}
      </div>
    </div>
  );
}
