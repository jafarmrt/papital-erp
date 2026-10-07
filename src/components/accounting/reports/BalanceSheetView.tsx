import { FileSpreadsheet } from 'lucide-react';
import { formatPersianPrice } from '../../../utils';
import type { BalanceSheetReport } from '../../../types';
import { statementRows, type StatementRow } from '../../../lib/accounting/financialStatements';
import { AsOfDateField, asOfCaption } from './ReportDateFields';

interface BalanceSheetViewProps {
  balanceSheet: BalanceSheetReport | null;
  /** v9.0.110 (TD-566): تاریخ ترازنامه (ISO)؛ خالی یعنی تا امروز */
  asOfDate: string;
  onAsOfDateChange: (iso: string) => void;
  onApplyBalanceSheetFilter: () => void;
}

/** یک بخش ترازنامه: عنوان و جمع، سپس ردیف‌های حساب */
function StatementSection({ title, rows, total }: { title: string; rows: StatementRow[]; total: number }) {
  return (
    <div>
      <div className="flex justify-between font-bold text-slate-500 mb-1">
        <span>{title}</span>
        <span className="font-mono">{formatPersianPrice(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-slate-400 py-1.5">اطلاعاتی ثبت نشده است</div>
      ) : (
        rows.map((row, i) => (
          <div key={`${row.code}-${i}`} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-750">
            <span className="text-slate-700 dark:text-slate-300">{row.code} - {row.name}</span>
            <span className="font-mono font-bold">{formatPersianPrice(row.amount)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function BalanceSheetView({
  balanceSheet,
  asOfDate,
  onAsOfDateChange,
  onApplyBalanceSheetFilter
}: BalanceSheetViewProps) {
  // v9.0.108 (TD-563): بخش‌های پاسخ سرور (دارایی جاری و غیرجاری، بدهی جاری، حقوق صاحبان سهام، سود دوره)،
  // نه `assets` و `liabilities` که سرور هرگز نمی‌فرستد
  const currentAssets = statementRows(balanceSheet?.currentAssets);
  const nonCurrentAssets = statementRows(balanceSheet?.nonCurrentAssets);
  const currentLiabilities = statementRows(balanceSheet?.currentLiabilities);
  const equity = statementRows(balanceSheet?.equity);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-600" />
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm">ترازنامه اساسی (Balance Sheet)</h4>
            <p className="text-xs text-slate-500">وضعیت دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام شرکت</p>
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mt-0.5">{asOfCaption(asOfDate)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AsOfDateField value={asOfDate} onChange={onAsOfDateChange} />
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

          <div className="space-y-3 text-xs">
            <StatementSection title="دارایی‌های جاری" rows={currentAssets} total={balanceSheet?.totalCurrentAssets || 0} />
            <StatementSection title="دارایی‌های غیرجاری" rows={nonCurrentAssets} total={balanceSheet?.totalNonCurrentAssets || 0} />
          </div>
        </div>

        {/* Left Column: Liabilities & Equity */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <h5 className="font-bold text-slate-900 dark:text-white text-sm">بدهی‌ها و حقوق صاحبان سهام</h5>
            <span className="font-mono font-bold text-rose-600">{formatPersianPrice(balanceSheet?.totalLiabilitiesAndEquity || 0)}</span>
          </div>

          <div className="space-y-3 text-xs">
            <StatementSection title="بدهی‌های جاری" rows={currentLiabilities} total={balanceSheet?.totalCurrentLiabilities || 0} />
            <StatementSection title="حقوق صاحبان سهام" rows={equity} total={balanceSheet?.totalEquity || 0} />
            <div className="flex justify-between py-1.5 font-bold text-slate-700 dark:text-slate-300 border-t border-slate-200 dark:border-slate-700">
              <span>سود (زیان) دوره</span>
              <span className="font-mono">{formatPersianPrice(balanceSheet?.netProfitPeriod || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
