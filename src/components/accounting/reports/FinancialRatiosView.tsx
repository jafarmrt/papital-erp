import { useState } from 'react';
import type React from 'react';
import { Activity, Coins, TrendingUp, ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, BarChart2, Wallet, ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber } from '../../../utils';
import type { FinancialRatiosReport } from '../../../types';
import { PillBadge, type PillBadgeVariant, type PillBadgeVariants } from '../../common/PillBadge';
import { AsOfDateField, asOfCaption } from './ReportDateFields';

// v7.0.86 (TD-108): نشان وضعیت نسبت‌های مالی؛ وضعیت نامشخص «بحرانی» نمایش داده می‌شود
const RATIO_BADGE_BASE = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border';
const RATIO_STATUS_BADGES: PillBadgeVariants = {
  excellent: { label: 'عالی', icon: CheckCircle2, iconClassName: 'w-3 h-3', className: `${RATIO_BADGE_BASE} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800` },
  good: { label: 'مطلوب', icon: CheckCircle2, iconClassName: 'w-3 h-3', className: `${RATIO_BADGE_BASE} bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800` },
  warning: { label: 'هشدار', icon: AlertTriangle, iconClassName: 'w-3 h-3', className: `${RATIO_BADGE_BASE} bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800` },
};
const RATIO_STATUS_DANGER: PillBadgeVariant = { label: 'بحرانی', icon: AlertTriangle, iconClassName: 'w-3 h-3', className: `${RATIO_BADGE_BASE} bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800` };

type RatioStatusKey = 'liquidity' | 'solvency' | 'profitability' | 'efficiency';

// v7.0.140: کارت‌ها و بخش‌های نسبت‌ها داده‌محورند (پیش‌تر ۱۵ کارت تقریباً یکسان تکرار شده بود)
const STATUS_TILES: Array<[string, RatioStatusKey]> = [
  ['نقدینگی', 'liquidity'], ['اهرم بدهی', 'solvency'], ['سودآوری', 'profitability'], ['کارایی', 'efficiency'],
];

interface RatioCardSpec {
  label: string;
  value: React.ReactNode;
  valueClassName: string;
  hint: string;
  statusKey?: RatioStatusKey;
}

interface RatioSectionSpec {
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  gridClassName: string;
  cards: RatioCardSpec[];
}

const BIG = 'text-2xl font-black font-mono';
const NEUTRAL = 'text-slate-900 dark:text-white';
const INDIGO = 'text-indigo-600 dark:text-indigo-400';
const EMERALD = 'text-emerald-600 dark:text-emerald-400';

function withSuffix(value: number | undefined, suffix: string) {
  return <>{formatPersianNumber(value ?? 0)} <span className="text-xs font-normal text-slate-400">{suffix}</span></>;
}

function buildRatioSections(r: FinancialRatiosReport | null): RatioSectionSpec[] {
  const pct = (v: number | undefined) => `${formatPersianNumber(v ?? 0)}٪`;
  return [
    {
      title: '۱. نسبت‌های نقدینگی (Liquidity Ratios)', icon: Wallet, iconClassName: 'text-indigo-600', gridClassName: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      cards: [
        { label: 'نسبت جاری (Current)', value: formatPersianNumber(r?.currentRatio ?? 0), valueClassName: `${BIG} ${NEUTRAL}`, hint: 'دارایی جاری ÷ بدهی جاری (معیار: > ۱.۵)', statusKey: 'liquidity' },
        { label: 'نسبت آنی / سریع (Quick)', value: formatPersianNumber(r?.quickRatio ?? 0), valueClassName: `${BIG} ${INDIGO}`, hint: '(دارایی جاری - کالا) ÷ بدهی جاری (معیار: > ۱.۰)' },
        { label: 'نسبت نقدی (Cash Ratio)', value: formatPersianNumber(r?.cashRatio ?? 0), valueClassName: `${BIG} ${EMERALD}`, hint: 'موجودی نقد و بانک ÷ بدهی جاری' },
        { label: 'سرمایه در گردش خالص (NWC)', value: formatPersianPrice(r?.netWorkingCapital ?? 0), valueClassName: `text-xl font-bold font-mono ${NEUTRAL}`, hint: 'دارایی جاری منهای بدهی جاری' },
      ],
    },
    {
      title: '۲. نسبت‌های اهرمی و ساختار سرمایه (Solvency Ratios)', icon: ShieldCheck, iconClassName: 'text-amber-600', gridClassName: 'grid-cols-1 sm:grid-cols-3',
      cards: [
        { label: 'نسبت بدهی (Debt Ratio)', value: pct(r?.debtRatio), valueClassName: `${BIG} text-amber-600 dark:text-amber-400`, hint: 'کل بدهی‌ها به کل دارایی‌ها (معیار: < ۵۰٪)', statusKey: 'solvency' },
        { label: 'نسبت بدهی به حقوق صاحبان سهام (D/E)', value: pct(r?.debtToEquityRatio), valueClassName: `${BIG} ${NEUTRAL}`, hint: 'میزان اتکا به استقراض نسبت به سرمایه سهامداران' },
        { label: 'نسبت مالکانه (Equity Ratio)', value: pct(r?.equityRatio), valueClassName: `${BIG} ${INDIGO}`, hint: 'سهم حقوق مالکانه از کل دارایی‌های شرکت' },
      ],
    },
    {
      title: '۳. نسبت‌های سودآوری و بازدهی (Profitability Ratios)', icon: TrendingUp, iconClassName: 'text-emerald-600', gridClassName: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
      cards: [
        { label: 'حاشیه سود ناخالص', value: pct(r?.grossMargin), valueClassName: `${BIG} ${EMERALD}`, hint: 'سود ناخالص ÷ کل درآمد فروش' },
        { label: 'حاشیه سود عملیاتی', value: pct(r?.operatingMargin), valueClassName: `${BIG} ${INDIGO}`, hint: 'سود عملیاتی ÷ درآمد فروش' },
        { label: 'حاشیه سود خالص', value: pct(r?.netProfitMargin), valueClassName: `${BIG} ${EMERALD}`, hint: 'سود خالص ÷ درآمد فروش', statusKey: 'profitability' },
        { label: 'بازده دارایی‌ها (ROA)', value: pct(r?.returnOnAssets), valueClassName: `${BIG} ${NEUTRAL}`, hint: 'سود خالص ÷ کل دارایی‌ها' },
        { label: 'بازده حقوق صاحبان سهام (ROE)', value: pct(r?.returnOnEquity), valueClassName: `${BIG} ${INDIGO}`, hint: 'سود خالص ÷ کل حقوق مالکانه' },
      ],
    },
    {
      title: '۴. نسبت‌های کارایی و گردش دارایی‌ها (Activity Ratios)', icon: BarChart2, iconClassName: 'text-blue-600', gridClassName: 'grid-cols-1 sm:grid-cols-3',
      cards: [
        { label: 'گردش کل دارایی‌ها (Asset Turnover)', value: withSuffix(r?.assetTurnover, 'مرتبه'), valueClassName: `${BIG} ${NEUTRAL}`, hint: 'درآمد فروش ÷ میانگین کل دارایی‌ها', statusKey: 'efficiency' },
        { label: 'گردش حساب‌های دریافتنی', value: withSuffix(r?.receivablesTurnover, 'مرتبه'), valueClassName: `${BIG} text-blue-600 dark:text-blue-400`, hint: 'درآمد فروش ÷ مطالبات و دریافتنی‌ها' },
        { label: 'دوره گردش کالا و انبار', value: withSuffix(r?.inventoryTurnoverDays, 'روز'), valueClassName: `${BIG} ${INDIGO}`, hint: 'مدت زمان متوسط تبدیل کالا به فروش' },
      ],
    },
  ];
}

