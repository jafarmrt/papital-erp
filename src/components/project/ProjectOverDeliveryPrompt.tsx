import { AlertTriangle } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

/** کالایی که سرور تحویلش را بیش از مقدار برنامه‌ریزی‌شده پروژه می‌داند (OVER_DELIVERY_REASON_REQUIRED) */
export interface ProjectOverDeliveryView {
  itemId: number;
  itemName: string;
  unit: string;
  planned: number;
  delivered: number;
  excess: number;
}

/** کالاهای تحویل اضافه از خطای سرور، یا null اگر خطا از این نوع نیست */
export function overDeliveriesOf(err: unknown): ProjectOverDeliveryView[] | null {
  const e = err as { code?: unknown; details?: { overDeliveries?: unknown } } | null;
  if (e?.code !== 'OVER_DELIVERY_REASON_REQUIRED') return null;
  return Array.isArray(e.details?.overDeliveries) ? e.details.overDeliveries as ProjectOverDeliveryView[] : [];
}

interface ProjectOverDeliveryPromptProps {
  items: ProjectOverDeliveryView[];
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

/**
 * v8.0.52 (TD-327، تصمیم مالک محصول — گزینه ب «با دلیل»): تحویلی که جمع تحویل‌های پروژه را از مقدار برنامه‌ریزی‌شده بیشتر
 * کند فقط با دلیل ثبت می‌شود؛ سرور بی‌دلیل رد می‌کند و این کادر فهرست کالاها و دلیل را می‌گیرد و همان تحویل را دوباره
 * می‌فرستد.
 */
export function ProjectOverDeliveryPrompt({ items, reason, onReasonChange, onConfirm, onCancel, submitting }: ProjectOverDeliveryPromptProps) {
  return (
    <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-3 text-xs" role="alert">
      <div className="flex items-center gap-2 font-bold text-rose-800">
        <AlertTriangle className="w-4 h-4" />
        <span>تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه</span>
      </div>
      <ul className="list-disc pr-5 space-y-1 text-rose-900">
        {items.map(it => (
          <li key={it.itemId}>
            «{it.itemName || it.itemId}»: {formatPersianNumber(it.excess)} {it.unit} بیش از برنامه (برنامه {formatPersianNumber(it.planned)}، تحویل‌شده {formatPersianNumber(it.delivered)})
          </li>
        ))}
      </ul>
      <label className="block font-bold text-rose-900">
        دلیل تحویل بیش از برنامه (الزامی):
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="مثال: مشتری ۲ عدد اضافه سفارش داد"
          className="mt-1 w-full p-2 bg-white border border-rose-300 rounded-lg text-slate-800 font-normal focus:outline-none focus:ring-2 focus:ring-rose-400"
        />
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold disabled:opacity-50">
          انصراف
        </button>
        <button type="button" onClick={onConfirm} disabled={submitting || !reason.trim()}
          className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold disabled:opacity-50">
          {submitting ? 'در حال ثبت…' : 'ثبت تحویل با دلیل'}
        </button>
      </div>
    </div>
  );
}
