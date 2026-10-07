import { formatPersianPrice, formatPersianNumber, formatPersianDate } from '../../../utils';
import type { Account, AccountLedgerReport } from '../../../types';
import { accountCardRows } from '../../../lib/accounting/accountCard';

const LEVEL_LABELS: Record<string, string> = { group: 'گروه', general: 'کل', subsidiary: 'معین', detailed: 'تفصیلی' };

interface LedgerViewProps {
  accounts: Account[];
  ledgerReport: AccountLedgerReport | null;
  selectedLedgerAccountId: number | '';
  setSelectedLedgerAccountId: (val: number | '') => void;
  onApplyLedgerFilter: () => void;
  onFetchLedger: (accountId: number, startDate?: string, endDate?: string) => void;
  startDate?: string;
  endDate?: string;
}

export function LedgerView({
  accounts,
  ledgerReport,
  selectedLedgerAccountId,
  setSelectedLedgerAccountId,
  onApplyLedgerFilter,
  onFetchLedger,
  startDate,
  endDate
}: LedgerViewProps) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  // v9.0.112 (TD-574): ردیف «مانده ابتدای دوره» را سرور می‌فرستد (`isOpening`)؛ نما آن را دوباره نمی‌افزاید
  const safeLedgerItems = accountCardRows(ledgerReport);
  const openingRows = safeLedgerItems.filter(item => item.isOpening).length;
  // نام حساب در پاسخ کارت نیست؛ از فهرست حساب‌ها، و گروه و کل با همه زیرحساب‌هایشان (TD-570)
  const selectedAccount = safeAccounts.find(acc => acc.id === Number(selectedLedgerAccountId));
  const rollsUp = selectedAccount?.level === 'group' || selectedAccount?.level === 'general';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">انتخاب حساب معین:</span>
          <select
            value={selectedLedgerAccountId}
            onChange={e => {
              const val = Number(e.target.value);
              setSelectedLedgerAccountId(val || '');
              if (val) onFetchLedger(val, startDate || undefined, endDate || undefined);
            }}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white min-w-64"
          >
            <option value="">-- انتخاب حساب از لیست --</option>
            {safeAccounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.code} - {acc.name} ({LEVEL_LABELS[acc.level] ?? 'معین'})
              </option>
            ))}
          </select>

          <button
            onClick={onApplyLedgerFilter}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition"
          >
            مشاهده گردش
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 text-center">
          <h4 className="text-base font-black text-slate-900 dark:text-white">
            {selectedAccount
              ? `دفتر حساب ${LEVEL_LABELS[selectedAccount.level] ?? ''} ${selectedAccount.code} - ${selectedAccount.name}`
              : 'دفتر حساب'}
          </h4>
          {rollsUp && <p className="text-xs text-slate-500 mt-1">با گردش همه زیرحساب‌ها</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300">
                <th className="py-2.5 px-3 w-12 text-center border-l border-slate-200 dark:border-slate-700">#</th>
                <th className="py-2.5 px-3 w-24 text-center border-l border-slate-200 dark:border-slate-700">تاریخ</th>
                <th className="py-2.5 px-3 w-20 text-center border-l border-slate-200 dark:border-slate-700">شماره سند</th>
                <th className="py-2.5 px-4 border-l border-slate-200 dark:border-slate-700">شرح آرتیکل</th>
                <th className="py-2.5 px-3 w-28 text-center border-l border-slate-200 dark:border-slate-700">تفصیلی</th>
                <th className="py-2.5 px-3 w-32 text-left border-l border-slate-200 dark:border-slate-700">بدهکار</th>
                <th className="py-2.5 px-3 w-32 text-left border-l border-slate-200 dark:border-slate-700">بستانکار</th>
                <th className="py-2.5 px-3 w-32 text-left">مانده</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {safeLedgerItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    گردشی برای این حساب ثبت نشده است
                  </td>
                </tr>
              ) : (
                <>
                  {safeLedgerItems.map((item, idx) => (
                    <tr key={idx} className={`hover:bg-slate-50/70 dark:hover:bg-slate-750 ${item.isOpening ? 'bg-indigo-50/40 dark:bg-indigo-900/20 font-bold' : ''}`}>
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono text-slate-400">
                        {item.isOpening ? '—' : formatPersianNumber(idx + 1 - openingRows)}
                      </td>
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono">
                        {formatPersianDate(item.date)}
                      </td>
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-indigo-600">
                        {item.voucherNumber ? `#${item.voucherNumber}` : '—'}
                      </td>
                      <td className="py-2 px-4 border-l border-slate-200 dark:border-slate-700">
                        {item.description}
                        {rollsUp && !item.isOpening && item.accountCode && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{item.accountCode} - {item.accountName}</div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center border-l border-slate-200 dark:border-slate-700 text-purple-600">
                        {item.detailedName || '-'}
                      </td>
                      <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-emerald-600">
                        {item.debit ? formatPersianPrice(item.debit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono font-bold text-rose-600">
                        {item.credit ? formatPersianPrice(item.credit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-left font-mono font-bold">
                        {formatPersianPrice(item.runningBalance)}
                      </td>
                    </tr>
                  ))}
                  {/* V2.0.0: ردیف جمع نهایی */}
                  {safeLedgerItems.length > 0 && ledgerReport && (
                    <tr className="bg-slate-100 dark:bg-slate-700/50 font-black text-slate-900 dark:text-white border-t-2 border-slate-400 dark:border-slate-500">
                      <td colSpan={5} className="py-2.5 px-4 text-center border-l border-slate-200 dark:border-slate-700">
                        جمع کل گردش
                      </td>
                      <td className="py-2.5 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono text-emerald-700 dark:text-emerald-300">
                        {formatPersianPrice(ledgerReport.totalDebit)}
                      </td>
                      <td className="py-2.5 px-3 text-left border-l border-slate-200 dark:border-slate-700 font-mono text-rose-700 dark:text-rose-300">
                        {formatPersianPrice(ledgerReport.totalCredit)}
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono">
                        {formatPersianPrice(ledgerReport.finalBalance)}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
