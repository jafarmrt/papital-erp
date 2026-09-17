import { FileSpreadsheet } from 'lucide-react';
import { formatPersianPrice } from '../../../utils';
import type { BalanceSheetReport } from '../../../types';

interface BalanceSheetViewProps {
  balanceSheet: BalanceSheetReport | null;
  onApplyBalanceSheetFilter: () => void;
}

export function BalanceSheetView({
  balanceSheet,
  onApplyBalanceSheetFilter
}: BalanceSheetViewProps) {
  const safeAssets = Array.isArray(balanceSheet?.assets) ? balanceSheet.assets : [];
  const safeLiabilities = Array.isArray(balanceSheet?.liabilities) ? balanceSheet.liabilities : [];
  const safeEquity = Array.isArray(balanceSheet?.equity) ? balanceSheet.equity : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-600" />
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">ترازنامه اساسی (Balance Sheet)</h4>
            <p className="text-xs text-slate-500">وضعیت دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام شرکت</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onApplyBalanceSheetFilter}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition"
          >
            به‌روزرسانی ترازنامه
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Right Column: Assets */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <h5 className="font-bold text-slate-900 dark:text-white text-sm">دارایی‌ها (Assets)</h5>
            <span className="font-mono font-bold text-emerald-600">{formatPersianPrice(balanceSheet?.totalAssets || 0)}</span>
          </div>

          <div className="space-y-2 text-xs">
            {safeAssets.length === 0 ? (
              <div className="text-slate-400 py-4 text-center">اطلاعاتی ثبت نشده است</div>
            ) : (
              safeAssets.map((a, i) => (
                <div key={i} className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-750">
                  <span className="text-slate-700 dark:text-slate-300">{a.code} - {a.name}</span>
                  <span className="font-mono font-bold">{formatPersianPrice(a.amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Left Column: Liabilities & Equity */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <h5 className="font-bold text-slate-900 dark:text-white text-sm">بدهی‌ها و حقوق صاحبان سهام</h5>
            <span className="font-mono font-bold text-rose-600">{formatPersianPrice(balanceSheet?.totalLiabilitiesAndEquity || 0)}</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="font-bold text-slate-500 mb-1">بدهی‌ها:</div>
              {safeLiabilities.map((l, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-750">
                  <span>{l.code} - {l.name}</span>
                  <span className="font-mono font-bold">{formatPersianPrice(l.amount)}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="font-bold text-slate-500 mb-1">حقوق صاحبان سهام و سود:</div>
              {safeEquity.map((e, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-750">
                  <span>{e.code} - {e.name}</span>
                  <span className="font-mono font-bold">{formatPersianPrice(e.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
