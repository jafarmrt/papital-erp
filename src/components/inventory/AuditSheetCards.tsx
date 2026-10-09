import { ClipboardCheck } from 'lucide-react';
import { formatPersianNumber, parseCleanNumber } from '../../utils';
import { auditCountError } from '../../lib/inventoryAudit/auditSheet';
import { OFFLINE_SUBMIT_TITLE, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';

/**
 * v10.0.19 (D-11، طرح MOBILE_WORKSHOP_PLAN.md بخش ۳.۲): اجزای برگه شمارش انبار که جدول رایانه و کارت‌های گوشی با هم دارند.
 * خانه شمار صفحه‌کلید عددی گوشی را باز می‌کند و رقم فارسی را نگه می‌دارد؛ شماری که عدد نیست زیر همان خانه گفته می‌شود.
 */

export interface AuditCardItem {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  system_stock_computed: number;
  physical_stock: string;
}

interface CountInputProps {
  item: AuditCardItem;
  onChange: (itemId: number, value: string) => void;
}

export function AuditCountInput({ item, onChange }: CountInputProps) {
  const error = auditCountError(item.physical_stock);
  return (
    <div>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`شمار ${item.name}`}
        aria-invalid={error !== null}
        placeholder="عدد شمارش شده..."
        value={item.physical_stock}
        onChange={(e) => onChange(item.id, e.target.value)}
        className={`w-full ${PHONE_TAP_TARGET} p-2 bg-white border rounded-xl text-center font-mono font-bold text-base sm:text-xs text-emerald-900 outline-none focus:ring-2 focus:ring-emerald-500 ${error ? 'border-rose-400' : 'border-emerald-300'}`}
      />
      {error && <p className="mt-1 text-[11px] font-bold text-rose-600">{error}</p>}
    </div>
  );
}

/** مغایرت شمار با موجودی دفتری؛ خانه خالی یا نادرست مغایرتی ندارد */
export function AuditVariance({ item }: { item: AuditCardItem }) {
  const text = String(item.physical_stock ?? '').trim();
  if (text === '' || auditCountError(text) !== null) return <span className="text-slate-300">-</span>;
  const diff = parseCleanNumber(text, 0) - item.system_stock_computed;
  if (diff === 0) return <span className="text-emerald-600">بدون مغایرت (۰)</span>;
  if (diff > 0) return <span className="text-blue-600 font-bold dir-ltr inline-block">+{formatPersianNumber(diff)} (اضافی)</span>;
  return <span className="text-rose-600 font-bold dir-ltr inline-block">−{formatPersianNumber(Math.abs(diff))} (کسری)</span>;
}

interface SubmitProps {
  auditedCount: number;
  submitting: boolean;
  online: boolean;
  hasInvalid: boolean;
  onSubmit: () => void;
  className?: string;
}

/** دکمه ثبت نهایی؛ بی اتصال یا با شمار نادرست غیرفعال است */
export function AuditSubmitButton({ auditedCount, submitting, online, hasInvalid, onSubmit, className = '' }: SubmitProps) {
  return (
    <button
      type="button"
      disabled={submitting || auditedCount === 0 || hasInvalid || !online}
      title={!online ? OFFLINE_SUBMIT_TITLE : hasInvalid ? 'شمار نادرست را درست کنید.' : undefined}
      onClick={onSubmit}
      className={`${PHONE_TAP_TARGET} px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm sm:text-xs font-bold rounded-xl transition-colors shadow-md disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 ${className}`}
    >
      <ClipboardCheck size={16} />
      <span>{submitting ? 'در حال ثبت...' : `ثبت نهایی سند انبارگردانی (${formatPersianNumber(auditedCount)} کالا)`}</span>
    </button>
  );
}

interface CardListProps {
  items: AuditCardItem[];
  onChange: (itemId: number, value: string) => void;
}

/** روی گوشی (کمتر از ۷۶۸ پیکسل) هر کالا یک کارت است */
export function AuditSheetCardList({ items, onChange }: CardListProps) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-slate-400 text-sm font-medium">هیچ کالایی برای شمارش فیزیکی یافت نشد.</p>;
  }
  return (
    <ul aria-label="کالاهای شمارش" className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 text-sm">{item.name}</div>
              <div className="text-xs text-slate-500">{item.category}</div>
            </div>
            <span className="shrink-0 font-mono font-bold text-xs text-slate-700">{item.code}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">موجودی دفتری</span>
            <span className="font-mono font-bold text-blue-900">{formatPersianNumber(item.system_stock_computed)} {item.unit || 'عدد'}</span>
          </div>
          <AuditCountInput item={item} onChange={onChange} />
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">مغایرت</span>
            <span className="font-mono font-bold"><AuditVariance item={item} /></span>
          </div>
        </li>
      ))}
    </ul>
  );
}
