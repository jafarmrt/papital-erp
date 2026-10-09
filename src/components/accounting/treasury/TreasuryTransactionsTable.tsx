import React, { useMemo } from 'react';
import {
  Search,
  Download,
  Calendar,
  X,
  Copy,
  Check,
  Paperclip,
  AlertTriangle,
  Link2,
  ChevronRight,
  ChevronLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Unlink,
} from 'lucide-react';
import { formatPersianPrice, formatPersianDate } from '../../../utils';
import { isRialCurrency, rialDisplayOf } from '../../../lib/rialDisplay';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { treasuryMethodLabel, treasuryPartyTypeLabel } from '../../../lib/treasury/treasuryExport';
import type { BankAccount, TreasuryTransaction, FinancialAttachment } from '../../../types';
import { personnelPurposeLabel } from '../../../lib/treasury/partyPurpose';
import { canRelinkTreasuryRow } from '../../../lib/treasury/treasuryRelink';

interface TreasuryTransactionsTableProps {
  transactions: TreasuryTransaction[];
  totalFilteredCount: number;
  bankAccounts: BankAccount[];
  runningBalanceMap: Map<number, number>;
  appCurrency: string;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  selectedTypeFilter: string;
  setSelectedTypeFilter: (t: string) => void;
  selectedMethodFilter: string;
  setSelectedMethodFilter: (m: string) => void;
  txAccountFilter: string;
  setTxAccountFilter: (a: string) => void;
  dateFromFilter: string;
  setDateFromFilter: (d: string) => void;
  dateToFilter: string;
  setDateToFilter: (d: string) => void;
  txPage: number;
  setTxPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  onExportExcel: () => void;
  onViewAttachments: (info: { title: string; attachments: FinancialAttachment[] }) => void;
  onVoidTransaction: (tx: TreasuryTransaction) => void;
  /** v9.0.272 (TD-779): جدا کردن دریافت یا پرداخت از سندش («علی‌الحساب») */
  onDetachDocument?: (tx: TreasuryTransaction) => void;
  /** v10.0.40 (TD-1122): انتقال دریافت یا پرداخت به سند فعال دیگر همان طرف حساب */
  onRelinkDocument?: (tx: TreasuryTransaction) => void;
}

