import { useNavigate } from 'react-router-dom';
import {
  Package, Box, AlertTriangle, TrendingUp, DollarSign,
  Warehouse, RefreshCw,
  PlusCircle, FileText, Layers, Sparkles, LayoutDashboard
} from 'lucide-react';
import { formatPersianNumber } from '../utils';
import { useDashboardStatsQuery, useDashboardBIStatsQuery } from '../hooks/queries';
import { useRialDisplay } from '../hooks/useAppCurrency';
import { ErrorStateView } from '../components/common/ErrorStateView';
import { useViewerAccess } from '../contexts/AuthContext';
import { canOpenPage } from '../lib/permissions/pageAccess';
import { inventoryStatusShortcutsFor, type InventoryStatusShortcutIcon } from '../lib/inventory/inventoryStatusShortcuts';
import { canSeeInventoryStatusAlarms, inventoryStatusAlarmsOf } from '../lib/reorderAlerts/inventoryStatusAlarms';
import { useReorderAlertsQuery } from '../hooks/reorderAlerts/useReorderAlertsQueries';
import { ReorderAlarmBanner, ReorderAlarmCard } from '../components/inventory/InventoryStatusReorderAlarms';

/** TD-1157: icon and colour of each quick link */
const SHORTCUT_ICONS: Record<InventoryStatusShortcutIcon, { Icon: typeof Package; className: string }> = {
  products: { Icon: PlusCircle, className: 'text-emerald-400' },
  raw_materials: { Icon: Box, className: 'text-amber-400' },
  invoices: { Icon: FileText, className: 'text-purple-400' },
  projects: { Icon: Layers, className: 'text-cyan-400' },
  transfers: { Icon: Sparkles, className: 'text-purple-300' },
  reorder: { Icon: AlertTriangle, className: 'text-rose-400 animate-pulse' },
};

