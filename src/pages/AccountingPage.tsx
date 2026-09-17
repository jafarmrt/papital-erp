import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccounting } from '../hooks/useAccounting';
import { AccountingDashboard } from '../components/accounting/AccountingDashboard';
import { ChartOfAccountsTab } from '../components/accounting/ChartOfAccountsTab';
import { JournalVouchersTab } from '../components/accounting/JournalVouchersTab';
import { BankAndTreasuryTab } from '../components/accounting/BankAndTreasuryTab';
import { ChequesTab } from '../components/accounting/ChequesTab';
import { FinancialReportsTab } from '../components/accounting/FinancialReportsTab';
import { FiscalYearClosingTab } from '../components/accounting/FiscalYearClosingTab';
import { AccountExplorerTab } from '../components/accounting/AccountExplorerTab';
import { NewVoucherModal } from '../components/accounting/NewVoucherModal';
import { VoucherPrintModal } from '../components/accounting/VoucherPrintModal';
import { SectionErrorBoundary } from '../components/common';
import { 
  Calculator, 
  RefreshCw, 
  Plus, 
  ShieldAlert
} from 'lucide-react';
import { User } from '../types';

interface AccountingPageProps {
  userPermissions?: { role?: string; roleName?: string; permissions: string[]; isAdmin: boolean };
  user?: User | null;
}

