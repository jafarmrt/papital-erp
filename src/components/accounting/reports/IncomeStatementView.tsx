import { TrendingUp } from 'lucide-react';
import { formatPersianNumber, formatPersianPrice } from '../../../utils';
import type { IncomeStatementReport } from '../../../types';
import { netProfitMarginPercent, statementRows } from '../../../lib/accounting/financialStatements';
import { PeriodFields, periodCaption } from './ReportDateFields';

interface IncomeStatementViewProps {
  incomeStatement: IncomeStatementReport | null;
  /** v9.0.116 (TD-566): دوره خود صورت سود و زیان (ISO)، نه تاریخ‌های تراز آزمایشی */
  startDate: string;
  endDate: string;
  onPeriodChange: (period: { startDate: string; endDate: string }) => void;
  onApplyIncomeFilter: () => void;
}

export function IncomeStatementView({
  incomeStatement,
  startDate,
  endDate,
  onPeriodChange,
  onApplyIncomeFilter
}: IncomeStatementViewProps) {
  // v9.0.114 (TD-563): همان کلیدهای پاسخ سرور (`totalRevenue`، `operatingExpenses`)، نه `totalRevenues` و `expenses`
  const safeRevenues = statementRows(incomeStatement?.revenues);
  const safeCostOfSales = statementRows(incomeStatement?.costOfSales);
  const safeExpenses = statementRows(incomeStatement?.operatingExpenses);
  const margin = netProfitMarginPercent(incomeStatement);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-600" />
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">صورت سود و زیان دوره‌ای</h4>
            <p className="text-xs text-slate-500">گزارش درآمدهای عملیاتی، بهای تمام شده، سود ناخالص و سود خالص دوره</p>
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">{periodCaption(startDate, endDate)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFields startDate={startDate} endDate={endDate} onChange={onPeriodChange} />
          <button
            onClick={onApplyIncomeFilter}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition"
          >
            به‌روزرسانی
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 shadow-sm space-y-6">
        {/* Net Profit Big Banner */}
        <div className="flex flex-col md:flex-row items-center justify-between p-5 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/50">
          <div>
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">سود (زیان) خالص دوره مالی:</span>
            <div className="text-2xl font-black text-emerald-900 dark:text-emerald-100 font-mono mt-1">
              {formatPersianPrice(incomeStatement?.netProfit || 0)}
            </div>
          </div>
          <div className="text-left mt-3 md:mt-0">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">حاشیه سود خالص:</span>
            <div className="text-lg font-bold font-mono text-emerald-800 dark:text-emerald-200">
              {margin === null ? '—' : `${formatPersianNumber(margin, 1)}٪`}
            </div>
          </div>
        </div>

        {/* Income Statement Sections */}
        <div className="space-y-4 text-xs">
          {/* 1. Revenues */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2.5 font-bold flex justify-between">
              <span>درآمدهای عملیاتی و فروش (الف)</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatPersianPrice(incomeStatement?.totalRevenue || 0)}</span>
            </div>
            <div className="p-3 space-y-1.5">
              {safeRevenues.length === 0 ? (
                <div className="text-slate-400 py-1">ثبتی یافت نشد</div>
              ) : (
                safeRevenues.map((r, i) => (
                  <div key={i} className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-750">
                    <span>{r.code} - {r.name}</span>
                    <span className="font-mono font-semibold">{formatPersianPrice(r.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Cost of Sales */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2.5 font-bold flex justify-between">
              <span>بهای تمام شده کالای فروش رفته (ب)</span>
              <span className="font-mono text-rose-600 dark:text-rose-400">{formatPersianPrice(incomeStatement?.totalCostOfSales || 0)}</span>
            </div>
            <div className="p-3 space-y-1.5">
              {safeCostOfSales.length === 0 ? (
                <div className="text-slate-400 py-1">ثبتی یافت نشد</div>
              ) : (
                safeCostOfSales.map((r, i) => (
                  <div key={i} className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-750">
                    <span>{r.code} - {r.name}</span>
                    <span className="font-mono font-semibold">{formatPersianPrice(r.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Gross Profit Bar */}
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/40 p-3 rounded-xl flex justify-between font-bold text-indigo-900 dark:text-indigo-200">
            <span>سود ناخالص (الف - ب)</span>
            <span className="font-mono text-sm">{formatPersianPrice(incomeStatement?.grossProfit || 0)}</span>
          </div>

          {/* 3. Operating Expenses */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2.5 font-bold flex justify-between">
              <span>هزینه‌های عمومی، اداری و تشکیلاتی (ج)</span>
              <span className="font-mono text-rose-600 dark:text-rose-400">{formatPersianPrice(incomeStatement?.totalOperatingExpenses || 0)}</span>
            </div>
            <div className="p-3 space-y-1.5">
              {safeExpenses.length === 0 ? (
                <div className="text-slate-400 py-1">ثبتی یافت نشد</div>
              ) : (
                safeExpenses.map((r, i) => (
                  <div key={i} className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-750">
                    <span>{r.code} - {r.name}</span>
                    <span className="font-mono font-semibold">{formatPersianPrice(r.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
