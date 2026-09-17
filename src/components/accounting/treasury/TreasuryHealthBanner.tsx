import React from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { formatPersianPrice } from '../../../utils';

interface TreasuryHealthBannerProps {
  totalLedgerBalance: number;
  totalTreasuryBalance: number;
  totalDiscrepancy: number;
  syncedAccountsCount: number;
  discrepantAccountsCount: number;
  totalAccountsCount: number;
  appCurrency: string;
}

export const TreasuryHealthBanner: React.FC<TreasuryHealthBannerProps> = React.memo(({
  totalLedgerBalance,
  totalTreasuryBalance,
  totalDiscrepancy,
  syncedAccountsCount,
  discrepantAccountsCount,
  totalAccountsCount,
  appCurrency,
}) => {
  const isHealthy = discrepantAccountsCount === 0;

  return (
    <div
      className={`p-4 sm:p-5 rounded-2xl border transition-all ${
        isHealthy
          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
          : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isHealthy
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isHealthy ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {isHealthy
                  ? 'وضعیت سلامت ریالی: انطباق ۱۰۰٪ کامل خزانه‌داری با دفاتر اسناد دوبل'
                  : `هشدار مغایرت ریالی: ${discrepantAccountsCount} حساب نیازمند بررسی و تطبیق`}
              </h4>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isHealthy
                    ? 'bg-emerald-200/60 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                    : 'bg-amber-200/60 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                }`}
              >
                {syncedAccountsCount} از {totalAccountsCount} حساب کاملاً همگام
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {isHealthy
                ? 'تمامی مانده‌های صندوق‌ها و بانک‌ها مستقیماً با مجموع گردش اسناد دوبل تاییدشده تراز هستند.'
                : 'مغایرت ممکن است به دلیل عدم ثبت سند دوبل برای برخی دریافت/پرداخت‌ها یا مانده اولیه ثبت‌نشده در سند افتتاحیه باشد.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
            <span className="text-slate-400 block text-[10px]">مجموع مانده دفاتر دوبل:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {formatPersianPrice(totalLedgerBalance, appCurrency)}
            </span>
          </div>
          <div className="bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
            <span className="text-slate-400 block text-[10px]">مجموع گردش خزانه‌داری:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {formatPersianPrice(totalTreasuryBalance, appCurrency)}
            </span>
          </div>
          {totalDiscrepancy > 0 && (
            <div className="bg-rose-100/80 dark:bg-rose-900/40 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              <span className="block text-[10px]">میزان مغایرت کل:</span>
              <span className="font-bold">{formatPersianPrice(totalDiscrepancy, appCurrency)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

TreasuryHealthBanner.displayName = 'TreasuryHealthBanner';