export function AccountingPage({ userPermissions, user }: AccountingPageProps) {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const isAdmin = userPermissions?.isAdmin || user?.role === 'admin';
  const hasPerm = (perm: string) => {
    if (isAdmin) return true;
    return Array.isArray(userPermissions?.permissions) && userPermissions.permissions.includes(perm) || false;
  };

  const {
    activeTab,
    setActiveTab,
    loading,
    isSyncingBanks,
    stats,
    accounts,
    treeAccounts,
    vouchers,
    bankAccounts,
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
    handleReconcileTransactions,
    loadCashFlowReport,
    loadChequeReconciliation,
    handleCreateCheque,
    handleUpdateChequeStatus,
    handleDeleteCheque,
    syncAndReconcileBanks,
  } = useAccounting();

  const validTabs = ['dashboard', 'coa', 'vouchers', 'explorer', 'treasury', 'cheques', 'reports', 'fiscal-closing'] as const;
  type TabType = typeof validTabs[number];

  const currentTab: TabType = (tab && (validTabs as readonly string[]).includes(tab)) ? (tab as TabType) : 'dashboard';

  const tabPermissionMap: Record<TabType, string> = {
    dashboard: 'accounting.view',
    coa: 'accounting.coa',
    vouchers: 'accounting.vouchers',
    explorer: 'accounting.reports',
    treasury: 'accounting.treasury',
    cheques: 'accounting.cheques',
    reports: 'accounting.reports',
    'fiscal-closing': 'accounting.vouchers',
  };

  const isTabAllowed = hasPerm(tabPermissionMap[currentTab]);

  useEffect(() => {
    if (tab === 'coa') {
      navigate('/settings?tab=chart_of_accounts', { replace: true });
    }
  }, [tab, navigate]);

  useEffect(() => {
    if (currentTab !== activeTab) {
      setActiveTab(currentTab);
    }
  }, [currentTab, activeTab, setActiveTab]);

  const handleTabChange = (newTab: string) => {
    if (newTab === 'coa') {
      navigate('/settings?tab=chart_of_accounts');
      return;
    }
    navigate(`/accounting/${newTab}`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              {currentTab === 'dashboard' && 'داشبورد جامع مالی'}
              {currentTab === 'coa' && 'کدینگ و درخت حساب‌ها'}
              {currentTab === 'vouchers' && 'اسناد دوبل حسابداری'}
              {currentTab === 'explorer' && 'مرور حساب‌ها (درخت و کاردکس)'}
              {currentTab === 'treasury' && 'خزانه‌داری و حساب‌های بانکی'}
              {currentTab === 'cheques' && 'مدیریت چک‌های صیادی'}
              {currentTab === 'reports' && 'صورت‌ها و گزارش‌های مالی'}
              {currentTab === 'fiscal-closing' && 'بستن سال مالی و اسناد اختتامیه/افتتاحیه'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {currentTab === 'fiscal-closing'
                ? 'فرایند بستن حساب‌های موقت، انتقال سود/زیان ویژه، صدور سند اختتامیه و افتتاحیه سال مالی جدید'
                : 'سیستم حسابداری دوبل استاندارد ایران، دفاتر مالی، خزانه‌داری، چک‌های صیادی و تراز آزمایشی'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshAll()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>به‌روزرسانی</span>
          </button>

          {hasPerm('accounting.vouchers') && (
            <button
              onClick={() => {
                setEditingVoucher(null);
                setIsNewVoucherModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-indigo-900/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>ثبت سند جدید</span>
            </button>
          )}
        </div>
      </div>

      {/* Permission Check Fallback */}
      {!isTabAllowed ? (
        <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-red-200 dark:border-red-900/40 text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">دسترسی محدود شده است</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            نقش کاربری شما مجوز لازم برای مشاهده این بخش از سیستم مالی ({tabPermissionMap[currentTab]}) را ندارد. برای کسب دسترسی با مدیر سیستم تماس بگیرید.
          </p>
        </div>
      ) : (
        <SectionErrorBoundary
          resetKeys={[currentTab]}
          onReset={refreshAll}
          title="خطا در بارگذاری محتوای این تب مالی"
          description="در پردازش یا نمایش اطلاعات این بخش خطایی رخ داده است. می‌توانید با استفاده از دکمه زیر مجدداً تلاش نمایید."
        >
          {/* Main Content Area */}
          {currentTab === 'dashboard' && (
            <AccountingDashboard
              stats={stats}
              recentVouchers={vouchers}
              upcomingCheques={cheques}
              onTabChange={handleTabChange}
              onOpenNewVoucher={() => {
                setEditingVoucher(null);
                setIsNewVoucherModalOpen(true);
              }}
              onOpenNewTreasury={() => handleTabChange('treasury')}
              onOpenNewCheque={() => handleTabChange('cheques')}
            />
          )}

          {currentTab === 'coa' && (
            <ChartOfAccountsTab
              accounts={accounts}
              treeAccounts={treeAccounts}
              loading={loading}
              onRefresh={refreshAll}
              onCreateAccount={handleCreateAccount}
              onUpdateAccount={handleUpdateAccount}
              onDeleteAccount={handleDeleteAccount}
              onSeedStandardAccounts={handleSeedStandardAccounts}
            />
          )}

          {currentTab === 'vouchers' && (
            <JournalVouchersTab
              vouchers={vouchers}
              loading={loading}
              accounts={accounts}
              customers={customers}
              personnelList={personnelList}
              onRefresh={refreshAll}
              onOpenNewVoucher={() => {
                setEditingVoucher(null);
                setIsNewVoucherModalOpen(true);
              }}
              onEditVoucher={v => {
                setEditingVoucher(v);
                setIsNewVoucherModalOpen(true);
              }}
              onDeleteVoucher={handleDeleteVoucher}
              onPrintVoucher={v => setPrintingVoucher(v)}
              onReverseVoucher={handleReverseVoucher}
              onCorrectVoucher={handleCorrectVoucher}
              onFinalizeVoucher={handleFinalizeVoucher}
              onApproveVoucher={(id) => handleSetVoucherStatus(id, 'approved')}
              onSetVoucherStatus={handleSetVoucherStatus}
              onBatchFinalizeVouchers={handleBatchFinalizeVouchers}
            />
          )}

          {currentTab === 'explorer' && (
            <AccountExplorerTab
              accounts={accounts}
              customers={customers}
              personnelList={personnelList}
              bankAccounts={bankAccounts}
              loading={loading}
              onRefresh={refreshAll}
              onViewVoucher={v => {
                setEditingVoucher(v);
                setIsNewVoucherModalOpen(true);
              }}
            />
          )}

          {currentTab === 'treasury' && (
            <BankAndTreasuryTab
              bankAccounts={bankAccounts}
              transactions={treasuryTransactions}
              customers={customers}
              personnelList={personnelList}
              accounts={accounts}
              loading={loading}
              isSyncingBanks={isSyncingBanks}
              onRefresh={refreshAll}
              onSyncAndReconcileBanks={syncAndReconcileBanks}
              onCreateBankAccount={handleCreateBankAccount}
              onUpdateBankAccount={handleUpdateBankAccount}
              onDeleteBankAccount={handleDeleteBankAccount}
              onCreateTreasuryTransaction={handleCreateTreasuryTransaction}
              onVoidTreasuryTransaction={handleVoidTreasuryTransaction}
              onCreateTreasuryTransfer={handleCreateTreasuryTransfer}
              onReconcileTransactions={handleReconcileTransactions}
              onLoadCashFlowReport={loadCashFlowReport}
            />
          )}

          {currentTab === 'cheques' && (
            <ChequesTab
              cheques={cheques}
              bankAccounts={bankAccounts}
              customers={customers}
              personnelList={personnelList}
              loading={loading}
              onRefresh={refreshAll}
              onCreateCheque={handleCreateCheque}
              onUpdateStatus={handleUpdateChequeStatus}
              onDeleteCheque={handleDeleteCheque}
              onLoadChequeReconciliation={loadChequeReconciliation}
            />
          )}

          {currentTab === 'reports' && (
            <FinancialReportsTab
              accounts={accounts}
              trialBalance={trialBalance}
              incomeStatement={incomeStatement}
              balanceSheet={balanceSheet}
              ledgerReport={ledgerReport}
              loading={loading}
              onFetchTrialBalance={fetchTrialBalance}
              onFetchIncomeStatement={fetchIncomeStatement}
              onFetchBalanceSheet={fetchBalanceSheet}
              onFetchLedger={fetchLedger}
            />
          )}

          {currentTab === 'fiscal-closing' && (
            <FiscalYearClosingTab
              onViewVoucher={v => {
                setEditingVoucher(v);
                setIsNewVoucherModalOpen(true);
              }}
              onPrintVoucher={v => setPrintingVoucher(v)}
            />
          )}
        </SectionErrorBoundary>
      )}

      {/* New / Edit Voucher Modal */}
      <NewVoucherModal
        isOpen={isNewVoucherModalOpen}
        onClose={() => {
          setIsNewVoucherModalOpen(false);
          setEditingVoucher(null);
        }}
        accounts={accounts}
        customers={customers}
        personnelList={personnelList}
        onSave={handleSaveVoucher}
        editingVoucher={editingVoucher}
      />

      {/* Print Voucher Modal */}
      <VoucherPrintModal
        isOpen={!!printingVoucher}
        voucher={printingVoucher}
        onClose={() => setPrintingVoucher(null)}
      />
    </div>
  );
}

export default AccountingPage;
