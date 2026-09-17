import { FolderKanban } from 'lucide-react';
import { formatPersianNumber, formatPersianPrice } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';

interface ProjectCostSummaryItem {
  projectId: number | null;
  title: string;
  totalCost: number;
  logCount: number;
  personnelSet: Set<string>;
}

interface PieceworkProjectCostsTabProps {
  projectCostsSummary: ProjectCostSummaryItem[];
  totalLoggedAmount: number;
}

export function PieceworkProjectCostsTab({
  projectCostsSummary,
  totalLoggedAmount
}: PieceworkProjectCostsTabProps) {
  const appCurrency = useAppCurrency();
  return (
    <div className="space-y-4">
      {/* Overview Banner */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-slate-900">گزارش بهای تمام‌شده دستمزد پروژه‌ها (Project Labor Cost)</h3>
          <p className="text-[11px] text-slate-500">
            سهم هزینه‌های پرکیسی و دستمزد پرداخت‌شده مستقیم برای هر پروژه تولیدی کارگاه
          </p>
        </div>

        <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 text-indigo-900 font-bold text-xs">
          <span>کل هزینه کارکرد:</span>
          <span className="font-mono">{formatPersianPrice(totalLoggedAmount, appCurrency)}</span>
        </div>
      </div>

      {/* Projects Cost Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projectCostsSummary.map((item, idx) => {
          const sharePercent = totalLoggedAmount > 0 ? (item.totalCost / totalLoggedAmount) * 100 : 0;
          return (
            <div key={idx} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <FolderKanban size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-900">{item.title}</h4>
                    <span className="text-[10px] text-slate-400 font-normal">
                      {item.projectId ? `شناسه پروژه: ${item.projectId}` : 'هزینه‌های جاری کارگاه'}
                    </span>
                  </div>
                </div>

                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-mono font-bold">
                  {formatPersianNumber(sharePercent)}٪ سهم
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(sharePercent, 100)}%` }}
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs font-bold">
                <div className="flex justify-between text-slate-600">
                  <span>مجموع هزینه دستمزد:</span>
                  <span className="font-mono text-indigo-700 font-black">{formatPersianPrice(item.totalCost, appCurrency)}</span>
                </div>

                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>تعداد ردیف‌های کاری:</span>
                  <span className="font-mono">{formatPersianNumber(item.logCount)} ردیف</span>
                </div>

                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>تعداد پرسنل فعال در پروژه:</span>
                  <span className="font-mono">{formatPersianNumber(item.personnelSet.size)} نفر</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
