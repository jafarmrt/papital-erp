import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/queryKeys';
import type { JournalVoucher } from '../types';
import toast from 'react-hot-toast';
import { useAccountingReports } from './useAccountingReports';
import { errorMessageOf } from '../utils';
import {
  useAccountingSummaryQuery,
  useAccountsListQuery,
  useAccountsTreeQuery,
  useAccountMutations,
  type AccountPayload,
} from './accounting/useAccountsQueries';
import {
  useVouchersQuery,
  useVoucherMutations,
  type VoucherCorrectionPayload,
  type VoucherPayload,
  type VoucherStatus,
} from './accounting/useVoucherQueries';
import {
  useBankAccountsQuery,
  useBankAccountOptionsQuery,
  useTreasuryMutations,
  type TreasuryPayload,
} from './accounting/useTreasuryQueries';
import { useChequesQuery, useChequeMutations, type ChequePayload } from './accounting/useChequeQueries';
import { useAccountingCustomersQuery, useAccountingPersonnelQuery } from './accounting/useAccountingParties';

// آرایه‌های خالی ثابت تا محاسبات وابسته به لیست‌ها در زمان بارگذاری با هر رندر دوباره اجرا نشوند
const NO_ACCOUNTS: never[] = [];
const NO_VOUCHERS: never[] = [];
const NO_BANK_ACCOUNTS: never[] = [];
const NO_BANK_ACCOUNT_OPTIONS: never[] = [];
const NO_CHEQUES: never[] = [];
const NO_CUSTOMERS: never[] = [];
const NO_PERSONNEL: never[] = [];

type AccountingTab = 'dashboard' | 'coa' | 'vouchers' | 'treasury' | 'cheques' | 'reports' | 'fiscal-closing' | 'explorer';

/**
 * صفحه حسابداری: داده‌ها با React Query (FE-005) از هوک‌های هر بخش (حساب‌ها، اسناد، خزانه، چک‌ها، گزارش‌ها) خوانده و
 * ذخیره می‌شوند؛ این هوک همان رابط پیشین را برای AccountingPage و تب‌ها نگه می‌دارد. هر ذخیره کش بخش‌های متاثر
 * (و صفحات دیگر: اسناد، لیست حقوق) را باطل می‌کند — نگاه کنید به accounting/accountingInvalidation.ts.
 */
