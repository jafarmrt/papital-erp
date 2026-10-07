import { CheckCircle2, RefreshCw } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';

interface StockSubmitBarProps {
  actionType: 'in' | 'out';
  itemCount: number;
  totalQuantitySum: number;
  disabled: boolean;
  isSaving: boolean;
  /** v9.0.216 (TD-791): چرا کاربر این نوع سند را ثبت نمی‌کند (مجوز لازم)؛ null یعنی ثبت‌شدنی است */
  blockedReason?: string | null;
}

/** TD-080 (بخش ۳): نوار خلاصه و دکمه ثبت نهایی سند انبار — استخراج‌شده از DocumentsPage */
export function StockSubmitBar({ actionType, itemCount, totalQuantitySum, disabled, isSaving, blockedReason = null }: StockSubmitBarProps) {
  return (
    <div className="border-t border-slate-200 pt-5 flex items-center justify-between">
      <div className="text-xs text-slate-500 flex items-center gap-3">
        <span>تعداد اقلام سند: <strong className="text-slate-900 font-mono font-bold">{formatPersianNumber(itemCount)}</strong> ردیف</span>
        <span>مجموع تعداد: <strong className="text-slate-900 font-mono font-bold">{formatPersianNumber(totalQuantitySum)}</strong> واحد</span>
      </div>
      <div className="flex items-center gap-3">
      {blockedReason && <span role="note" className="text-xs font-bold text-amber-700">{blockedReason}</span>}
      <button 
        type="submit" 
        disabled={disabled} 
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer flex items-center gap-2"
      >
        {isSaving ? (
          <>
            <RefreshCw size={16} className="animate-spin" />
            <span>در حال ثبت سند...</span>
          </>
        ) : (
          <>
            <CheckCircle2 size={18} />
            <span>
              {actionType === 'in' ? 'ثبت نهایی و صدور سند رسید خرید' : 'ثبت نهایی و صدور حواله خروج'}
            </span>
          </>
        )}
      </button>
      </div>
    </div>
  );
}
