import React from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Folder, 
  FolderOpen, 
  Layers 
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, formatPersianDate, extractDateString } from '../../../utils';
import type { TrialBalanceRow } from '../../../types';

interface TrialBalanceViewProps {
  trialLevel: 'all' | 'group' | 'general' | 'subsidiary' | 'detailed';
  trialCols: '2' | '4' | '6' | '8';
  startDate: string;
  endDate: string;
  tableSearch: string;
  loading: boolean;
  filteredTrialRows: TrialBalanceRow[];
  trialTotals: {
    initialDebit: number;
    initialCredit: number;
    debitTurnover: number;
    creditTurnover: number;
    totalDebit: number;
    totalCredit: number;
    debitBalance: number;
    creditBalance: number;
    isBalanced: boolean;
    diff: number;
  };
  onApplyTrialFilter: (newLevel?: 'all' | 'group' | 'general' | 'subsidiary' | 'detailed') => void;
  setTrialCols: (cols: '2' | '4' | '6' | '8') => void;
  setStartDate: (val: string) => void;
  setEndDate: (val: string) => void;
  setTableSearch: (val: string) => void;
  onFetchTrialBalance: (level?: string, startDate?: string, endDate?: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  onDrillDownToLedger: (accountId: number) => void;
}

export function TrialBalanceView({
  trialLevel,
  trialCols,
  startDate,
  endDate,
  tableSearch,
  loading,
  filteredTrialRows,
  trialTotals,
  onApplyTrialFilter,
  setTrialCols,
  setStartDate,
  setEndDate,
  setTableSearch,
  onFetchTrialBalance,
  expandAll,
  collapseAll,
  onDrillDownToLedger
}: TrialBalanceViewProps) {
  return (
    <div className="space-y-4">
      {/* Quick Level Selector Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Level Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 ml-1">سطح کدینگ:</span>
            <button
              onClick={() => onApplyTrialFilter('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                trialLevel === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              نمای ۴ سطحی درختی (جامع)
            </button>
            <button
              onClick={() => onApplyTrialFilter('group')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                trialLevel === 'group'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              سطح ۱: گروه
            </button>
            <button
              onClick={() => onApplyTrialFilter('general')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                trialLevel === 'general'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              سطح ۲: کل
            </button>
            <button
              onClick={() => onApplyTrialFilter('subsidiary')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                trialLevel === 'subsidiary'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              سطح ۳: معین
            </button>
            <button
              onClick={() => onApplyTrialFilter('detailed')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                trialLevel === 'detailed'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              سطح ۴: تفصیلی (اشخاص و بانک‌ها)
            </button>
          </div>

          {/* Column Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 ml-1">تعداد ستون:</span>
            {(['2', '4', '6', '8'] as const).map(col => (
              <button
                key={col}
                onClick={() => setTrialCols(col)}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                  trialCols === col
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {col} ستونی
              </button>
            ))}
          </div>
        </div>

        {/* Dates & Search Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <DatePicker
                value={startDate}
                onChange={(dateObj: any) => setStartDate(extractDateString(dateObj))}
                placeholder="از تاریخ..."
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-28 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <span className="text-xs text-slate-400">تا</span>
              <DatePicker
                value={endDate}
                onChange={(dateObj: any) => setEndDate(extractDateString(dateObj))}
                placeholder="تا تاریخ..."
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-28 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); onFetchTrialBalance(trialLevel); }}
                  className="text-xs text-rose-500 hover:text-rose-700 font-medium px-1"
                >
                  حذف فیلتر
                </button>
              )}
            </div>

            <button
              onClick={() => onApplyTrialFilter()}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition"
            >
              اعمال تاریخ
            </button>

            {trialLevel === 'all' && (
              <div className="flex items-center gap-1 mr-2">
                <button
                  onClick={expandAll}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg"
                >
                  باز کردن همه
                </button>
                <button
                  onClick={collapseAll}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg"
                >
                  بستن همه
                </button>
              </div>
            )}
          </div>

          {/* Instant Search Bar */}
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
              placeholder="جستجوی سریع کد یا عنوان..."
              className="w-full pr-8 pl-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Trial Balance Status Indicator */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs">
            {trialTotals.isBalanced ? (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                تراز آزمایشی کاملاً متوازن است (مجموع بدهکار = مجموع بستانکار)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-bold bg-rose-50 dark:bg-rose-950/40 px-3 py-1 rounded-lg border border-rose-200 dark:border-rose-800/40">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                عدم تعادل در تراز آزمایشی! مغایرت: {formatPersianPrice(trialTotals.diff)}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">
            تعداد ردیف‌های نمایشی: {formatPersianNumber(filteredTrialRows.length)} ردیف
          </span>
        </div>
      </div>

      {/* Trial Balance Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden print:border-none print:shadow-none">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 text-center">
          <h4 className="text-base font-black text-slate-900 dark:text-white">
            تراز آزمایشی {trialCols} ستونی حساب‌ها
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            سطح گزارش: {trialLevel === 'all' ? '۴ سطح درختی جامع' : trialLevel === 'group' ? 'سطح ۱: گروه' : trialLevel === 'general' ? 'سطح ۲: کل' : trialLevel === 'subsidiary' ? 'سطح ۳: معین' : 'سطح ۴: تفصیلی'}
            {startDate && ` | از تاریخ: ${formatPersianDate(startDate)}`}
            {endDate && ` | تا تاریخ: ${formatPersianDate(endDate)}`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300">
                <th rowSpan={2} className="py-2.5 px-3 w-12 text-center border-l border-slate-200 dark:border-slate-700">#</th>
                <th rowSpan={2} className="py-2.5 px-3 w-32 text-center border-l border-slate-200 dark:border-slate-700">کد حساب</th>
                <th rowSpan={2} className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700">شرح و عنوان حساب</th>
                <th rowSpan={2} className="py-2.5 px-2.5 w-20 text-center border-l border-slate-200 dark:border-slate-700">سطح</th>
                
                {trialCols === '8' && (
                  <th colSpan={2} className="py-1.5 px-3 text-center border-l border-slate-200 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-700">گردش ابتدای دوره</th>
                )}

                {(trialCols === '4' || trialCols === '6' || trialCols === '8') && (
                  <th colSpan={2} className="py-1.5 px-3 text-center border-l border-slate-200 dark:border-slate-700 bg-indigo-50/50 dark:bg-indigo-950/30">گردش طی دوره</th>
                )}

                {(trialCols === '6' || trialCols === '8') && (
                  <th colSpan={2} className="py-1.5 px-3 text-center border-l border-slate-200 dark:border-slate-700 bg-amber-50/50 dark:bg-amber-950/30">مجموع گردش</th>
                )}

                <th colSpan={2} className="py-1.5 px-3 text-center bg-emerald-50/50 dark:bg-emerald-950/30">مانده پایان دوره</th>
              </tr>
              
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                {trialCols === '8' && (
                  <>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                  </>
                )}
                {(trialCols === '4' || trialCols === '6' || trialCols === '8') && (
                  <>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                  </>
                )}
                {(trialCols === '6' || trialCols === '8') && (
                  <>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                    <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                  </>
                )}
                <th className="py-2 px-3 w-28 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                <th className="py-2 px-3 w-28 text-left">بستانکار</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {filteredTrialRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-slate-400">
                    {loading ? 'در حال محاسبه تراز آزمایشی...' : 'اطلاعاتی برای نمایش یافت نشد'}
                  </td>
                </tr>
              ) : (
                filteredTrialRows.map((r, idx) => {
                  const isGroup = r.level === 'group';
                  const isGeneral = r.level === 'general';
                  const isSubsidiary = r.level === 'subsidiary';

                  return (
                    <tr
                      key={`${r.code}-${idx}`}
                      onClick={() => {
                        if (r.accountId) onDrillDownToLedger(r.accountId);
                      }}
                      className={`cursor-pointer transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 ${
                        isGroup
                          ? 'bg-slate-100/90 dark:bg-slate-700/80 font-black text-slate-900 dark:text-white'
                          : isGeneral
                          ? 'bg-slate-50 dark:bg-slate-800/80 font-bold text-slate-800 dark:text-slate-100'
                          : isSubsidiary
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-500 dark:text-slate-400 text-[11px] bg-slate-50/30'
                      }`}
                    >
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 text-slate-400 font-mono">
                        {formatPersianNumber(idx + 1)}
                      </td>
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono font-bold">
                        {r.code}
                      </td>
                      <td className="py-2 px-4 border-l border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-1.5" style={{ paddingRight: `${isGroup ? 0 : isGeneral ? 12 : isSubsidiary ? 24 : 36}px` }}>
                          {isGroup && <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />}
                          {isGeneral && <Folder className="w-3.5 h-3.5 text-blue-500" />}
                          {isSubsidiary && <Layers className="w-3.5 h-3.5 text-slate-400" />}
                          <span>{r.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-center border-l border-slate-200 dark:border-slate-700">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isGroup ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300' :
                          isGeneral ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' :
                          isSubsidiary ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' :
                          'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
                        }`}>
                          {isGroup ? 'گروه' : isGeneral ? 'کل' : isSubsidiary ? 'معین' : 'تفصیلی'}
                        </span>
                      </td>

                      {/* 8-Cols: Initial Turnovers */}
                      {trialCols === '8' && (
                        <>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.initialDebit ? formatPersianPrice(r.initialDebit) : '-'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.initialCredit ? formatPersianPrice(r.initialCredit) : '-'}
                          </td>
                        </>
                      )}

                      {/* Period Turnover */}
                      {(trialCols === '4' || trialCols === '6' || trialCols === '8') && (
                        <>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.debitTurnover ? formatPersianPrice(r.debitTurnover) : '-'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.creditTurnover ? formatPersianPrice(r.creditTurnover) : '-'}
                          </td>
                        </>
                      )}

                      {/* Total Turnover */}
                      {(trialCols === '6' || trialCols === '8') && (
                        <>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.totalDebit ? formatPersianPrice(r.totalDebit) : '-'}
                          </td>
                          <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono">
                            {r.totalCredit ? formatPersianPrice(r.totalCredit) : '-'}
                          </td>
                        </>
                      )}

                      {/* Closing Balances */}
                      <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {r.debitBalance ? formatPersianPrice(r.debitBalance) : '-'}
                      </td>
                      <td className="py-2 px-3 text-left font-mono font-bold text-rose-600 dark:text-rose-400">
                        {r.creditBalance ? formatPersianPrice(r.creditBalance) : '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Grand Totals Footer */}
            {filteredTrialRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-200/90 dark:bg-slate-700 font-black text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-600">
                  <td colSpan={4} className="py-3 px-4 text-center border-l border-slate-300 dark:border-slate-600">
                    جمع کل تراز آزمایشی
                  </td>

                  {trialCols === '8' && (
                    <>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.initialDebit)}
                      </td>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.initialCredit)}
                      </td>
                    </>
                  )}

                  {(trialCols === '4' || trialCols === '6' || trialCols === '8') && (
                    <>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.debitTurnover)}
                      </td>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.creditTurnover)}
                      </td>
                    </>
                  )}

                  {(trialCols === '6' || trialCols === '8') && (
                    <>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.totalDebit)}
                      </td>
                      <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono">
                        {formatPersianPrice(trialTotals.totalCredit)}
                      </td>
                    </>
                  )}

                  <td className="py-3 px-3 text-left border-l border-slate-300 dark:border-slate-600 font-mono text-emerald-700 dark:text-emerald-300">
                    {formatPersianPrice(trialTotals.debitBalance)}
                  </td>
                  <td className="py-3 px-3 text-left font-mono text-rose-700 dark:text-rose-300">
                    {formatPersianPrice(trialTotals.creditBalance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
