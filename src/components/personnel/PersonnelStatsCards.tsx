import { Users, CheckCircle2, XCircle, UserCheck } from 'lucide-react';
import { formatPersianNumber } from '../../utils';

interface PersonnelStatsCardsProps {
  stats: {
    total: number;
    active: number;
    terminated: number;
    onLeave: number;
    usersCount: number;
  };
}

export function PersonnelStatsCards({ stats }: PersonnelStatsCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">کل پرسنل</span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {formatPersianNumber(stats.total)} نفر
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
          <Users size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">همکاری فعال</span>
          <span className="text-xl font-black text-emerald-600 mt-1 block">
            {formatPersianNumber(stats.active)} نفر
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <CheckCircle2 size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">قطع همکاری</span>
          <span className="text-xl font-black text-rose-600 mt-1 block">
            {formatPersianNumber(stats.terminated)} نفر
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
          <XCircle size={20} />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-500 font-bold block">دارای حساب سامانه</span>
          <span className="text-xl font-black text-blue-600 mt-1 block">
            {formatPersianNumber(stats.usersCount)} نفر
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <UserCheck size={20} />
        </div>
      </div>
    </div>
  );
}