export const TreasuryTransactionsTable: React.FC<TreasuryTransactionsTableProps> = React.memo(({
  transactions,
  totalFilteredCount,
  bankAccounts,
  runningBalanceMap,
  appCurrency,
  searchQuery,
  setSearchQuery,
  selectedTypeFilter,
  setSelectedTypeFilter,
  selectedMethodFilter,
  setSelectedMethodFilter,
  txAccountFilter,
  setTxAccountFilter,
  dateFromFilter,
  setDateFromFilter,
  dateToFilter,
  setDateToFilter,
  txPage,
  setTxPage,
  pageSize,
  copiedId,
  onCopy,
  onExportExcel,
  onViewAttachments,
  onVoidTransaction,
  onDetachDocument,
  onRelinkDocument,
}) => {
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  // v9.0.102 (TD-509): `transactions` همان صفحه جاری است که سرور برگردانده (شمار کل در totalFilteredCount)
  const pagedTransactions = transactions;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
      {/* Header & Filter Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              گردش اسناد دریافت و پرداخت خزانه‌داری
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              نمایش {pagedTransactions.length} از {totalFilteredCount} تراکنش منطبق با فیلترها
            </p>
          </div>

          <button
            onClick={onExportExcel}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-xl border border-emerald-200 dark:border-emerald-800/60 transition cursor-pointer self-start sm:self-auto"
          >
            <Download size={14} />
            خروجی اکسل گردش خزانه
          </button>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2">
          {/* Search input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="جستجو در طرف حساب، شماره، شرح..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setTxPage(1); }}
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Type filter */}
          <select
            value={selectedTypeFilter}
            onChange={e => { setSelectedTypeFilter(e.target.value); setTxPage(1); }}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl outline-none"
          >
            <option value="all">همه تراکنش‌ها (دریافت و پرداخت)</option>
            <option value="receipt">فقط دریافت‌ها (واریز/رسید)</option>
            <option value="payment">فقط پرداخت‌ها (اعلام پرداخت)</option>
          </select>

          {/* Method filter */}
          <select
            value={selectedMethodFilter}
            onChange={e => { setSelectedMethodFilter(e.target.value); setTxPage(1); }}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl outline-none"
          >
            <option value="all">همه روش‌های پرداخت</option>
            <option value="bank_transfer">حواله / پایا / ساتنا</option>
            <option value="pos">کارتخوان (POS)</option>
            <option value="cash">نقدی / صندوق</option>
            <option value="cheque">چک</option>
          </select>

          {/* Account filter */}
          <select
            value={txAccountFilter}
            onChange={e => { setTxAccountFilter(e.target.value); setTxPage(1); }}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl outline-none"
          >
            <option value="all">همه حساب‌ها و صندوق‌ها</option>
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.title} ({b.code})
              </option>
            ))}
          </select>

          {/* Jalali Date Range */}
          <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-2 py-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <JalaliDateInput
              value={dateFromFilter}
              onChange={iso => { setDateFromFilter(iso); setTxPage(1); }}
              calendarPosition="bottom-right"
              placeholder="از تاریخ"
              className="w-full bg-transparent text-[11px] outline-none text-center"
              containerClassName="w-full"
            />
            <span className="text-slate-400 text-xs">تا</span>
            <JalaliDateInput
              value={dateToFilter}
              onChange={iso => { setDateToFilter(iso); setTxPage(1); }}
              calendarPosition="bottom-right"
              placeholder="تا تاریخ"
              className="w-full bg-transparent text-[11px] outline-none text-center"
              containerClassName="w-full"
            />
            {(dateFromFilter || dateToFilter) && (
              <button
                onClick={() => { setDateFromFilter(''); setDateToFilter(''); setTxPage(1); }}
                title="پاکسازی تاریخ"
                className="text-slate-400 hover:text-rose-500 p-1"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-50/80 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="py-3 px-3 text-center">#</th>
              <th className="py-3 px-3">شماره رسید</th>
              <th className="py-3 px-3">تاریخ</th>
              <th className="py-3 px-3">نوع</th>
              <th className="py-3 px-3">طرف حساب</th>
              <th className="py-3 px-3">روش و حساب</th>
              <th className="py-3 px-3">شرح</th>
              <th className="py-3 px-3 text-left">مبلغ ({rial.label})</th>
              {txAccountFilter !== 'all' && (
                <th className="py-3 px-3 text-left">مانده جاری</th>
              )}
              <th className="py-3 px-3 text-center">سند حسابداری</th>
              <th className="py-3 px-3 text-center">ثبت‌کننده</th>
              <th className="py-3 px-3 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {pagedTransactions.length === 0 ? (
              <tr>
                <td colSpan={txAccountFilter !== 'all' ? 12 : 11} className="py-12 text-center text-slate-400 text-xs">
                  هیچ تراکنشی منطبق با فیلترهای جاری یافت نشد.
                </td>
              </tr>
            ) : (
              pagedTransactions.map((tx, idx) => {
                const isReceipt = tx.type === 'receipt';
                const isVoided = tx.status === 'voided';
                const runningBal = runningBalanceMap.get(tx.id);

                return (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition ${
                      isVoided ? 'opacity-60 bg-rose-50/20 dark:bg-rose-950/10' : ''
                    }`}
                  >
                    <td className="py-3 px-3 text-center text-slate-400 font-mono text-[11px]">
                      {(txPage - 1) * pageSize + idx + 1}
                    </td>

                    {/* Receipt / Tx Number */}
                    <td className="py-3 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                      <div className="flex items-center gap-1">
                        <span>{tx.transactionNumber}</span>
                        <button
                          onClick={() => onCopy(tx.transactionNumber, `tx-${tx.id}`)}
                          className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                          title="کپی شماره تراکنش"
                        >
                          {copiedId === `tx-${tx.id}` ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </td>

                    {/* Date */}
                    <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                      {formatPersianDate(tx.date)}
                    </td>

                    {/* Type & Void Status */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isReceipt
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {isReceipt ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                          {isReceipt ? 'دریافت' : 'پرداخت'}
                        </span>
                        {isVoided && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-200 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200">
                            ابطال‌شده
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Party */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tx.partyName || '—'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {treasuryPartyTypeLabel(tx.partyType)}
                        {tx.purpose && <span className="mr-1">({personnelPurposeLabel(tx.purpose)})</span>}
                        {tx.contraAccountName && <span className="mr-1">← {tx.contraAccountName}</span>}
                      </div>
                    </td>

                    {/* Method & Bank */}
                    <td className="py-3 px-3">
                      <div className="text-slate-800 dark:text-slate-200 font-medium">
                        {tx.bankAccountTitle || '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {treasuryMethodLabel(tx.method)}
                        {tx.trackingNumber && ` • پیگیری: ${tx.trackingNumber}`}
                      </div>
                    </td>

                    {/* Description & Attachments */}
                    <td className="py-3 px-3 max-w-[200px]">
                      <div className="truncate text-slate-600 dark:text-slate-300 text-[11px]" title={tx.description || undefined}>
                        {tx.description || '—'}
                      </div>
                      {Array.isArray(tx.attachments) && tx.attachments.length > 0 && (
                        <button
                          onClick={() => onViewAttachments({
                            title: `پیوست‌های سند ${tx.transactionNumber}`,
                            attachments: tx.attachments as FinancialAttachment[],
                          })}
                          className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 font-bold cursor-pointer"
                        >
                          <Paperclip size={10} />
                          {tx.attachments.length} فایل پیوست
                        </button>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-3 text-left font-mono font-bold">
                      <span className={isReceipt ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                        {isReceipt ? '+' : '-'}{isRialCurrency(tx.currency) ? rial.number(tx.amount) : formatPersianPrice(tx.amount, String(tx.currency).trim())}
                      </span>
                    </td>

                    {/* Running balance (if single account filtered) */}
                    {txAccountFilter !== 'all' && (
                      <td className="py-3 px-3 text-left font-mono font-bold text-slate-700 dark:text-slate-200">
                        {runningBal !== undefined ? (
                          <span className={runningBal >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500'}>
                            {rial.money(runningBal, tx.currency)}
                          </span>
                        ) : '—'}
                      </td>
                    )}

                    {/* Accounting Voucher */}
                    <td className="py-3 px-3 text-center">
                      {tx.voucherId ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 rounded border border-indigo-200 dark:border-indigo-800/50">
                          سند #{tx.voucherId}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>

                    {/* Creator */}
                    <td className="py-3 px-3 text-center text-slate-500 text-[11px]">
                      {tx.creatorName || 'سیستم'}
                    </td>

                    {/* Actions */}
                    {/* v9.0.67 (TD-499، ت۱): ردیف معکوس (ابطال تراکنش دیگر) دکمه ابطال ندارد؛ سرور هم آن را رد می‌کند */}
                    <td className="py-3 px-3 text-center">
                      {!isVoided && !(tx.reversalOfId ?? tx.reversal_of_id) ? (
                        <div className="inline-flex items-center gap-1">
                          {/* v9.0.272 (TD-779): دریافت یا پرداخت وصل به سند «علی‌الحساب» می‌شود تا سند باطل‌شدنی شود */}
                          {onDetachDocument && (tx.documentId ?? tx.document_id) && !(tx.payrollId ?? tx.payroll_id) ? (
                            <button
                              onClick={() => onDetachDocument(tx)}
                              title="جدا کردن از سند (علی‌الحساب)"
                              aria-label="جدا کردن از سند (علی‌الحساب)"
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition cursor-pointer"
                            >
                              <Unlink size={14} />
                            </button>
                          ) : null}
                          {onRelinkDocument && canRelinkTreasuryRow({
                            type: tx.type, partyType: tx.partyType ?? tx.party_type, status: tx.status,
                            reversalOfId: tx.reversalOfId ?? tx.reversal_of_id, payrollId: tx.payrollId ?? tx.payroll_id,
                          }) ? (
                            <button
                              onClick={() => onRelinkDocument(tx)}
                              title="انتقال به سند دیگر"
                              aria-label="انتقال به سند دیگر"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition cursor-pointer"
                            >
                              <Link2 size={14} />
                            </button>
                          ) : null}
                          <button
                            onClick={() => onVoidTransaction(tx)}
                            title="ابطال تراکنش و ثبت سند معکوس"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                          >
                            <AlertTriangle size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-mono">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <div>
            صفحه <span className="font-bold text-slate-800 dark:text-slate-200">{txPage}</span> از{' '}
            <span className="font-bold text-slate-800 dark:text-slate-200">{totalPages}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setTxPage(p => Math.max(1, p - 1))}
              disabled={txPage === 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => setTxPage(p => Math.min(totalPages, p + 1))}
              disabled={txPage === totalPages}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

TreasuryTransactionsTable.displayName = 'TreasuryTransactionsTable';
