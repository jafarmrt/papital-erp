import React from 'react';
import { 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Wallet, 
  Building2, 
  CreditCard, 
  FileText, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  PlusCircle
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatPersianDate } from '../../utils';
import type { FinancialSummaryStats, JournalVoucher, Cheque } from '../../types';

interface AccountingDashboardProps {
  stats: FinancialSummaryStats | null;
  recentVouchers: JournalVoucher[];
  upcomingCheques: Cheque[];
  onTabChange: (tab: string) => void;
  onOpenNewVoucher: () => void;
  onOpenNewTreasury: () => void;
  onOpenNewCheque: () => void;
}

export function AccountingDashboard({
  stats,
  recentVouchers,
  upcomingCheques,
  onTabChange,
  onOpenNewVoucher,
  onOpenNewTreasury,
  onOpenNewCheque,
}: AccountingDashboardProps) {
  const isNetProfitPositive = (stats?.netProfit || 0) >= 0;
  const safeRecentVouchers = Array.isArray(recentVouchers) ? recentVouchers : [];
  const safeUpcomingCheques = Array.isArray(upcomingCheques) ? upcomingCheques : [];

  return (
    <div className="space-y-6">
      {/* Quick Action Banner */}
      <div className="bg-gradient-to-l from-indigo-900 via-indigo-800 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-700/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-6 h-6 text-indigo-300" />
            <h2 className="text-xl font-bold text-white">داشبورد یکپارچه مالی و حسابداری</h2>
          </div>
          <p className="text-sm text-indigo-200">
            مدیریت اسناد دوبل، تراز لحظه‌ای دارایی‌ها و بدهی‌ها، خزانه‌داری، چک‌های صیادی و صورت‌های مالی
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onOpenNewVoucher}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-xl transition shadow-lg shadow-emerald-900/30"
          >
            <PlusCircle className="w-4 h-4" />
            <span>ثبت سند دوبل جدید</span>
          </button>
          <button
            onClick={onOpenNewTreasury}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition shadow-lg shadow-blue-900/30"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>دریافت / پرداخت نقد و بانک</span>
          </button>
          <button
            onClick={onOpenNewCheque}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-xl transition shadow-lg shadow-amber-900/30"
          >
            <CreditCard className="w-4 h-4" />
            <span>ثبت چک جدید</span>
          </button>
        </div>
      </div>

      {/* Main KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cash & Banks */}
        <div 
          onClick={() => onTabChange('treasury')}
          className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">موجودی نقد و بانک‌ها</span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {formatPersianPrice(stats?.totalCashAndBank || 0)}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">مجموع صندوق‌ها و حساب‌های بانکی</p>
        </div>

        {/* Receivables */}
        <div 
          onClick={() => onTabChange('coa')}
          className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">مطالبات تجاری (مشتریان)</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-black text-blue-600 dark:text-blue-400">
            {formatPersianPrice(stats?.totalReceivables || 0)}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">مانده بدهکاران تجاری و اسناد دریافتنی</p>
        </div>

        {/* Payables */}
        <div 
          onClick={() => onTabChange('coa')}
          className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">بدهی‌ها و تعهدات تجاری</span>
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-black text-rose-600 dark:text-rose-400">
            {formatPersianPrice(stats?.totalPayables || 0)}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">مانده بستانکاران و اسناد پرداختنی</p>
        </div>

        {/* Net Profit */}
        <div 
          onClick={() => onTabChange('reports')}
          className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">سود خالص دوره</span>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition ${
              isNetProfitPositive ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600' : 'bg-red-50 dark:bg-red-900/30 text-red-600'
            }`}>
              {isNetProfitPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>
          </div>
          <div className={`text-xl font-black ${isNetProfitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {formatPersianPrice(stats?.netProfit || 0)}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">درآمدها منهای بهای تمام‌شده و هزینه‌ها</p>
        </div>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">چک‌های در جریان وصول</div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-200 mt-0.5">
              {formatPersianPrice(stats?.totalChequesInCollection || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
            <CreditCard className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">مجموع درآمدهای شناسایی شده</div>
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatPersianPrice(stats?.totalRevenues || 0)}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">کل اسناد ثبت‌شده در سیستم</div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-200 mt-0.5">
              {formatPersianNumber(stats?.totalVouchersCount || 0)} سند مالی
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
            <FileText className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Two Columns: Recent Vouchers & Cheques Due */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Vouchers */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="font-bold text-slate-900 dark:text-white text-base">آخرین اسناد حسابداری</h3>
            </div>
            <button
              onClick={() => onTabChange('vouchers')}
              className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-semibold"
            >
              مشاهده همه
            </button>
          </div>

          {safeRecentVouchers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">هنوز سندی ثبت نشده است</div>
          ) : (
            <div className="space-y-2.5">
              {safeRecentVouchers.slice(0, 5).map(v => (
                <div 
                  key={v.id} 
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 hover:bg-slate-100/70 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-black text-xs flex items-center justify-center">
                      #{formatPersianNumber(v.voucherNumber)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                        {v.description}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {formatPersianDate(v.date)} • {v.createdByUsername || 'کاربر سیستم'}
                      </div>
                    </div>
                  </div>
                  <div className="text-left font-bold text-xs text-slate-900 dark:text-white">
                    {formatPersianPrice(v.totalDebit)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cheques Due / Alert */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <h3 className="font-bold text-slate-900 dark:text-white text-base">چک‌های نیازمند پیگیری و سررسید</h3>
            </div>
            <button
              onClick={() => onTabChange('cheques')}
              className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 font-semibold"
            >
              مدیریت چک‌ها
            </button>
          </div>

          {safeUpcomingCheques.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">چک فعالی برای پیگیری وجود ندارد</div>
          ) : (
            <div className="space-y-2.5">
              {safeUpcomingCheques.slice(0, 5).map(c => (
                <div 
                  key={c.id} 
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 hover:bg-slate-100/70 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center ${
                      c.type === 'received' 
                        ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700' 
                        : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700'
                    }`}>
                      {c.type === 'received' ? 'دریافت' : 'پرداخت'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {c.bankName} - {c.partyName}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        سررسید: {formatPersianDate(c.dueDate)} • شماره: {formatPersianNumber(c.chequeNumber)}
                      </div>
                    </div>
                  </div>
                  <div className="text-left font-bold text-xs text-slate-900 dark:text-white">
                    {formatPersianPrice(c.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
