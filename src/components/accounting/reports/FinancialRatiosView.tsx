import { useState } from 'react';
import { Activity, Coins, TrendingUp, ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, BarChart2, Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../../utils';
import type { FinancialRatiosReport } from '../../../types';

interface FinancialRatiosViewProps {
  ratiosData: FinancialRatiosReport | null;
  onFetchFinancialRatios: (currency?: string) => void;
}

export function FinancialRatiosView({
  ratiosData,
  onFetchFinancialRatios
}: FinancialRatiosViewProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<string>('all');

  const handleCurrencyChange = (cur: string) => {
    setSelectedCurrency(cur);
    onFetchFinancialRatios(cur === 'all' ? undefined : cur);
  };

  const getStatusBadge = (status?: 'excellent' | 'good' | 'warning' | 'danger') => {
    switch (status) {
      case 'excellent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" />
            عالی
          </span>
        );
      case 'good':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <CheckCircle2 className="w-3 h-3" />
            مطلوب
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3" />
            هشدار
          </span>
        );
      case 'danger':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertTriangle className="w-3 h-3" />
            بحرانی
          </span>
        );
    }
  };

  const overallScore = ratiosData?.status?.overallScore ?? 75;

  return (
    <div className="space-y-6">
      {/* Top Bar: Title, Currency Filter & Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-base">داشبورد شاخص‌های سلامت مالی و نسبت‌ها (Financial Ratios)</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              تحلیل نقدینگی، اهرم مالی، سودآوری، کارایی و وضعیت تفکیکی ارزها
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Currency Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700/60 p-1 rounded-xl">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-2">ارز مبنا:</span>
            {['all', 'IRR', 'USD', 'EUR', 'AED', 'GBP'].map((cur) => (
              <button
                key={cur}
                onClick={() => handleCurrencyChange(cur)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                  selectedCurrency === cur
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                {cur === 'all' ? 'همه ارزها' : cur}
              </button>
            ))}
          </div>

          <button
            onClick={() => onFetchFinancialRatios(selectedCurrency === 'all' ? undefined : selectedCurrency)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>محاسبه مجدد</span>
          </button>
        </div>
      </div>

      {/* Health Score Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="text-xs font-bold text-indigo-200">امتیاز سلامت و پایداری مالی شرکت</span>
          </div>
          <h3 className="text-2xl font-black font-mono">
            {formatPersianNumber(overallScore)} <span className="text-sm font-normal text-indigo-200">از ۱۰۰</span>
          </h3>
          <p className="text-xs text-indigo-200/80 max-w-xl leading-relaxed">
            شاخص کلی بر اساس وزن‌دهی نسبت‌های جاری، پوشش بدهی، کارایی دارایی‌ها و حاشیه سود عملیاتی محاسبه شده است.
          </p>
        </div>

        {/* Status Badges Group */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full md:w-auto">
          <div className="bg-white/10 backdrop-blur-xs p-3 rounded-xl text-center space-y-1">
            <span className="text-[11px] text-indigo-200 block">نقدینگی</span>
            {getStatusBadge(ratiosData?.status?.liquidity)}
          </div>
          <div className="bg-white/10 backdrop-blur-xs p-3 rounded-xl text-center space-y-1">
            <span className="text-[11px] text-indigo-200 block">اهرم بدهی</span>
            {getStatusBadge(ratiosData?.status?.solvency)}
          </div>
          <div className="bg-white/10 backdrop-blur-xs p-3 rounded-xl text-center space-y-1">
            <span className="text-[11px] text-indigo-200 block">سودآوری</span>
            {getStatusBadge(ratiosData?.status?.profitability)}
          </div>
          <div className="bg-white/10 backdrop-blur-xs p-3 rounded-xl text-center space-y-1">
            <span className="text-[11px] text-indigo-200 block">کارایی</span>
            {getStatusBadge(ratiosData?.status?.efficiency)}
          </div>
        </div>
      </div>

      {/* 1. LIQUIDITY RATIOS */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-600" />
          <h5 className="font-bold text-slate-800 dark:text-white text-sm">۱. نسبت‌های نقدینگی (Liquidity Ratios)</h5>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500">نسبت جاری (Current)</span>
              {getStatusBadge(ratiosData?.status?.liquidity)}
            </div>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {formatPersianNumber(ratiosData?.currentRatio ?? 0)}
            </div>
            <p className="text-[11px] text-slate-400">دارایی جاری ÷ بدهی جاری (معیار: &gt; ۱.۵)</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">نسبت آنی / سریع (Quick)</span>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {formatPersianNumber(ratiosData?.quickRatio ?? 0)}
            </div>
            <p className="text-[11px] text-slate-400">(دارایی جاری - کالا) ÷ بدهی جاری (معیار: &gt; ۱.۰)</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">نسبت نقدی (Cash Ratio)</span>
            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {formatPersianNumber(ratiosData?.cashRatio ?? 0)}
            </div>
            <p className="text-[11px] text-slate-400">موجودی نقد و بانک ÷ بدهی جاری</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">سرمایه در گردش خالص (NWC)</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
              {formatPersianPrice(ratiosData?.netWorkingCapital ?? 0)}
            </div>
            <p className="text-[11px] text-slate-400">دارایی جاری منهای بدهی جاری</p>
          </div>
        </div>
      </div>

      {/* 2. SOLVENCY & LEVERAGE RATIOS */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-600" />
          <h5 className="font-bold text-slate-800 dark:text-white text-sm">۲. نسبت‌های اهرمی و ساختار سرمایه (Solvency Ratios)</h5>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500">نسبت بدهی (Debt Ratio)</span>
              {getStatusBadge(ratiosData?.status?.solvency)}
            </div>
            <div className="text-2xl font-black font-mono text-amber-600 dark:text-amber-400">
              {formatPersianNumber(ratiosData?.debtRatio ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">کل بدهی‌ها به کل دارایی‌ها (معیار: &lt; ۵۰٪)</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">نسبت بدهی به حقوق صاحبان سهام (D/E)</span>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {formatPersianNumber(ratiosData?.debtToEquityRatio ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">میزان اتکا به استقراض نسبت به سرمایه سهامداران</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">نسبت مالکانه (Equity Ratio)</span>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {formatPersianNumber(ratiosData?.equityRatio ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سهم حقوق مالکانه از کل دارایی‌های شرکت</p>
          </div>
        </div>
      </div>

      {/* 3. PROFITABILITY RATIOS */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
          <h5 className="font-bold text-slate-800 dark:text-white text-sm">۳. نسبت‌های سودآوری و بازدهی (Profitability Ratios)</h5>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">حاشیه سود ناخالص</span>
            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {formatPersianNumber(ratiosData?.grossMargin ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سود ناخالص ÷ کل درآمد فروش</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">حاشیه سود عملیاتی</span>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {formatPersianNumber(ratiosData?.operatingMargin ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سود عملیاتی ÷ درآمد فروش</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500">حاشیه سود خالص</span>
              {getStatusBadge(ratiosData?.status?.profitability)}
            </div>
            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {formatPersianNumber(ratiosData?.netProfitMargin ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سود خالص ÷ درآمد فروش</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">بازده دارایی‌ها (ROA)</span>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {formatPersianNumber(ratiosData?.returnOnAssets ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سود خالص ÷ کل دارایی‌ها</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">بازده حقوق صاحبان سهام (ROE)</span>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {formatPersianNumber(ratiosData?.returnOnEquity ?? 0)}٪
            </div>
            <p className="text-[11px] text-slate-400">سود خالص ÷ کل حقوق مالکانه</p>
          </div>
        </div>
      </div>

      {/* 4. ACTIVITY & TURNOVER RATIOS */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-600" />
          <h5 className="font-bold text-slate-800 dark:text-white text-sm">۴. نسبت‌های کارایی و گردش دارایی‌ها (Activity Ratios)</h5>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-500">گردش کل دارایی‌ها (Asset Turnover)</span>
              {getStatusBadge(ratiosData?.status?.efficiency)}
            </div>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {formatPersianNumber(ratiosData?.assetTurnover ?? 0)} <span className="text-xs font-normal text-slate-400">مرتبه</span>
            </div>
            <p className="text-[11px] text-slate-400">درآمد فروش ÷ میانگین کل دارایی‌ها</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">گردش حساب‌های دریافتنی</span>
            <div className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
              {formatPersianNumber(ratiosData?.receivablesTurnover ?? 0)} <span className="text-xs font-normal text-slate-400">مرتبه</span>
            </div>
            <p className="text-[11px] text-slate-400">درآمد فروش ÷ مطالبات و دریافتنی‌ها</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
            <span className="text-xs font-semibold text-slate-500">دوره گردش کالا و انبار</span>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400">
              {formatPersianNumber(ratiosData?.inventoryTurnoverDays ?? 0)} <span className="text-xs font-normal text-slate-400">روز</span>
            </div>
            <p className="text-[11px] text-slate-400">مدت زمان متوسط تبدیل کالا به فروش</p>
          </div>
        </div>
      </div>

      {/* 5. MULTI-CURRENCY PORTFOLIO SUMMARY */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-indigo-600" />
            <h5 className="font-bold text-slate-900 dark:text-white text-sm">۵. وضعیت جامع تفکیک ارزی و پرتفوی ارزهای خارجی</h5>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            تعداد ارزهای فعال: {formatPersianNumber(ratiosData?.currencyBreakdowns?.length || 0)}
          </span>
        </div>

        {ratiosData?.currencyBreakdowns && ratiosData.currencyBreakdowns.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ratiosData.currencyBreakdowns.map((cur) => (
              <div 
                key={cur.currency} 
                className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/70 dark:border-slate-700/60 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-mono font-black text-xs rounded-lg">
                      {cur.currency}
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      {cur.vouchersCount} سند
                    </span>
                  </div>
                  <div className={`text-xs font-bold flex items-center gap-1 ${
                    cur.netBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {cur.netBalance >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    <span>{cur.netBalance >= 0 ? 'مانده بدهکار' : 'مانده بستانکار'}</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 border-t border-slate-200/50 dark:border-slate-700/40 text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <span>مجموع بدهکار:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{formatPersianPrice(cur.totalDebit)} {cur.currency}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <span>مجموع بستانکار:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{formatPersianPrice(cur.totalCredit)} {cur.currency}</span>
                  </div>
                  <div className="flex justify-between text-slate-900 dark:text-white font-bold pt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                    <span>مانده خالص:</span>
                    <span className="font-mono">{formatPersianPrice(Math.abs(cur.netBalance))} {cur.currency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-400 text-xs">
            اطلاعات اسناد ارزی برای بازه انتخابی یافت نشد.
          </div>
        )}
      </div>
    </div>
  );
}
