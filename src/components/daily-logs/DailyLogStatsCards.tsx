import { Clock, Building2, Laptop, AtSign, Printer, Plus } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { User } from '../../types';

interface DailyLogStatsCardsProps {
  user: User;
  stats: any;
  onPrint: () => void;
  onOpenCreateModal: () => void;
}

export function DailyLogStatsCards({
  user,
  stats,
  onPrint,
  onOpenCreateModal
}: DailyLogStatsCardsProps) {
  return (
    <>
      {/* Header & Page Title */}
      <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight">گزارش کار روزانه و فعالیت‌ها</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              ثبت سریع کارکرد روزانه، منشن همکاران، تقویم هجری شمسی و سطح دسترسی محرمانه
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onPrint}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            چاپ خروجی
          </button>
          <button
            onClick={onOpenCreateModal}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg flex items-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            ثبت گزارش کار جدید
          </button>
        </div>
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 print:hidden">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">کارکرد امروز من</p>
            <p className="text-base font-black text-slate-800">
              {formatPersianNumber(stats.today_hours)} <span className="text-[11px] font-normal text-slate-500">ساعت</span>
            </p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">گزارش‌های حضوری</p>
            <p className="text-base font-black text-slate-800">
              {formatPersianNumber(stats.onsite_count)} <span className="text-[11px] font-normal text-slate-500">مورد</span>
            </p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
            <Laptop className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">گزارش‌های دورکاری</p>
            <p className="text-base font-black text-slate-800">
              {formatPersianNumber(stats.remote_count)} <span className="text-[11px] font-normal text-slate-500">مورد</span>
            </p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold shrink-0">
            <AtSign className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400">منشن‌های من</p>
            <p className="text-base font-black text-slate-800">
              {formatPersianNumber(stats.my_mentions_count)} <span className="text-[11px] font-normal text-slate-500">مورد</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
