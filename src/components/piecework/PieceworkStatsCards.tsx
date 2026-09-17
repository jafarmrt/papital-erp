import { DollarSign, Clock, FileText, CheckCircle2 } from 'lucide-react';
import { formatPersianNumber, formatPersianPrice } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface PieceworkStatsCardsProps {
  totalLoggedAmount: number;
  pendingLoggedAmount: number;
  payrollsCount: number;
  tasksCount: number;
}

export function PieceworkStatsCards({
  totalLoggedAmount,
  pendingLoggedAmount,
  payrollsCount,
  tasksCount
}: PieceworkStatsCardsProps) {
  const appCurrency = useAppCurrency();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">مجموع کارکرد ثبت‌شده</span>
          <span className="text-lg font-black text-slate-900 mt-1 block font-mono">
            {formatPersianPrice(totalLoggedAmount, appCurrency)}
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <DollarSign size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">در انتظار تسویه و فیش</span>
          <span className="text-lg font-black text-amber-600 mt-1 block font-mono">
            {formatPersianPrice(pendingLoggedAmount, appCurrency)}
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <Clock size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">فیش‌های صادرشده</span>
          <span className="text-lg font-black text-emerald-600 mt-1 block font-mono">
            {formatPersianNumber(payrollsCount)} فیش
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <FileText size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">عناوین کاری فعال</span>
          <span className="text-lg font-black text-purple-600 mt-1 block font-mono">
            {formatPersianNumber(tasksCount)} عنوان
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
          <CheckCircle2 size={20} />
        </div>
      </div>
    </div>
  );
}
