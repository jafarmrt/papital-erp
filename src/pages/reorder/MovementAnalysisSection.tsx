import {
  BarChart2, Flame, RefreshCw, AlertCircle
} from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { useDashboardBIStatsQuery } from '../../hooks/queries';

/**
 * V10-3.3: تحلیل گردش کالا — از داشبورد به صفحه «تحلیل گردش کالا و هشدار تامین» منتقل شد.
 * شامل نمودار ماهانه ورود/خروج (از biStats.monthlyTrends با کش مشترک React Query) و
 * ویجت‌های کالای تندگردش، کندگردش و راکد.
 */
export default function MovementAnalysisSection() {
  const { data: biStats, isLoading } = useDashboardBIStatsQuery();

  const processTrendChart = () => {
    if (!biStats || !biStats.monthlyTrends.length) return { labels: [], ins: [], outs: [], maxVal: 10 };

    const monthMap: { [key: string]: { in: number; out: number } } = {};
    const labelMap: { [key: string]: string } = {};

    biStats.monthlyTrends.forEach(t => {
      const d = new Date(t.date);
      const ymKey = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: '2-digit' }).format(d);

      if (!monthMap[ymKey]) {
        monthMap[ymKey] = { in: 0, out: 0 };
        const monthName = new Intl.DateTimeFormat('fa-IR', { month: 'long' }).format(d);
        const yearStr = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' }).format(d);
        labelMap[ymKey] = `${monthName} ${yearStr}`;
      }

      if (t.type === 'in') {
        monthMap[ymKey].in += Number(t.total) || 0;
      } else {
        monthMap[ymKey].out += Number(t.total) || 0;
      }
    });

    const sortedKeys = Object.keys(monthMap).sort();
    const ins = sortedKeys.map(k => monthMap[k].in);
    const outs = sortedKeys.map(k => monthMap[k].out);
    const maxVal = Math.max(...ins, ...outs, 10) * 1.15;

    const fLabels = sortedKeys.map(k => labelMap[k]);

    return { labels: fLabels, ins, outs, maxVal };
  };

  const chartData = processTrendChart();

  return (
    <div className="space-y-6 no-print">
      {/* نمودار گردش ماهانه */}
      <div className="bg-white p-6 border rounded-2xl shadow-xs flex flex-col">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <BarChart2 className="text-blue-500" size={18} />
            نمودار گردش کالا (ورود و خروج ماه‌های اخیر)
          </h3>
          <div className="flex gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-emerald-600">
              <span className="w-3 h-3 bg-emerald-500 rounded-full inline-block"></span> ورود به انبار
            </span>
            <span className="flex items-center gap-1.5 text-amber-500">
              <span className="w-3 h-3 bg-amber-500 rounded-full inline-block"></span> خروج از انبار
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-[220px] flex items-end justify-between px-4 pb-2 pt-6 border-b border-r border-slate-200 relative mt-2">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs animate-pulse">در حال محاسبه گردش ماهانه...</div>
          ) : chartData.labels.length > 0 ? (
            chartData.labels.map((lbl, idx) => {
              const inVal = chartData.ins[idx] || 0;
              const outVal = chartData.outs[idx] || 0;
              const inHeight = chartData.maxVal > 0 ? (inVal / chartData.maxVal) * 100 : 0;
              const outHeight = chartData.maxVal > 0 ? (outVal / chartData.maxVal) * 100 : 0;

              return (
                <div key={idx} className="flex-1 flex flex-col items-center group relative px-2">
                  <div className="absolute bottom-full mb-2 bg-slate-800 text-white text-[11px] p-2.5 rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 flex flex-col gap-1 text-center w-32 font-mono">
                    <span className="font-sans border-b border-slate-700 pb-1 text-slate-300 font-bold">{lbl}</span>
                    <span className="text-emerald-400">ورودی: {formatPersianNumber(inVal)}</span>
                    <span className="text-amber-400">خروجی: {formatPersianNumber(outVal)}</span>
                  </div>

                  <div className="w-full flex justify-center items-end h-40 gap-1.5">
                    <div
                      style={{ height: `${Math.max(4, inHeight)}%` }}
                      className="w-4 bg-emerald-500 hover:bg-emerald-600 rounded-t-md transition-all duration-300"
                    ></div>
                    <div
                      style={{ height: `${Math.max(4, outHeight)}%` }}
                      className="w-4 bg-amber-400 hover:bg-amber-500 rounded-t-md transition-all duration-300"
                    ></div>
                  </div>

                  <span className="text-[10px] font-bold text-slate-600 mt-2">{lbl}</span>
                </div>
              );
            })
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">
              داده‌ای برای نمایش نمودار گردش کالا ثبت نشده است.
            </div>
          )}
        </div>
      </div>

      {/* ویجت‌های تندگردش / کندگردش / راکد */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Fast Moving */}
        <div className="bg-white p-6 border rounded-2xl shadow-xs">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
              <Flame className="text-rose-500 shrink-0" size={18} />
              کالاهای تند گردش
            </h3>
            <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full font-bold">کمتر از {formatPersianNumber(biStats?.fastDays ?? 30)} روز</span>
          </div>

          {biStats && biStats.fastMoving.length > 0 ? (
            <div className="divide-y text-right">
              {biStats.fastMoving.map((item, idx) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors rounded-xl px-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="w-5 h-5 bg-rose-100 text-rose-600 flex items-center justify-center rounded-full text-[10px] font-bold shrink-0">
                      {formatPersianNumber(idx + 1)}
                    </span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                      <span className="text-[10px] text-slate-400 font-mono block">کد: {item.code}</span>
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs font-bold text-slate-700">{formatPersianNumber(item.total_qty)} {item.unit}</p>
                    <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-bold">پرمصرف</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400 text-xs text-center py-6 font-medium">کالای پرگردشی ثبت نشده است.</div>
          )}
        </div>

        {/* Slow Moving */}
        <div className="bg-white p-6 border rounded-2xl shadow-xs">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
              <RefreshCw className="text-amber-500 shrink-0" size={18} />
              کالاهای کند گردش
            </h3>
            <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold">بین {formatPersianNumber(biStats?.slowDays ?? 90)} تا {formatPersianNumber(biStats?.deadDays ?? 180)} روز</span>
          </div>

          {biStats && biStats.slowMoving && biStats.slowMoving.length > 0 ? (
            <div className="divide-y text-right">
              {biStats.slowMoving.map((item, idx) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors rounded-xl px-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="w-5 h-5 bg-amber-100 text-amber-600 flex items-center justify-center rounded-full text-[10px] font-bold shrink-0">
                      {formatPersianNumber(idx + 1)}
                    </span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                      <span className="text-[10px] text-slate-400 font-mono block">کد: {item.code}</span>
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs font-bold text-slate-700">{formatPersianNumber(item.current_stock)} {item.unit}</p>
                    <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-bold">کم‌گردش</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400 text-xs text-center py-6 font-medium">کالای کند گردش یافت نشد.</div>
          )}
        </div>

        {/* Dead Stock */}
        <div className="bg-white p-6 border rounded-2xl shadow-xs">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
              <AlertCircle className="text-rose-500 shrink-0" size={18} />
              کالاهای راکد
            </h3>
            <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full font-bold">بیشتر از {formatPersianNumber(biStats?.deadDays ?? 180)} روز</span>
          </div>

          {biStats && biStats.deadStock.length > 0 ? (
            <div className="divide-y text-right">
              {biStats.deadStock.map((item, idx) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors rounded-xl px-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="w-5 h-5 bg-rose-100 text-rose-600 flex items-center justify-center rounded-full text-[10px] font-bold shrink-0">
                      {formatPersianNumber(idx + 1)}
                    </span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-slate-700 truncate">{item.name}</p>
                      <span className="text-[10px] text-slate-400 font-mono block">کد: {item.code}</span>
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs font-bold text-rose-600">{formatPersianNumber(item.current_stock)} {item.unit}</p>
                    <span className="text-[9px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full font-bold">راکد</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400 text-xs text-center py-6 font-medium">کالای راکد با موجودی مثبت یافت نشد.</div>
          )}
        </div>
      </div>
    </div>
  );
}