export default function InventoryStatusPage() {
  const navigate = useNavigate();
  const rial = useRialDisplay();
  const viewer = useViewerAccess();
  const shortcuts = inventoryStatusShortcutsFor(viewer);
  const showAlarms = canSeeInventoryStatusAlarms(viewer);
  const reorder = useReorderAlertsQuery({ enabled: showAlarms });
  const alarms = inventoryStatusAlarmsOf(reorder.items);
  const openReorderPage = () => navigate('/reorder-alerts');
  const { 
    data: stats, 
    isLoading: isStatsLoading, 
    isFetching: isStatsFetching,
    error: statsError, 
    refetch: refetchStats 
  } = useDashboardStatsQuery();

  const { 
    data: biStats, 
    isLoading: isBiLoading, 
    isFetching: isBiFetching,
    error: biError, 
    refetch: refetchBi 
  } = useDashboardBIStatsQuery();

  const loading = isStatsLoading || isBiLoading;
  const isRefreshing = isStatsFetching || isBiFetching;
  const error = statsError || biError ? 'گزارش تحلیلی انبار دریافت نشد. دوباره تلاش کنید.' : null;

  const loadData = () => {
    void refetchStats();
    void refetchBi();
    if (showAlarms) reorder.reload();
  };

  let locationTotal: number = 0;
  if (biStats && biStats.locationItemCounts) {
    locationTotal = Object.values(biStats.locationItemCounts).reduce<number>((sum, val) => sum + Number(val || 0), 0);
  }

  const getLocationPercentage = (val: number) => {
    if (!locationTotal) return 0;
    return Math.round((val / locationTotal) * 100);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Top Banner Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-5 border border-slate-200/80 rounded-3xl shadow-xs gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shadow-2xs">
              <Warehouse size={20} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">پیشخوان دیده‌بان و هوش تجاری انبار</h1>
              <p className="text-slate-500 text-xs mt-0.5">نمایی خلاصه از موجودی، جابجایی بار، ارزش مالی و هشدارهای انبار پاپیتال</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full lg:w-auto">
          <button
            onClick={() => navigate('/')}
            className="p-2.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-700 transition-colors flex items-center justify-center gap-2 text-xs font-bold shrink-0"
            title="بازگشت به پیشخوان شخصی"
          >
            <LayoutDashboard size={15} />
            <span>پیشخوان من</span>
          </button>

          <button 
            onClick={loadData}
            className="p-2.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center justify-center gap-2 text-xs font-semibold shrink-0"
            title="به‌روزرسانی داده‌ها"
          >
            <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">به‌روزرسانی گزارش‌ها</span>
          </button>
        </div>
      </div>

      {/* Quick Access Toolbar */}
      {shortcuts.length > 0 && (
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-3.5 rounded-2xl shadow-sm text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
          <span>⚡ میانبرهای عملیاتی انبار:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {shortcuts.map(shortcut => {
            const { Icon, className } = SHORTCUT_ICONS[shortcut.icon];
            const alarm = shortcut.icon === 'reorder';
            return (
              <button
                key={shortcut.path}
                onClick={() => navigate(shortcut.path)}
                className={alarm
                  ? 'px-3 py-1.5 bg-rose-500/30 hover:bg-rose-500/40 text-rose-200 border border-rose-400/30 rounded-xl font-bold transition-all flex items-center gap-1.5'
                  : 'px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5'}
              >
                <Icon size={14} className={className} />
                {shortcut.label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {error && (
        <ErrorStateView
          title="گزارش تحلیلی انبار دریافت نشد"
          description="در واکشی اطلاعات آماری انبار مشکلی رخ داده است. برای تلاش مجدد روی دکمه زیر کلیک نمایید."
          onRetry={loadData}
          compact
        />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="bg-white p-6 border rounded-2xl h-28 space-y-3">
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
              <div className="h-6 bg-slate-200 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Main Financial & Analytical KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* KPI 1: Value */}
            <div className="bg-white p-5 border rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between hover:border-blue-300 transition-colors">
              <div>
                <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
                  <DollarSign size={14} className="text-blue-500" />
                  ارزش کل موجودی انبار
                </p>
                <h3 className="text-xl font-black text-blue-600 mt-2 font-mono tracking-tight">
                  {biStats ? rial.number(biStats.totalValuation) : '۰'}
                  <span className="text-xs font-sans text-slate-500 font-normal mr-1">{rial.label}</span>
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs text-slate-400">
                <span className="flex items-center gap-1">بر پایه میانگین موزون بها</span>
                <span className="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full text-[10px]">ارزش زنده</span>
              </div>
            </div>

            {/* KPI 2: Reorder alerts (TD-1158: the reorder page's list, only for its readers) */}
            {showAlarms && <ReorderAlarmCard alarms={alarms} onOpen={openReorderPage} />}

            {/* KPI 3: Products & Materials */}
            <div className="bg-white p-5 border rounded-2xl shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors">
              <div>
                <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
                  <Package size={14} className="text-indigo-500" />
                  تنوع کالاها و مواد اولیه
                </p>
                <h3 className="text-lg font-black text-slate-800 mt-2">
                  {stats ? `${formatPersianNumber(stats.totalProducts)} محصول / ${formatPersianNumber(stats.totalMaterials)} مواد اولیه` : '-'}
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs text-slate-400">
                <span className="flex items-center gap-1">پایگاه‌داده انبار</span>
                <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-full text-[10px]">فعال</span>
              </div>
            </div>

            {/* KPI 4: 7 Days Output Flow */}
            <div className="bg-slate-900 text-slate-100 p-5 border border-slate-800 rounded-2xl shadow-xs flex flex-col justify-between">
              <div>
                <p className="text-xs text-slate-400 font-bold flex items-center gap-1">
                  <TrendingUp size={14} className="text-emerald-400" />
                  گردش اسناد (۷ روز اخیر)
                </p>
                <div className="flex items-end justify-between mt-2">
                  <span className="text-2xl font-black text-white font-mono">
                    {stats ? formatPersianNumber(stats.recentTx) : '۰'} <span className="text-xs font-sans text-slate-400">سند</span>
                  </span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                    پایش برخط
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
                <span>تراکنش‌های رسید و حواله</span>
                {canOpenPage('/transactions', viewer) && (
                  <button onClick={() => navigate('/transactions')} className="text-blue-400 hover:underline flex items-center gap-1">
                    جزئیات ←
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section: Multi-Location stocks */}
          <div>
            {/* Storage Distribution Column */}
            <div className="bg-white p-6 border rounded-2xl shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <Warehouse className="text-blue-500" size={18} />
                  تفکیک فیزیکی انبارها
                </h3>
                <p className="text-slate-400 text-xs mb-4 border-b pb-2">شمار اقلام دارای موجودی در هر انبار</p>

                {biStats ? (
                  <div className="space-y-4">
                    {biStats.warehouses?.map((w, index) => {
                      const qty = biStats.locationItemCounts?.[w.code] || 0;
                      const percentage = getLocationPercentage(qty);
                      const emojis = ["🔒", "⚒️", "💎", "📦", "🏪", "🏬", "🏢", "🏭"];
                      const bgColors = ["bg-indigo-600", "bg-orange-500", "bg-emerald-500", "bg-blue-500", "bg-purple-500", "bg-cyan-500", "bg-violet-500", "bg-rose-500"];
                      
                      const emoji = w.code === 'main' ? "🔒" : w.code === 'workshop' ? "⚒️" : w.code === 'showroom' ? "💎" : emojis[index % emojis.length];
                      const bgColor = w.code === 'main' ? "bg-indigo-600" : w.code === 'workshop' ? "bg-orange-500" : w.code === 'showroom' ? "bg-emerald-500" : bgColors[index % bgColors.length];

                      return (
                        <div key={w.code}>
                          <div className="flex justify-between text-xs font-bold mb-1.5">
                            <span className="text-slate-700">{emoji} {w.name}</span>
                            <span className="text-slate-500">{formatPersianNumber(qty)} قلم ({formatPersianNumber(percentage)}٪)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                            <div 
                              style={{ width: `${percentage}%` }}
                              className={`${bgColor} h-full rounded-full transition-all duration-500`}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-slate-400 text-xs text-center py-10">در حال محاسبه تفکیک انبار...</div>
                )}
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 mt-4 text-[11px] text-slate-500 leading-relaxed">
                💡 تمامی حواله‌ها و رسیدها به صورت مستقیم موجودی این انبارها را به‌روزرسانی می‌کنند.
              </div>
            </div>
          </div>

          {/* Reorder alerts banner (TD-1158) */}
          {showAlarms && <ReorderAlarmBanner alarms={alarms} onOpen={openReorderPage} />}
        </>
      )}
    </div>
  );
}
