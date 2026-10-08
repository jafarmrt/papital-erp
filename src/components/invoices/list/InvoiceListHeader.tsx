import { RefreshCw } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';

interface InvoiceListHeaderProps {
  totalItems: number;
  loading: boolean;
  loadData: () => void;
  pageSize: number;
  setPageSize: (size: number) => void;
}

/** TD-080 (بخش ۳): نوار عنوان جدول اسناد (تعداد کل، بارگذاری مجدد، تعداد ردیف هر صفحه) */
export function InvoiceListHeader({ totalItems, loading, loadData, pageSize, setPageSize }: InvoiceListHeaderProps) {
  return (
    <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white flex-wrap gap-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
          📄
        </div>
        <div>
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            فهرست اسناد، فاکتورها و رسیدهای انبار
          </h3>
          <p className="text-[11px] text-slate-500">
            مشاهده، پیگیری و گزارش‌گیری عددی و ریالی کلیه اسناد خرید، فروش و انبارداری
          </p>
        </div>
        <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full font-bold border border-slate-200 mr-2">
          {formatPersianNumber(totalItems)} سند ثبت‌شده
        </span>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <button
          onClick={loadData}
          title="بارگذاری مجدد"
          className="p-2 border border-slate-300 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="flex items-center gap-2 border-r border-slate-200 pr-3 mr-1">
          <label className="text-xs text-slate-500 font-medium">نمایش:</label>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          >
            <option value={25}>۲۵ ردیف</option>
            <option value={50}>۵۰ ردیف</option>
            <option value={100}>۱۰۰ ردیف</option>
          </select>
        </div>
      </div>
    </div>
  );
}
