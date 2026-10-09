import { useState, useCallback, useMemo } from 'react';
import { 
  Building2, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ArrowLeftRight, 
  TrendingUp, 
  RefreshCw 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';
import { errorMessageOf, getTodayJalaliDate } from '../../utils';
import { treasuryExportFileName, treasuryExportRows } from '../../lib/treasury/treasuryExport';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { useDebounce } from '../../hooks/useDebounce';
import { fetchTreasuryTransactions, useTreasuryDocumentDetach, useTreasuryDocumentRelink, useTreasuryTransactionPageQuery, type TreasuryListFilters } from '../../hooks/accounting/useTreasuryQueries';
import { BankReconciliationModal } from './reconciliation/BankReconciliationModal';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';

// Modular Sub-components & Hook (Phase 6.1 Refactoring)
import { useTreasuryCalculations } from './treasury/useTreasuryCalculations';
import { TreasuryHealthBanner } from './treasury/TreasuryHealthBanner';
import { BankAccountGrid } from './treasury/BankAccountGrid';
import { TreasuryTransactionsTable } from './treasury/TreasuryTransactionsTable';
import { BankAccountModal } from './treasury/BankAccountModal';
import { TreasuryTransactionModal } from './treasury/TreasuryTransactionModal';
import { TreasuryTransferModal } from './treasury/TreasuryTransferModal';
import { TreasuryVoidModal } from './treasury/TreasuryVoidModal';
import { TreasuryRelinkModal } from './treasury/TreasuryRelinkModal';
import { CashFlowModal } from './treasury/CashFlowModal';

import type { 
  BankAccount, 
  TreasuryTransaction, 
  Customer, 
  Personnel, 
  Account, 
  FinancialAttachment 
} from '../../types';
import { copyToClipboard } from '../../utils/clipboard';

export interface BankAndTreasuryTabProps {
  bankAccounts: BankAccount[];
  customers: Customer[];
  personnelList: Personnel[];
  accounts: Account[];
  loading?: boolean;
  isSyncingBanks?: boolean;
  onRefresh?: () => void;
  onSyncAndReconcileBanks?: () => void;
  onCreateBankAccount: (data: any) => Promise<void>;
  onUpdateBankAccount: (id: number, data: any) => Promise<void>;
  onDeleteBankAccount: (id: number) => Promise<void>;
  onCreateTreasuryTransaction: (data: any) => Promise<void>;
  onVoidTreasuryTransaction: (id: number, reason: string) => Promise<void>;
  onCreateTreasuryTransfer: (data: any) => Promise<void>;
  onReconcileTransactions?: (bankAccountId: number, txIds: number[], batch: string, reconciled: boolean) => Promise<void>;
}

export function BankAndTreasuryTab({
  bankAccounts,
  customers,
  personnelList,
  accounts,
  loading = false,
  isSyncingBanks = false,
  onRefresh,
  onSyncAndReconcileBanks,
  onCreateBankAccount,
  onUpdateBankAccount,
  onDeleteBankAccount,
  onCreateTreasuryTransaction,
  onVoidTreasuryTransaction,
  onCreateTreasuryTransfer,
  onReconcileTransactions,
}: BankAndTreasuryTabProps) {
  const appCurrency = useAppCurrency();

  // Modals state
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txModalType, setTxModalType] = useState<'receipt' | 'payment'>('receipt');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isCashFlowModalOpen, setIsCashFlowModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<TreasuryTransaction | null>(null);
  const [reconciliationBankId, setReconciliationBankId] = useState<number | null>(null);
  const [viewingAttachments, setViewingAttachments] = useState<{ title: string; attachments: FinancialAttachment[] } | null>(null);

  // Clipboard feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = useCallback((text: string, id: string) => {
    void copyToClipboard(text).then(ok => {
      if (!ok) return;
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  // Filter and Pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 350);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('all');
  const [selectedMethodFilter, setSelectedMethodFilter] = useState('all');
  const [txAccountFilter, setTxAccountFilter] = useState('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [txPage, setTxPage] = useState(1);
  const pageSize = 20;

  const { safeBankAccounts, summary } = useTreasuryCalculations({ bankAccounts });

  // v9.0.102 (TD-509، B04-13): فقط صفحه جاری با فیلترها از سرور خوانده می‌شود؛ شمار کل و مانده جاری هم از سرور می‌آید
  const listFilters = useMemo<TreasuryListFilters>(() => ({
    type: selectedTypeFilter,
    method: selectedMethodFilter,
    bankAccountId: txAccountFilter,
    startDate: dateFromFilter,
    endDate: dateToFilter,
    q: debouncedSearchQuery,
  }), [selectedTypeFilter, selectedMethodFilter, txAccountFilter, dateFromFilter, dateToFilter, debouncedSearchQuery]);
  const transactionPageQuery = useTreasuryTransactionPageQuery(listFilters, txPage, pageSize);
  const pageTransactions = useMemo(() => transactionPageQuery.data?.data ?? [], [transactionPageQuery.data]);
  const totalFilteredCount = transactionPageQuery.data?.total ?? 0;
  const runningBalanceMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const tx of pageTransactions) {
      if (tx.runningBalance !== undefined && tx.runningBalance !== null) map.set(tx.id, Number(tx.runningBalance));
    }
    return map;
  }, [pageTransactions]);

  // Action Handlers
  const handleSaveBank = async (data: any, editingId?: number) => {
    try {
      if (editingId) {
        await onUpdateBankAccount(editingId, data);
        toast.success('حساب با موفقیت ویرایش شد');
      } else {
        await onCreateBankAccount(data);
        toast.success('حساب جدید با موفقیت ایجاد شد');
      }
      setIsBankModalOpen(false);
      setEditingBank(null);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ذخیره حساب');
      throw err;
    }
  };

  const handleDeleteBank = async (id: number, title: string) => {
    const ok = await confirmAction({
      title: 'حذف حساب بانکی',
      message: `آیا از حذف حساب «${title}» اطمینان دارید؟`,
    });
    if (!ok) return;
    try {
      await onDeleteBankAccount(id);
      toast.success('حساب با موفقیت حذف شد');
    } catch (err: any) {
      toast.error(err?.message || 'خطا در حذف حساب');
    }
  };

  const handleSaveTransaction = async (data: any) => {
    try {
      await onCreateTreasuryTransaction(data);
      toast.success(data.type === 'receipt' ? 'رسید دریافت با موفقیت ثبت شد' : 'اعلام پرداخت با موفقیت ثبت شد');
      setIsTxModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت تراکنش');
      throw err;
    }
  };

  const handleSaveTransfer = async (data: any) => {
    try {
      await onCreateTreasuryTransfer(data);
      toast.success('انتقال بین‌بانکی با سند حسابداری ثبت شد');
      setIsTransferModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت انتقال');
      throw err;
    }
  };

  const handleConfirmVoid = async (id: number, reason: string) => {
    try {
      await onVoidTreasuryTransaction(id, reason);
      toast.success('تراکنش با سند معکوس ابطال شد');
      setVoidTarget(null);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ابطال تراکنش');
      throw err;
    }
  };

  // v9.0.272 (TD-779، ت۴ الف): دریافت یا پرداخت از سندش جدا و «علی‌الحساب» می‌شود؛ سند حسابداری آن عوض نمی‌شود
  const detachDocument = useTreasuryDocumentDetach();
  const handleDetachDocument = async (tx: TreasuryTransaction) => {
    const ok = await confirmAction({
      title: 'علی‌الحساب کردن تراکنش',
      message: `تراکنش «${tx.transactionNumber || tx.id}» از سندش جدا و علی‌الحساب می‌شود؛ سند حسابداری آن تغییر نمی‌کند و مبلغ دیگر در تسویه آن سند شمرده نمی‌شود. ادامه می‌دهید؟`,
    });
    if (!ok) return;
    try {
      await detachDocument.mutateAsync(tx.id);
      toast.success('تراکنش علی‌الحساب شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در جدا کردن تراکنش از سند');
    }
  };

  // v10.0.40 (TD-1122): انتقال دریافت یا پرداخت به سند فعال دیگر همان طرف حساب
  const relinkDocument = useTreasuryDocumentRelink();
  const [relinkTarget, setRelinkTarget] = useState<TreasuryTransaction | null>(null);
  const handleRelinkDocument = async (id: number, documentId: number) => {
    try {
      await relinkDocument.mutateAsync({ id, documentId });
      toast.success('تراکنش به سند انتخابی منتقل شد');
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در انتقال تراکنش به سند دیگر');
      throw err;
    }
  };

  const handleExportExcel = useCallback(async () => {
    let rows: TreasuryTransaction[];
    try {
      rows = await fetchTreasuryTransactions(listFilters);
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : 'خواندن تراکنش‌ها برای خروجی اکسل ممکن نشد');
      return;
    }
    // v9.0.106 (TD-515): برچسب فارسی روش و نوع طرف، نام فایل با تاریخ شمسی امروز (نه روز UTC)
    try {
      const ws = XLSX.utils.json_to_sheet(treasuryExportRows(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'گردش خزانه');
      XLSX.writeFile(wb, treasuryExportFileName(getTodayJalaliDate()));
    } catch {
      toast.error('فایل اکسل ساخته نشد. دوباره تلاش کنید.');
    }
  }, [listFilters]);

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div>
          <h2 className="font-extrabold text-slate-900 dark:text-white text-lg sm:text-xl flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            بانک، صندوق و خزانه‌داری
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            مدیریت جامع حساب‌های بانکی، صندوق نقد کارگاه، دستگاه‌های کارتخوان و جریان وجوه نقد با تطبیق با دفاتر حسابداری لحظه‌ای
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsCashFlowModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-xl border border-indigo-200 dark:border-indigo-800/60 transition cursor-pointer"
          >
            <TrendingUp size={14} />
            گزارش جریان نقدینگی
          </button>

          {onSyncAndReconcileBanks && (
            <button
              onClick={onSyncAndReconcileBanks}
              disabled={isSyncingBanks}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isSyncingBanks ? 'animate-spin text-indigo-600' : ''} />
              همگام‌سازی و مغایرت‌گیری بانکی
            </button>
          )}

          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded-xl border border-amber-200 dark:border-amber-800/60 transition cursor-pointer"
          >
            <ArrowLeftRight size={14} />
            انتقال وجه بین حساب‌ها
          </button>

          <button
            onClick={() => { setTxModalType('payment'); setIsTxModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-xl border border-rose-200 dark:border-rose-800/60 transition cursor-pointer"
          >
            <ArrowUpRight size={14} />
            ثبت اعلام پرداخت
          </button>

          <button
            onClick={() => { setTxModalType('receipt'); setIsTxModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-sm transition cursor-pointer"
          >
            <ArrowDownLeft size={14} />
            ثبت رسید دریافت
          </button>
        </div>
      </div>

      {/* Real-time Health and Discrepancy Overview Banner */}
      <TreasuryHealthBanner
        totalLedgerBalance={summary.totalLedgerBalance}
        totalTreasuryBalance={summary.totalTreasuryBalance}
        totalDiscrepancy={summary.totalDiscrepancy}
        syncedAccountsCount={summary.syncedAccountsCount}
        discrepantAccountsCount={summary.discrepantAccountsCount}
        totalAccountsCount={summary.totalAccountsCount}
        appCurrency={appCurrency}
      />

      {/* Bank & Cash Accounts Grid */}
      <BankAccountGrid
        bankAccounts={safeBankAccounts}
        appCurrency={appCurrency}
        copiedId={copiedId}
        onCopy={handleCopy}
        onEdit={(bank) => { setEditingBank(bank); setIsBankModalOpen(true); }}
        onDelete={handleDeleteBank}
        onReconcile={(bankId) => setReconciliationBankId(bankId)}
        onNewAccount={() => { setEditingBank(null); setIsBankModalOpen(true); }}
      />

      {/* Treasury Transactions Ledger Table */}
      <TreasuryTransactionsTable
        transactions={pageTransactions}
        totalFilteredCount={totalFilteredCount}
        bankAccounts={safeBankAccounts}
        runningBalanceMap={runningBalanceMap}
        appCurrency={appCurrency}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedTypeFilter={selectedTypeFilter}
        setSelectedTypeFilter={setSelectedTypeFilter}
        selectedMethodFilter={selectedMethodFilter}
        setSelectedMethodFilter={setSelectedMethodFilter}
        txAccountFilter={txAccountFilter}
        setTxAccountFilter={setTxAccountFilter}
        dateFromFilter={dateFromFilter}
        setDateFromFilter={setDateFromFilter}
        dateToFilter={dateToFilter}
        setDateToFilter={setDateToFilter}
        txPage={txPage}
        setTxPage={setTxPage}
        pageSize={pageSize}
        copiedId={copiedId}
        onCopy={handleCopy}
        onExportExcel={() => { void handleExportExcel(); }}
        onViewAttachments={(info) => setViewingAttachments(info)}
        onVoidTransaction={(tx) => setVoidTarget(tx)}
        onDetachDocument={(tx) => { void handleDetachDocument(tx); }}
        onRelinkDocument={setRelinkTarget}
      />

      {/* Bank Reconciliation Modal */}
      {reconciliationBankId && (
        <BankReconciliationModal
          isOpen={!!reconciliationBankId}
          onClose={() => setReconciliationBankId(null)}
          bankAccounts={safeBankAccounts}
          initialBankAccountId={reconciliationBankId}
          onReconcileTransactions={onReconcileTransactions}
        />
      )}

      {/* Cash Flow Report Modal */}
      <CashFlowModal
        isOpen={isCashFlowModalOpen}
        onClose={() => setIsCashFlowModalOpen(false)}
      />

      {/* Inter-bank Transfer Modal */}
      <TreasuryTransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        bankAccounts={safeBankAccounts}
        appCurrency={appCurrency}
        onSave={handleSaveTransfer}
      />

      {/* Void Transaction Modal */}
      <TreasuryVoidModal
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={handleConfirmVoid}
      />

      <TreasuryRelinkModal target={relinkTarget} onClose={() => setRelinkTarget(null)} onConfirm={handleRelinkDocument} />

      {/* Define / Edit Bank Account Modal */}
      <BankAccountModal
        isOpen={isBankModalOpen}
        onClose={() => { setIsBankModalOpen(false); setEditingBank(null); }}
        editingBank={editingBank}
        accounts={accounts}
        appCurrency={appCurrency}
        onSave={handleSaveBank}
      />

      {/* New Treasury Transaction Modal */}
      <TreasuryTransactionModal
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        type={txModalType}
        bankAccounts={safeBankAccounts}
        customers={customers}
        personnelList={personnelList}
        appCurrency={appCurrency}
        onSave={handleSaveTransaction}
      />

      {/* Financial Attachments Viewer Modal */}
      {viewingAttachments && (
        <FinancialAttachmentViewerModal
          isOpen={!!viewingAttachments}
          onClose={() => setViewingAttachments(null)}
          title={viewingAttachments?.title || 'اسناد و مدارک پیوست'}
          attachments={viewingAttachments?.attachments || []}
        />
      )}
    </div>
  );
}