function RatioCard({ card, status }: { card: RatioCardSpec; status?: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs space-y-2">
      {card.statusKey ? (
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-slate-500">{card.label}</span>
          <PillBadge variants={RATIO_STATUS_BADGES} value={status} fallback={RATIO_STATUS_DANGER} />
        </div>
      ) : (
        <span className="text-xs font-semibold text-slate-500">{card.label}</span>
      )}
      <div className={card.valueClassName}>{card.value}</div>
      <p className="text-[11px] text-slate-400">{card.hint}</p>
    </div>
  );
}

interface FinancialRatiosViewProps {
  ratiosData: FinancialRatiosReport | null;
  /** ارز (خالی = همه ارزها) و تاریخ نسبت‌ها (ISO، خالی = تا امروز) */
  onFetchFinancialRatios: (currency?: string, asOfDate?: string) => void;
  /** v9.0.110 (TD-566): تاریخ نسبت‌ها در سرآیند همین صفحه */
  asOfDate?: string;
  onAsOfDateChange?: (iso: string) => void;
}

export function FinancialRatiosView({
  ratiosData,
  onFetchFinancialRatios,
  asOfDate = '',
  onAsOfDateChange,
}: FinancialRatiosViewProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<string>('all');
  const currencyParam = (cur: string) => (cur === 'all' ? undefined : cur);

  const handleCurrencyChange = (cur: string) => {
    setSelectedCurrency(cur);
    onFetchFinancialRatios(currencyParam(cur), asOfDate);
  };

  const handleAsOfDateChange = (iso: string) => {
    onAsOfDateChange?.(iso);
    onFetchFinancialRatios(currencyParam(selectedCurrency), iso);
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
            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mt-0.5">{asOfCaption(asOfDate)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {onAsOfDateChange && <AsOfDateField value={asOfDate} onChange={handleAsOfDateChange} />}
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
            onClick={() => onFetchFinancialRatios(currencyParam(selectedCurrency), asOfDate)}
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
          {STATUS_TILES.map(([label, key]) => (
            <div key={key} className="bg-white/10 backdrop-blur-xs p-3 rounded-xl text-center space-y-1">
              <span className="text-[11px] text-indigo-200 block">{label}</span>
              <PillBadge variants={RATIO_STATUS_BADGES} value={ratiosData?.status?.[key]} fallback={RATIO_STATUS_DANGER} />
            </div>
          ))}
        </div>
      </div>

      {buildRatioSections(ratiosData).map((section) => (
        <div key={section.title} className="space-y-3">
          <div className="flex items-center gap-2">
            <section.icon className={`w-4 h-4 ${section.iconClassName}`} />
            <h5 className="font-bold text-slate-800 dark:text-white text-sm">{section.title}</h5>
          </div>
          <div className={`grid gap-4 ${section.gridClassName}`}>
            {section.cards.map((card) => (
              <RatioCard key={card.label} card={card} status={card.statusKey ? ratiosData?.status?.[card.statusKey] : undefined} />
            ))}
          </div>
        </div>
      ))}

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
