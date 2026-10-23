import { ArrowLeft, FolderTree, ShoppingCart } from 'lucide-react';
import { formatPersianNumber, toPersianDigits } from '../../../utils';

export type InventoryMainTab = 'control' | 'purchase';

/**
 * The materials tab's two views, «کنترل مواد اولیه» and «لیست نهایی خرید و تامین», with the count of rows to buy. 10.3
 * (ARCH review finding 3, part 11): moved out of `ProjectInventoryTab`.
 */
export function InventoryMainTabs({ activeMainTab, setActiveMainTab, purchaseCount }: {
  activeMainTab: InventoryMainTab;
  setActiveMainTab: (tab: InventoryMainTab) => void;
  purchaseCount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2 print:hidden">
      <div className="inline-flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveMainTab('control')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
            activeMainTab === 'control'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderTree className="w-4 h-4 text-amber-400" />
          <span>کنترل مواد اولیه (کد به کد + عمومی)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('purchase')}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
            activeMainTab === 'purchase'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>لیست نهایی خرید و تامین</span>
          {purchaseCount > 0 && (
            <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
              activeMainTab === 'purchase' ? 'bg-slate-950 text-amber-400' : 'bg-rose-500 text-white'
            }`}>
              {formatPersianNumber(purchaseCount)}
            </span>
          )}
        </button>
      </div>

      <span className="text-xs text-slate-500 hidden md:inline">
        {activeMainTab === 'control' 
          ? 'ساختار درختی محصولات برای کنترل کد به کد و جدول اقلام عمومی کل سفارش'
          : 'تجمیع هوشمند کسری‌های خرید کل پروژه جهت ثبت سفارش تامین'
        }
      </span>
    </div>
  );
}

/** the banner under the control view that says how many rows are to be bought and opens the purchase list */
export function PurchaseListBanner({ purchaseCount, onOpen }: { purchaseCount: number; onOpen: () => void }) {
  if (purchaseCount === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
          <ShoppingCart className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-bold text-xs text-amber-950">
            تعداد {toPersianDigits(purchaseCount)} قلم کالا دارای کسری موجودی یا نیاز به خرید شناسایی شد.
          </h4>
          <p className="text-[11px] text-amber-800 mt-0.5">
            کسری‌های استخراج‌شده از ساختار درختی و اقلام عمومی در لیست تجمیعی خرید آماده ثبت هستند.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-xs"
      >
        <span>مشاهده و مدیریت لیست خرید</span>
        <ArrowLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
