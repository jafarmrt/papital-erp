import { useNavigate } from 'react-router-dom';
import {
  Package, Box, AlertTriangle, TrendingUp, DollarSign,
  Warehouse, RefreshCw, ArrowLeft, ShoppingCart,
  PlusCircle, FileText, Layers, Sparkles, LayoutDashboard
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatCurrencyLabel } from '../utils';
import { useDashboardStatsQuery, useDashboardBIStatsQuery } from '../hooks/queries';
import { useAppCurrency } from '../hooks/useAppCurrency';
import { ErrorStateView } from '../components/common/ErrorStateView';

export default function InventoryStatusPage() {
  const navigate = useNavigate();
  const appCurrency = useAppCurrency();
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
  const error = statsError || biError ? 'خطا در دریافت اطلاعات داشبورد تحلیلی' : null;

  const loadData = () => {
    refetchStats();
    refetchBi();
  };

  let locationTotal: number = 0;
  if (biStats && biStats.locations) {
    locationTotal = Object.values(biStats.locations).reduce<number>((sum, val) => sum + Number(val || 0), 0);
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
            title="بازگشت به داشبورد شخصی"
          >
            <LayoutDashboard size={15} />
            <span>داشبورد میز کار من</span>
          </button>

          <button 
            onClick={loadData}
            className="p-2.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center justify-center gap-2 text-xs font-semibold shrink-0"
            title="بروزرسانی داده‌ها"
          >
            <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">بروزرسانی گزارشات</span>
          </button>
        </div>
      </div>

      {/* Quick Access Toolbar */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-3.5 rounded-2xl shadow-sm text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
          <span>⚡ میانبرهای عملیاتی انبار:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => navigate('/products')}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5"
          >
            <PlusCircle size={14} className="text-emerald-400" />
            تعریف کالا
          </button>
          <button
            onClick={() => navigate('/products?type=raw_material')}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5"
          >
            <Box size={14} className="text-amber-400" />
            تعریف مواد اولیه
          </button>
          <button
            onClick={() => navigate('/invoices')}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5"
          >
            <FileText size={14} className="text-purple-400" />
            صدور فاکتور / خروج
          </button>
          <button
            onClick={() => navigate('/projects')}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5"
          >
            <Layers size={14} className="text-cyan-400" />
            پروژه‌های تولید
          </button>
          <button
            onClick={() => navigate('/transfers')}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-1.5"
          >
            <Sparkles size={14} className="text-purple-300" />
            کدهای ترنسفر
          </button>
          <button
            onClick={() => navigate('/reorder-alerts')}
            className="px-3 py-1.5 bg-rose-500/30 hover:bg-rose-500/40 text-rose-200 border border-rose-400/30 rounded-xl font-bold transition-all flex items-center gap-1.5"
          >
            <AlertTriangle size={14} className="text-rose-400 animate-pulse" />
            هشدار نقطه سفارش
          </button>
        </div>
      </div>

      {error && (
        <ErrorStateView
          title="خطا در دریافت اطلاعات داشبورد تحلیلی انبار"
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
                  {biStats ? formatPersianPrice(biStats.totalValuation) : '۰'}
                  <span className="text-xs font-sans text-slate-500 font-normal mr-1">{formatCurrencyLabel(appCurrency)}</span>
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs text-slate-400">
                <span className="flex items-center gap-1">میانگین بهای خرید</span>
                <span className="text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full text-[10px]">ارزش زنده</span>
              </div>
            </div>

            {/* KPI 2: Reorder alerts */}
            <div className={`bg-white p-5 border rounded-2xl shadow-xs flex flex-col justify-between transition-colors ${biStats && biStats.reorderAlarms.length > 0 ? "border-r-4 border-r-rose-500 bg-rose-50/20" : ""}`}>
              <div>
                <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
                  <AlertTriangle size={14} className={biStats && biStats.reorderAlarms.length > 0 ? "text-rose-500" : "text-slate-400"} />
                  اقلام نیازمند سفارش (آلارم)
                </p>
                <div className="flex items-end justify-between mt-2">
                  <span className={`text-2xl font-black ${biStats && biStats.reorderAlarms.length > 0 ? "text-rose-600" : "text-slate-800"}`}>
                    {biStats ? formatPersianNumber(biStats.reorderAlarms.length) : '۰'} <span className="text-xs font-sans text-slate-500">قلم</span>
                  </span>
                  {biStats && biStats.reorderAlarms.length > 0 && (
                    <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
                      اقدام فوری
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs">
                <span className="text-slate-400">زیر نقطه بحرانی</span>
                <button 
                  onClick={() => navigate('/reorder-alerts')}
                  className="text-rose-600 font-bold hover:underline flex items-center gap-1 text-xs"
                >
                  مشاهده لیست <ArrowLeft size={12} />
                </button>
              </div>
            </div>

            {/* KPI 3: Products & Materials */}
            <div className="bg-white p-5 border rounded-2xl shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors">
              <div>
                <p className="text-xs text-slate-500 font-bold flex items-center gap-1">
                  <Package size={14} className="text-indigo-500" />
                  تنوع کالاها و مواد اولیه
                </p>
                <h3 className="text-lg font-black text-slate-800 mt-2">
                  {stats ? `${formatPersianNumber(stats.totalProducts)} محصول / ${formatPersianNumber(stats.totalMaterials)} متریال` : '-'}
                </h3>
              </div>
              <div className="mt-4 pt-3 border-t flex justify-between items-center text-xs text-slate-400">
                <span className="flex items-center gap-1">بانک اطلاعاتی انبار</span>
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
                <button onClick={() => navigate('/transactions')} className="text-blue-400 hover:underline flex items-center gap-1">
                  جزئیات ←
                </button>
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
                <p className="text-slate-400 text-xs mb-4 border-b pb-2">سهم هر انبار از مجموع اقلام ذخیره‌شده</p>

                {biStats ? (
                  <div className="space-y-4">
                    {biStats.warehouses?.map((w, index) => {
                      const qty = biStats.locations[w.code] || 0;
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
                💡 تمامی حواله‌ها و رسیدها به صورت مستقیم موجودی این انبارها را بروزرسانی می‌کنند.
              </div>
            </div>
          </div>

          {/* Section: Reorder point active warning summary banner */}
          {biStats && biStats.reorderAlarms.length > 0 && (
            <div className="bg-white border rounded-2xl overflow-hidden shadow-xs border-rose-200">
              <div className="p-4 bg-gradient-to-r from-rose-600 to-rose-500 text-white flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold shrink-0">
                    <AlertTriangle size={20} className="animate-pulse text-amber-200" />
                  </span>
                  <div>
                    <h3 className="font-bold text-base flex items-center gap-2">
                      هشدار آستانه موجودی انبار: {formatPersianNumber(biStats.reorderAlarms.length)} قلم کالا نیازمند سفارش
                    </h3>
                    <p className="text-xs text-rose-100 mt-0.5">
                      جهت جلوگیری از توقف خط تولید یا اتمام موجودی فروش، اقلام زیر باید در سریع‌ترین زمان تامین گردند.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => navigate('/reorder-alerts')}
                  className="px-4 py-2.5 bg-white text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 shrink-0"
                >
                  <ShoppingCart size={15} />
                  مدیریت و چاپ کامل لیست تامین ({formatPersianNumber(biStats.reorderAlarms.length)} قلم)
                  <ArrowLeft size={14} />
                </button>
              </div>

              {/* Preview top 3 critical items */}
              <div className="p-4 bg-rose-50/20 divide-y divide-rose-100">
                <div className="text-xs font-bold text-slate-500 mb-2 flex justify-between items-center">
                  <span>پیش‌نمایش مهم‌ترین اقلام دارای کسری (۳ مورد از {formatPersianNumber(biStats.reorderAlarms.length)} مورد):</span>
                  <button 
                    onClick={() => navigate('/reorder-alerts')}
                    className="text-rose-600 hover:underline font-bold text-xs"
                  >
                    مشاهده همه موارد ←
                  </button>
                </div>
                {biStats.reorderAlarms.slice(0, 3).map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">{item.code}</span>
                      <span className="font-bold text-slate-800 truncate">{item.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.type === 'product' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                        {item.type === 'product' ? 'محصول' : 'ماده اولیه'}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono shrink-0">
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">موجودی فعلی:</span>
                        <span className="font-bold text-rose-600">{formatPersianNumber(item.current_stock)} {item.unit}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">نقطه سفارش:</span>
                        <span className="font-bold text-slate-700">{formatPersianNumber(item.reorder_point)} {item.unit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