export function useAccounting() {
  const [activeTab, setActiveTab] = useState<AccountingTab>('dashboard');
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const summaryQuery = useAccountingSummaryQuery();
  const accountsQuery = useAccountsListQuery();
  const treeQuery = useAccountsTreeQuery();
  // آخرین اسناد پیشخوان حسابداری؛ برگه «اسناد حسابداری» صفحه خود را از سرور می‌خواند (v9.0.115، TD-565)
  const vouchersQuery = useVouchersQuery();
  const bankAccountsQuery = useBankAccountsQuery();
  // v9.0.97 (TD-505، ت۷): دفتر چک فقط فهرست انتخاب را می‌خواند؛ فهرست کامل فقط برای خوانندگان خزانه
  const bankAccountOptionsQuery = useBankAccountOptionsQuery();
  const chequesQuery = useChequesQuery();
  const customersQuery = useAccountingCustomersQuery();
  const personnelQuery = useAccountingPersonnelQuery();

  // V3.2.1 (TD-080 / Playbook Scenario 6): گزارش‌ها به هوک اختصاصی useAccountingReports منتقل شدند
  const reports = useAccountingReports();

  const accountMutations = useAccountMutations();
  const voucherMutations = useVoucherMutations();
  const treasuryMutations = useTreasuryMutations();
  const chequeMutations = useChequeMutations();

  // Modals & Active Edit Entities
  const [isNewVoucherModalOpen, setIsNewVoucherModalOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<JournalVoucher | null>(null);
  const [printingVoucher, setPrintingVoucher] = useState<JournalVoucher | null>(null);

  const { refetch: refetchSummary } = summaryQuery;
  const { refetch: refetchAccounts } = accountsQuery;
  const { refetch: refetchTree } = treeQuery;
  const { refetch: refetchVouchers } = vouchersQuery;
  const { refetch: refetchBankAccounts } = bankAccountsQuery;
  const { refetch: refetchCheques } = chequesQuery;
  const { refetch: refetchCustomers } = customersQuery;
  const { refetch: refetchPersonnel } = personnelQuery;

  // Refresh All Data (دکمه «به‌روزرسانی» و بازنشانی خطای تب)
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchSummary(),
        refetchAccounts(),
        refetchTree(),
        refetchVouchers(),
        refetchBankAccounts(),
        // v9.0.102 (TD-509): جدول خزانه صفحه خودش را می‌خواند؛ «به‌روزرسانی» همان صفحه را دوباره می‌گیرد
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.accounting.treasuryTransactions(), type: 'active' }),
        refetchCheques(),
        refetchCustomers(),
        refetchPersonnel(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchSummary, refetchAccounts, refetchTree, refetchVouchers, refetchBankAccounts, queryClient, refetchCheques, refetchCustomers, refetchPersonnel]);

  const initialLoading = [
    summaryQuery, accountsQuery, treeQuery, vouchersQuery, bankAccountsQuery, chequesQuery, customersQuery, personnelQuery,
  ].some(q => q.isLoading);

  // Account Operations
  const handleCreateAccount = async (data: AccountPayload) => {
    await accountMutations.createAccount.mutateAsync(data);
  };

  const handleUpdateAccount = async (id: number, data: AccountPayload) => {
    await accountMutations.updateAccount.mutateAsync({ id, data });
  };

  const handleDeleteAccount = async (id: number) => {
    await accountMutations.deleteAccount.mutateAsync(id);
  };

  const handleSeedStandardAccounts = async () => {
    if (accountMutations.seedStandardAccounts.isPending) return;
    try {
      const res = await accountMutations.seedStandardAccounts.mutateAsync();
      toast.success(res?.message || 'کدینگ استاندارد با موفقیت همگام‌سازی شد');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در بارگذاری کدینگ استاندارد');
    }
  };

  // Voucher Operations
  const handleSaveVoucher = async (data: VoucherPayload) => {
    // v9.0.295 (TD-555): ویرایش نسخه‌ای را می‌فرستد که فرم از آن باز شد؛ تغییر هم‌زمان دیگری ۴۰۹ OCC_CONFLICT می‌گیرد
    const payload = editingVoucher ? { ...data, version: editingVoucher.version } : data;
    await voucherMutations.saveVoucher.mutateAsync({ editingId: editingVoucher ? editingVoucher.id : null, data: payload });
  };

  const handleDeleteVoucher = async (id: number) => {
    await voucherMutations.deleteVoucher.mutateAsync(id);
  };

  const handleReverseVoucher = async (voucherId: number, reason?: string, date?: string) => {
    await voucherMutations.reverseVoucher.mutateAsync({ voucherId, reason, date });
  };

  const handleCorrectVoucher = async (voucherId: number, data: VoucherCorrectionPayload) => {
    await voucherMutations.correctVoucher.mutateAsync({ voucherId, data });
  };

  const handleFinalizeVoucher = async (voucherId: number) => {
    await voucherMutations.finalizeVoucher.mutateAsync(voucherId);
  };

  const handleBatchFinalizeVouchers = (ids: number[]) => voucherMutations.batchFinalizeVouchers.mutateAsync(ids);

  const handleBatchApproveVouchers = (ids: number[]) => voucherMutations.batchApproveVouchers.mutateAsync(ids);

  const handleSetVoucherStatus = (voucherId: number, status: VoucherStatus, reason?: string) =>
    voucherMutations.setVoucherStatus.mutateAsync({ voucherId, status, reason });

  // Bank & Treasury Operations
  const handleCreateBankAccount = async (data: TreasuryPayload) => {
    await treasuryMutations.createBankAccount.mutateAsync(data);
  };

  const handleUpdateBankAccount = async (id: number, data: TreasuryPayload) => {
    await treasuryMutations.updateBankAccount.mutateAsync({ id, data });
  };

  const handleDeleteBankAccount = async (id: number) => {
    await treasuryMutations.deleteBankAccount.mutateAsync(id);
  };

  const handleCreateTreasuryTransaction = async (data: TreasuryPayload) => {
    await treasuryMutations.createTransaction.mutateAsync(data);
  };

  // V1.4.0: ابطال تراکنش خزانه با سند معکوس
  const handleVoidTreasuryTransaction = async (id: number, reason: string) => {
    await treasuryMutations.voidTransaction.mutateAsync({ id, reason });
  };

  // V1.5.0: انتقال بین‌بانکی
  const handleCreateTreasuryTransfer = async (data: TreasuryPayload) => {
    await treasuryMutations.createTransfer.mutateAsync(data);
  };

  // V1.6.0: ثبت گروهی آشتی‌سنجی بانکی
  const handleReconcileTransactions = async (bankAccountId: number, txIds: number[], batch: string, reconciled: boolean) => {
    await treasuryMutations.reconcileTransactions.mutateAsync({ bankAccountId, txIds, batch, reconciled });
  };

  // Cheques Operations
  const handleCreateCheque = async (data: ChequePayload) => {
    await chequeMutations.createCheque.mutateAsync(data);
  };

  const handleUpdateChequeStatus = async (
    id: number,
    status: string,
    description?: string,
    bankAccountId?: number,
    transfereePartyId?: number,
    actionDate?: string
  ) => {
    await chequeMutations.updateChequeStatus.mutateAsync({ id, status, description, bankAccountId, transfereePartyId, actionDate });
  };

  const handleDeleteCheque = async (id: number) => {
    await chequeMutations.deleteCheque.mutateAsync(id);
  };

  // Dynamic Bank & Ledger Synchronization and Reconciliation (پیام نتیجه و خطا در خود mutation)
  const syncAndReconcileBanks = async () => {
    if (treasuryMutations.syncAndReconcileBanks.isPending) return;
    await treasuryMutations.syncAndReconcileBanks.mutateAsync().catch(() => undefined);
  };

  return {
    activeTab,
    setActiveTab,
    loading: refreshing || initialLoading || accountMutations.seedStandardAccounts.isPending || reports.reportsLoading,
    isSyncingBanks: treasuryMutations.syncAndReconcileBanks.isPending,
    stats: summaryQuery.data ?? null,
    accounts: accountsQuery.data ?? NO_ACCOUNTS,
    treeAccounts: treeQuery.data ?? NO_ACCOUNTS,
    vouchers: vouchersQuery.data ?? NO_VOUCHERS,
    bankAccounts: bankAccountsQuery.data ?? NO_BANK_ACCOUNTS,
    bankAccountOptions: bankAccountOptionsQuery.data ?? NO_BANK_ACCOUNT_OPTIONS,
    cheques: chequesQuery.data ?? NO_CHEQUES,
    customers: customersQuery.data ?? NO_CUSTOMERS,
    personnelList: personnelQuery.data ?? NO_PERSONNEL,
    trialBalance: reports.trialBalance,
    incomeStatement: reports.incomeStatement,
    balanceSheet: reports.balanceSheet,
    ledgerReport: reports.ledgerReport,
    isNewVoucherModalOpen,
    setIsNewVoucherModalOpen,
    editingVoucher,
    setEditingVoucher,
    printingVoucher,
    setPrintingVoucher,
    refreshAll,
    fetchTrialBalance: reports.fetchTrialBalance,
    fetchIncomeStatement: reports.fetchIncomeStatement,
    fetchBalanceSheet: reports.fetchBalanceSheet,
    fetchLedger: reports.fetchLedger,
    handleCreateAccount,
    handleUpdateAccount,
    handleDeleteAccount,
    handleSeedStandardAccounts,
    handleSaveVoucher,
    handleDeleteVoucher,
    handleReverseVoucher,
    handleCorrectVoucher,
    handleFinalizeVoucher,
    handleBatchFinalizeVouchers,
    handleBatchApproveVouchers,
    handleSetVoucherStatus,
    handleCreateBankAccount,
    handleUpdateBankAccount,
    handleDeleteBankAccount,
    handleCreateTreasuryTransaction,
    handleVoidTreasuryTransaction,
    handleCreateTreasuryTransfer,
    handleReconcileTransactions,
    handleCreateCheque,
    handleUpdateChequeStatus,
    handleDeleteCheque,
    syncAndReconcileBanks,
  };
}
