import { Check, RefreshCw } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

/**
 * v10.0.142 (TD-1201): نوار «ذخیره یکجای تمام تغییرات» صفحه قیمت‌گذاری. پیش‌تر `fixed` بود و در پایین پنجره روی دکمه
 * ذخیره کارت ردیف اول می‌نشست؛ اکنون `sticky` در جریان صفحه پس از فهرست است: در فهرست کوتاه زیر کارت‌ها می‌ماند و در فهرست
 * بلند هنگام پیمایش پایین پنجره می‌چسبد، و در پایان پیمایش جای خودش را دارد، پس هیچ دکمه‌ای زیرش پنهان نمی‌ماند.
 */
export function UnsavedPriceEditsBar({ count, isSaving, onCancel, onSaveAll }: {
  count: number;
  isSaving: boolean;
  onCancel: () => void;
  onSaveAll: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div
      data-testid="unsaved-price-edits-bar"
      className="sticky bottom-4 self-center bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl z-40 flex flex-wrap items-center gap-4 border border-slate-700 animate-in slide-in-from-bottom duration-200"
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
        <span className="text-xs font-bold">
          تعداد {formatPersianNumber(count)} فیلد قیمت ویرایش شده و ذخیره‌نشده است.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg cursor-pointer"
        >
          انصراف
        </button>
        <button
          onClick={onSaveAll}
          disabled={isSaving}
          className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold px-4 py-2 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
        >
          {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
          ذخیره یکجای تمام تغییرات
        </button>
      </div>
    </div>
  );
}
