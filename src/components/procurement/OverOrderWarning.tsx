import { AlertTriangle } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

export interface OverOrderedItem {
  key: string;
  itemName: string;
  unit: string;
  excess: number;
}

interface OverOrderWarningProps {
  items: OverOrderedItem[];
  reason: string;
  onReasonChange: (value: string) => void;
}

/**
 * v8.0.38 (TD-289، تصمیم مالک محصول — گزینه ب): هشدار سفارش بیش از مانده درخواست خرید و دلیل الزامی آن. سرور هم سفارش
 * بیش از مانده را بی‌دلیل رد می‌کند و دلیل را روی ردیف درخواست ثبت می‌کند.
 */
export function OverOrderWarning({ items, reason, onReasonChange }: OverOrderWarningProps) {
  if (items.length === 0) return null;
  return (
    <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-3 text-xs" role="alert">
      <div className="flex items-center gap-2 font-bold text-rose-800">
        <AlertTriangle className="w-4 h-4" />
        <span>سفارش بیش از درخواست</span>
      </div>
      <ul className="list-disc pr-5 space-y-1 text-rose-900">
        {items.map(it => (
          <li key={it.key}>
            «{it.itemName}»: {formatPersianNumber(it.excess)} {it.unit} بیش از مانده درخواست
          </li>
        ))}
      </ul>
      <label className="block font-bold text-rose-900">
        دلیل سفارش بیش از درخواست (الزامی):
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="مثال: حداقل تیراژ تامین‌کننده ۲۰ عدد است"
          className="mt-1 w-full p-2 bg-white border border-rose-300 rounded-lg text-slate-800 font-normal focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
      </label>
    </div>
  );
}
