import { Target, Plus, Briefcase, TrendingUp, CheckCircle2, Clock } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface CRMStatsCardsProps {
  stats: any;
  onOpenLeadModal: () => void;
}

export function CRMStatsCards({ stats, onOpenLeadModal }: CRMStatsCardsProps) {
  const appCurrency = useAppCurrency();
  return (
    <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-amber-400 shadow-inner shrink-0">
            <Target size={26} />
          </div>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              مدیریت ارتباط با مشتریان و قیف فروش (CRM)
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              ثبت کلیه پیگیری‌ها، تماس‌های تلفنی و مراحل مذاکرات فروش در پرونده مشتریان و فرصت‌ها
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={onOpenLeadModal}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 cursor-pointer"
          >
            <Plus size={18} />
            ایجاد پرونده فروش جدید
          </button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
        <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Briefcase size={20} />
          </div>
          <div>
            <p className="text-[11px] text-slate-400">فرصت‌های فعال</p>
            <p className="text-lg font-black text-white">{formatPersianNumber(stats?.activeLeadsCount || 0)} مورد</p>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="text-[11px] text-slate-400">ارزش کل قیف فروش</p>
            <p className="text-lg font-black text-amber-300">
              {formatPersianPrice(stats?.totalPipelineValue || 0)} <span className="text-[10px] text-slate-400 font-normal">{formatCurrencyLabel(appCurrency)}</span>
            </p>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-[11px] text-slate-400">معاملات بسته شده (موفق)</p>
            <p className="text-lg font-black text-emerald-400">{formatPersianNumber(stats?.wonLeadsCount || 0)} مورد</p>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700/60 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[11px] text-slate-400">پیگیری‌های امروز/معوقه</p>
            <p className="text-lg font-black text-rose-300">{formatPersianNumber(stats?.pendingFollowupsCount || 0)} کار</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CRMStatsCards;
