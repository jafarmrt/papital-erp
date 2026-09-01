import { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '../api';
import type { 
  Account, 
  JournalVoucher, 
  BankAccount, 
  BankReconciliationReport,
  Cheque, 
  TreasuryTransaction, 
  FinancialSummaryStats,
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
  AccountLedgerReport,
  Customer,
  Personnel
} from '../types';
import toast from 'react-hot-toast';

export function useAccounting() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'coa' | 'vouchers' | 'treasury' | 'cheques' | 'reports' | 'fiscal-closing'>('dashboard');
  const [loading, setLoading] = useState(false);
  const [isSyncingBanks, setIsSyncingBanks] = useState(false);

  // Core Data
  const [stats, setStats] = useState<FinancialSummaryStats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [treeAccounts, setTreeAccounts] = useState<Account[]>([]);
  const [vouchers, setVouchers] = useState<JournalVoucher[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [reconciliationReport, setReconciliationReport] = useState<BankReconciliationReport | null>(null);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [treasuryTransactions, setTreasuryTransactions] = useState<TreasuryTransaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [personnelList, setPersonnelList] = useState<Personnel[]>([]);

  // Reports Data
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [ledgerReport, setLedgerReport] = useState<AccountLedgerReport | null>(null);

  // Modals & Active Edit Entities
  const [isNewVoucherModalOpen, setIsNewVoucherModalOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<JournalVoucher | null>(null);
  const [printingVoucher, setPrintingVoucher] = useState<JournalVoucher | null>(null);

  // Fetch Summary Stats
  const loadStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson('/accounting/summary', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return null;
      });
      if (res && res.stats) {
        setStats(res.stats);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading accounting stats:', err);
    }
  }, []);

  // Fetch Chart of Accounts
  const loadAccounts = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchJson('/accounting/accounts', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setAccounts(items);

      const treeRes = await fetchJson('/accounting/accounts/tree', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const tree = Array.isArray(treeRes?.data) ? treeRes.data : (Array.isArray(treeRes) ? treeRes : []);
      setTreeAccounts(tree);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading accounts:', err);
    }
  }, []);

  // Fetch Journal Vouchers
  const loadVouchers = useCallback(async (filters?: any, signal?: AbortSignal) => {
    try {
      let query = '';
      if (filters) {
        const params = new URLSearchParams();
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.type) params.append('type', filters.type);
        if (filters.search) params.append('search', filters.search);
        query = `?${params.toString()}`;
      }
      const res = await fetchJson(`/accounting/vouchers${query}`, { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setVouchers(items);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading vouchers:', err);
    }
  }, []);

  // Fetch Bank Accounts & Treasury
  const loadBankAndTreasury = useCallback(async (signal?: AbortSignal) => {
    try {
      const banksRes = await fetchJson('/accounting/bank-accounts', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const banks = Array.isArray(banksRes?.data) ? banksRes.data : (Array.isArray(banksRes) ? banksRes : []);
      setBankAccounts(banks);

      const txRes = await fetchJson('/accounting/treasury', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const txs = Array.isArray(txRes?.data) ? txRes.data : (Array.isArray(txRes) ? txRes : []);
      setTreasuryTransactions(txs);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading bank accounts and treasury:', err);
    }
  }, []);

  // Fetch Cheques
  const loadCheques = useCallback(async (filters?: any, signal?: AbortSignal) => {
    try {
      let query = '';
      if (filters) {
        const params = new URLSearchParams();
        if (filters.type) params.append('type', filters.type);
        if (filters.status) params.append('status', filters.status);
        query = `?${params.toString()}`;
      }
      const res = await fetchJson(`/accounting/cheques${query}`, { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setCheques(items);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading cheques:', err);
    }
  }, []);

  // Load auxiliary lists (Customers, Personnel)
  const loadAuxData = useCallback(async (signal?: AbortSignal) => {
    try {
      const custRes = await fetchJson('/customers', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const custs = Array.isArray(custRes?.data) ? custRes.data : (Array.isArray(custRes) ? custRes : []);
      setCustomers(custs);

      const persRes = await fetchJson('/personnel', { signal }).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return [];
      });
      const pers = Array.isArray(persRes?.data) ? persRes.data : (Array.isArray(persRes) ? persRes : []);
      setPersonnelList(pers);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error loading auxiliary data:', err);
    }
  }, []);

  // Fetch Reports
  const fetchTrialBalance = useCallback(async (level = 'subsidiary', startDate?: string, endDate?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('level', level);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const res = await fetchJson(`/accounting/reports/trial-balance?${params.toString()}`);
      if (res?.report) {
        setTrialBalance(res.report);
      } else if (res) {
        setTrialBalance(res);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در دریافت تراز آزمایشی');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIncomeStatement = useCallback(async (startDate?: string, endDate?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const res = await fetchJson(`/accounting/reports/income-statement?${params.toString()}`);
      if (res?.report) {
        setIncomeStatement(res.report);
      } else if (res) {
        setIncomeStatement(res);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در دریافت صورت سود و زیان');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBalanceSheet = useCallback(async (asOfDate?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOfDate) params.append('asOfDate', asOfDate);
      const res = await fetchJson(`/accounting/reports/balance-sheet?${params.toString()}`);
      if (res?.report) {
        setBalanceSheet(res.report);
      } else if (res) {
        setBalanceSheet(res);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در دریافت ترازنامه');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLedger = useCallback(async (accountId: number, startDate?: string, endDate?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('accountId', String(accountId));
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const res = await fetchJson(`/accounting/reports/ledger?${params.toString()}`);
      if (res?.report) {
        setLedgerReport(res.report);
      } else if (res) {
        setLedgerReport(res);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در دریافت گردش حساب');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh All Data
  const refreshAll = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      await Promise.all([
        loadStats(signal),
        loadAccounts(signal),
        loadVouchers(undefined, signal),
        loadBankAndTreasury(signal),
        loadCheques(undefined, signal),
        loadAuxData(signal),
      ]);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error refreshing accounting data:', err);
    } finally {
      setLoading(false);
    }
  }, [loadStats, loadAccounts, loadVouchers, loadBankAndTreasury, loadCheques, loadAuxData]);

  useEffect(() => {
    const controller = new AbortController();
    refreshAll(controller.signal);
    return () => controller.abort();
  }, [refreshAll]);

  // Account Operations
  const handleCreateAccount = async (data: any) => {
    await fetchJson('/accounting/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await loadAccounts();
    await loadStats();
  };

  const handleUpdateAccount = async (id: number, data: any) => {
    await fetchJson(`/accounting/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await loadAccounts();
    await loadStats();
  };

  const handleDeleteAccount = async (id: number) => {
    await fetchJson(`/accounting/accounts/${id}`, {
      method: 'DELETE',
    });
    await loadAccounts();
    await loadStats();
  };

  const handleSeedStandardAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetchJson('/accounting/accounts/seed-standard', {
        method: 'POST',
      });
      toast.success(res.message || 'کدینگ استاندارد با موفقیت همگام‌سازی شد');
      await loadAccounts();
      await loadStats();
    } catch (err) {
      toast.error(err.message || 'خطا در بارگذاری کدینگ استاندارد');
    } finally {
      setLoading(false);
    }
  };

  // Voucher Operations
  const handleSaveVoucher = async (data: any) => {
    if (editingVoucher) {
      await fetchJson(`/accounting/vouchers/${editingVoucher.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    } else {
      await fetchJson('/accounting/vouchers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    }
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  const handleDeleteVoucher = async (id: number) => {
    await fetchJson(`/accounting/vouchers/${id}`, {
      method: 'DELETE',
    });
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  const handleReverseVoucher = async (voucherId: number, reason?: string, date?: string) => {
    const res = await fetchJson(`/accounting/vouchers/${voucherId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason, date }),
    });
    toast.success(res?.message || 'سند معکوس با موفقیت صادر شد');
    await loadVouchers();
    await loadStats();
    await loadAccounts();
    return res;
  };

  const handleCorrectVoucher = async (voucherId: number, data: { reason: string; newItems: any[]; newDescription?: string; date?: string }) => {
    const res = await fetchJson(`/accounting/vouchers/${voucherId}/correct`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    toast.success(res?.message || 'سند عکس و سند اصلاحی با موفقیت صادر شدند');
    await loadVouchers();
    await loadStats();
    await loadAccounts();
    return res;
  };

  const handleFinalizeVoucher = async (voucherId: number) => {
    const res = await fetchJson(`/accounting/vouchers/${voucherId}/finalize`, {
      method: 'POST',
    });
    toast.success(res?.message || 'سند با موفقیت قطعی و دائم شد');
    await loadVouchers();
    await loadStats();
    return res;
  };

  const handleBatchFinalizeVouchers = async (ids: number[]) => {
    const res = await fetchJson('/accounting/vouchers/batch-finalize', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    toast.success(res?.message || 'اسناد با موفقیت قطعی و دائم شدند');
    await loadVouchers();
    await loadStats();
    return res;
  };

  const handleSetVoucherStatus = async (voucherId: number, status: 'draft' | 'approved' | 'permanent') => {
    const res = await fetchJson(`/accounting/vouchers/${voucherId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    toast.success('وضعیت سند با موفقیت به‌روزرسانی شد');
    await loadVouchers();
    return res;
  };


  // Bank & Treasury Operations
  const handleCreateBankAccount = async (data: any) => {
    await fetchJson('/accounting/bank-accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await loadBankAndTreasury();
    await loadStats();
  };

  const handleUpdateBankAccount = async (id: number, data: any) => {
    await fetchJson(`/accounting/bank-accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await loadBankAndTreasury();
    await loadStats();
  };

  const handleDeleteBankAccount = async (id: number) => {
    await fetchJson(`/accounting/bank-accounts/${id}`, {
      method: 'DELETE',
    });
    await loadBankAndTreasury();
    await loadStats();
  };

  const handleCreateTreasuryTransaction = async (data: any) => {
    await fetchJson('/accounting/treasury', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await loadBankAndTreasury();
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  // V1.4.0: ابطال تراکنش خزانه با سند معکوس
  const handleVoidTreasuryTransaction = async (id: number, reason: string) => {
    await fetchJson(`/accounting/treasury/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await loadBankAndTreasury();
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  // V1.5.0: انتقال بین‌بانکی
  const handleCreateTreasuryTransfer = async (data: any) => {
    await fetchJson('/accounting/treasury/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await loadBankAndTreasury();
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  // Cheques Operations
  const handleCreateCheque = async (data: any) => {
    await fetchJson('/accounting/cheques', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await loadCheques();
    await loadVouchers();
    await loadStats();
    await loadAccounts();
  };

  const handleUpdateChequeStatus = async (
    id: number, 
    status: string, 
    description?: string, 
    bankAccountId?: number
  ) => {
    await fetchJson(`/accounting/cheques/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, description, bankAccountId }),
    });
    await loadCheques();
    await loadVouchers();
    await loadBankAndTreasury();
    await loadStats();
    await loadAccounts();
  };

  const handleDeleteCheque = async (id: number) => {
    await fetchJson(`/accounting/cheques/${id}`, {
      method: 'DELETE',
    });
    await loadCheques();
    await loadStats();
  };

  // Dynamic Bank & Ledger Synchronization and Reconciliation
  const loadBankReconciliationReport = useCallback(async () => {
    try {
      const res = await fetchJson('/accounting/bank-accounts/reconciliation-report');
      if (res?.report) {
        setReconciliationReport(res.report);
      }
    } catch (err) {
      console.error('Error loading bank reconciliation report:', err);
    }
  }, []);

  const syncAndReconcileBanks = async () => {
    setIsSyncingBanks(true);
    try {
      const res = await fetchJson('/accounting/bank-accounts/sync-reconcile', {
        method: 'POST',
      });
      if (res?.report) {
        setReconciliationReport(res.report);
        const { syncedCount, discrepantCount } = res.report;
        if (discrepantCount === 0) {
          toast.success(`تمام ${syncedCount} حساب بانکی و صندوق با دفاتر اسناد دوبل همگام و تراز شدند.`);
        } else {
          toast(`همگام‌سازی انجام شد: ${syncedCount} حساب تراز، ${discrepantCount} حساب دارای مغایرت شناسایی شد.`, {
            icon: '⚠️',
            duration: 5000,
          });
        }
      }
      await loadBankAndTreasury();
      await loadAccounts();
      await loadStats();
    } catch (err) {
      console.error('Error syncing banks:', err);
      toast.error(err?.message || 'خطا در همگام‌سازی مانده حساب‌های بانکی');
    } finally {
      setIsSyncingBanks(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    loading,
    isSyncingBanks,
    stats,
    accounts,
    treeAccounts,
    vouchers,
    bankAccounts,
    reconciliationReport,
    cheques,
    treasuryTransactions,
    customers,
    personnelList,
    trialBalance,
    incomeStatement,
    balanceSheet,
    ledgerReport,
    isNewVoucherModalOpen,
    setIsNewVoucherModalOpen,
    editingVoucher,
    setEditingVoucher,
    printingVoucher,
    setPrintingVoucher,
    refreshAll,
    fetchTrialBalance,
    fetchIncomeStatement,
    fetchBalanceSheet,
    fetchLedger,
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
    handleSetVoucherStatus,
    handleCreateBankAccount,
    handleUpdateBankAccount,
    handleDeleteBankAccount,
    handleCreateTreasuryTransaction,
    handleVoidTreasuryTransaction,
    handleCreateTreasuryTransfer,
    handleCreateCheque,
    handleUpdateChequeStatus,
    handleDeleteCheque,
    syncAndReconcileBanks,
    loadBankReconciliationReport,
  };
}
