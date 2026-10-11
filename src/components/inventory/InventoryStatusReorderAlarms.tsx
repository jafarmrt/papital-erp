import { AlertTriangle, ArrowLeft, ShoppingCart } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import type { InventoryStatusAlarm } from '../../lib/reorderAlerts/inventoryStatusAlarms';

/**
 * v10.0.71 (TD-1158): the reorder alarm card and banner of the «وضعیت انبار» page. They show the reorder page's own list
 * (free stock against the reorder point); the page renders them only for a viewer who may open that page.
 */

interface AlarmProps {
  alarms: InventoryStatusAlarm[];
  onOpen: () => void;
}

export function ReorderAlarmCard({ alarms, onOpen }: AlarmProps) {
  const active = alarms.length > 0;
  return (
    <div className={`bg-white p-5 border rounded-2xl shadow-xs flex flex-col justify-between transition-colors ${active ? 'border-r-4 border-r-rose-500 bg-rose-50/20' : ''}`}>
      <div>
        <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
          <AlertTriangle size={14} className={active ? 'text-rose-500' : 'text-slate-400'} />
          اقلام نیازمند سفارش (هشدار)
        </p>
        <div className="flex items-end justify-between mt-2">
          <span className={`text-2xl font-black ${active ? 'text-rose-600' : 'text-slate-800'}`}>
            {formatPersianNumber(alarms.length)} <span className="text-xs font-sans text-slate-500">قلم</span>
          </span>
          {active && (
            <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
              اقدام فوری
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs">
        <span className="text-slate-400">موجودی آزاد زیر نقطه سفارش</span>
        <button onClick={onOpen} className="text-rose-600 font-bold hover:underline flex items-center gap-1 text-xs">
          مشاهده فهرست <ArrowLeft size={12} />
        </button>
      </div>
    </div>
  );
}

export function ReorderAlarmBanner({ alarms, onOpen }: AlarmProps) {
  if (alarms.length === 0) return null;
  const count = formatPersianNumber(alarms.length);
  return (
    <div className="bg-white border rounded-2xl overflow-hidden shadow-xs border-rose-200">
      <div className="p-4 bg-gradient-to-r from-rose-600 to-rose-500 text-white flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold shrink-0">
            <AlertTriangle size={20} className="animate-pulse text-amber-200" />
          </span>
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              هشدار آستانه موجودی انبار: {count} قلم کالا نیازمند سفارش
            </h3>
            <p className="text-xs text-rose-100 mt-0.5">
              موجودی آزاد (موجودی منهای رزروها) این اقلام به نقطه سفارش رسیده است؛ برای جلوگیری از توقف تولید یا فروش، آن‌ها را تأمین کنید.
            </p>
          </div>
        </div>
        <button
          onClick={onOpen}
          className="px-4 py-2.5 bg-white text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 shrink-0"
        >
          <ShoppingCart size={15} />
          مدیریت و چاپ فهرست تأمین ({count} قلم)
          <ArrowLeft size={14} />
        </button>
      </div>

      <div className="p-4 bg-rose-50/20 divide-y divide-rose-100">
        <div className="text-xs font-bold text-slate-500 mb-2 flex justify-between items-center">
          <span>پیش‌نمایش مهم‌ترین اقلام دارای کسری ({formatPersianNumber(Math.min(3, alarms.length))} مورد از {count} مورد):</span>
          <button onClick={onOpen} className="text-rose-600 hover:underline font-bold text-xs">
            مشاهده همه موارد ←
          </button>
        </div>
        {alarms.slice(0, 3).map(item => (
          <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">{item.code}</span>
              <span className="font-bold text-slate-800 truncate">{item.name}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.type === 'product' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                {item.type === 'product' ? 'محصول' : 'ماده اولیه'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono shrink-0">
              <div>
                <span className="text-slate-400 text-[10px] block font-sans">موجودی آزاد:</span>
                <span className="font-bold text-rose-600">{formatPersianNumber(item.freeStock)} {item.unit}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block font-sans">نقطه سفارش:</span>
                <span className="font-bold text-slate-700">{formatPersianNumber(item.reorderPoint)} {item.unit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
