import { FileInput, FileOutput, Lock } from 'lucide-react';

interface StockDocumentHeaderProps {
  actionType: 'in' | 'out';
  totalReservedItemsCount: number;
  onToggleReservations: () => void;
}

/** TD-080 (بخش ۳): سربرگ صفحه رسید/حواله انبار با نشان اقلام رزرو شده — استخراج‌شده از DocumentsPage */
export function StockDocumentHeader({ actionType, totalReservedItemsCount, onToggleReservations }: StockDocumentHeaderProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${
          actionType === 'in' 
            ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
            : 'bg-amber-50 text-amber-600 border-amber-200'
        }`}>
          {actionType === 'in' ? <FileInput size={26} /> : <FileOutput size={26} />}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black text-slate-900">ورود و خروج به انبار (رسید و حواله)</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
              actionType === 'in'
                ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                : 'bg-amber-100 text-amber-950 border-amber-300'
            }`}>
              {actionType === 'in' ? 'ثبت ورود کالا (رسید انبار)' : 'ثبت خروج کالا (حواله مصرف)'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            مدیریت تراکنش‌های انبار، صدور اسناد رسید ورود و حواله مصرف با محاسبه خودکار میانگین بهای خرید و صدور اسناد دوبل حسابداری.
          </p>
        </div>
      </div>

      {/* Global Warehouse Reservation Stats Badge */}
      <div className="flex items-center gap-2.5 self-start md:self-auto">
        <button
          type="button"
          onClick={onToggleReservations}
          className="flex items-center gap-2 px-3.5 py-2 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 rounded-xl text-purple-950 font-bold text-xs transition-all shadow-2xs group cursor-pointer"
        >
          <Lock size={15} className="text-purple-600 group-hover:scale-110 transition-transform" />
          <span>اقلام رزرو شده انبار ({totalReservedItemsCount} کالا)</span>
        </button>
      </div>
    </div>
  );
}
