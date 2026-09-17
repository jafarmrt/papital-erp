import React from 'react';
import { Clock, AlertTriangle, CheckCircle2, Activity, TrendingDown, ShieldAlert } from 'lucide-react';
import { useWorkflowSlaAnalyticsQuery } from '../../hooks/queries/useWorkflowQueries';

export const WorkflowSlaAnalyticsTab: React.FC = () => {
  const { data, isLoading, refetch } = useWorkflowSlaAnalyticsQuery();

  if (isLoading) {
    return (
      <div className="p-12 text-center text-gray-500 dark:text-gray-400">
        در حال محاسبه شاخص‌های SLA و تحلیل زمان‌سنجی فرآیندها...
      </div>
    );
  }

  const kpi = data?.kpi || {
    totalInstances: 0,
    activeInstances: 0,
    completedInstances: 0,
    overdueInstancesCount: 0,
    slaComplianceRate: 100,
    bottleneckState: 'بدون گلوگاه'
  };

  const overdueList = data?.overdueInstances || [];
  const stateSlaReport = data?.stateSlaReport || [];

  return (
    <div className="space-y-6">
      {/* Top Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: SLA Compliance */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>نرخ رعایت SLA</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">
              {kpi.slaComplianceRate}%
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              kpi.slaComplianceRate >= 90 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
            }`}>
              {kpi.slaComplianceRate >= 90 ? 'مطلوب' : 'نیازمند بررسی'}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full ${kpi.slaComplianceRate >= 90 ? 'bg-emerald-500' : 'bg-rose-500'}`} 
              style={{ width: `${Math.min(100, Math.max(0, kpi.slaComplianceRate))}%` }}
            />
          </div>
        </div>

        {/* KPI 2: Active Instances */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>فرآیندهای فعال</span>
            <Activity className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">
              {kpi.activeInstances}
            </span>
            <span className="text-xs text-gray-500">از مجموع {kpi.totalInstances}</span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">تعداد کارهای فعال در کارتابل‌ها</p>
        </div>

        {/* KPI 3: Overdue Instances */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>اسناد دارای تاخیر SLA</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
              {kpi.overdueInstancesCount}
            </span>
            <span className="text-xs bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 px-2 py-0.5 rounded">
              عبور از مهلت
            </span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">اسنادی که زمان توقف بیشتر از SLA دارند</p>
        </div>

        {/* KPI 4: Top Bottleneck */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
            <span>گلوگاه اصلی فرآیندها</span>
            <TrendingDown className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-lg font-bold text-gray-900 dark:text-white truncate">
            {kpi.bottleneckState}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">بیشترین زمان توقف و بیشترین تراکم کارها</p>
        </div>
      </div>

      {/* State SLA & Bottleneck Analysis Grid */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between border-b pb-3 border-gray-200 dark:border-gray-700">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>تحلیل میانگین زمان توقف و وضعیت گلوگاه‌ها (State Analytics)</span>
          </h3>
          <button 
            onClick={() => refetch()}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            بروزرسانی داده‌ها
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stateSlaReport.map((st: any) => (
            <div 
              key={st.stateId} 
              className={`p-4 rounded-xl border transition-all shadow-xs ${
                st.isBottleneck 
                  ? 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800/60' 
                  : 'bg-gray-50/50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm text-gray-900 dark:text-white">
                  {st.stateTitle}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  st.isBottleneck 
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200' 
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                }`}>
                  {st.isBottleneck ? 'گلوگاه (Bottleneck)' : 'روان و استاندارد'}
                </span>
              </div>

              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300 pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="flex justify-between">
                  <span>میانگین زمان توقف:</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {st.avgDurationHours} ساعت
                  </span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>سقف مجاز SLA:</span>
                  <span className="font-mono">{st.slaHours} ساعت</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>کارهای فعال فعلی:</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                    {st.activeCount} مورد
                  </span>
                </div>
                {st.overdueCount > 0 && (
                  <div className="flex justify-between text-rose-600 dark:text-rose-400 font-bold">
                    <span>موارد معوقه (Overdue):</span>
                    <span className="font-mono">{st.overdueCount} مورد</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Overdue Items List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between border-b pb-3 border-gray-200 dark:border-gray-700">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            <span>فهرست اسناد در حال جریان با تاخیر غیرمجاز SLA</span>
          </h3>
          <span className="text-xs bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 px-2.5 py-0.5 rounded-full font-mono">
            {overdueList.length} مورد معوقه
          </span>
        </div>

        {overdueList.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-xs">
            🎉 عالی است! تمامی اسناد در جریان طبق زمان‌بندی مجاز SLA مدیریت شده‌اند و هیچ سند معوقه‌ای وجود ندارد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="p-3">نوع و کد موجودیت</th>
                  <th className="p-3">وضعیت فعلی</th>
                  <th className="p-3">زمان توقف فعلی</th>
                  <th className="p-3">سقف SLA</th>
                  <th className="p-3">میزان تاخیر (مازاد)</th>
                  <th className="p-3">ایجادکننده</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {overdueList.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-rose-50/20 dark:hover:bg-rose-950/10">
                    <td className="p-3 font-medium font-mono text-gray-900 dark:text-white">
                      {item.entityType === 'document' ? 'فاکتور / سند' : item.entityType === 'project' ? 'پروژه تولید' : 'ماده اولیه'}: #{item.entityId}
                    </td>
                    <td className="p-3">
                      <span className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded">
                        {item.stateTitle}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-rose-600 dark:text-rose-400">
                      {item.hoursInState} ساعت
                    </td>
                    <td className="p-3 font-mono text-gray-500">
                      {item.slaHours} ساعت
                    </td>
                    <td className="p-3 font-mono font-bold text-rose-600">
                      +{item.excessHours} ساعت
                    </td>
                    <td className="p-3 text-gray-600 dark:text-gray-400">
                      {item.startedByName || 'کاربر سیستم'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
