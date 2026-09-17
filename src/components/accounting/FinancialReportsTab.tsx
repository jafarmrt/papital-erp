import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  BarChart3, 
  FileSpreadsheet, 
  TrendingUp, 
  Scale, 
  Printer, 
  FileText, 
  Activity, 
  ShieldCheck, 
  BookOpen,
  Users
} from 'lucide-react';
import type { 
  TrialBalanceReport, 
  IncomeStatementReport, 
  BalanceSheetReport, 
  AccountLedgerReport, 
  Account,
  TrialBalanceRow
} from '../../types';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';

import { TrialBalanceView } from './reports/TrialBalanceView';
import { JournalBookView } from './reports/JournalBookView';
import { IncomeStatementView } from './reports/IncomeStatementView';
import { BalanceSheetView } from './reports/BalanceSheetView';
import { LedgerView } from './reports/LedgerView';
import { PartyLedgerReportView } from './reports/PartyLedgerReportView';
import { FinancialRatiosView } from './reports/FinancialRatiosView';
import { AccountingAuditChecklistView } from './reports/AccountingAuditChecklistView';
import { AutomationStatusView } from './reports/AutomationStatusView';
import { ProjectReportView } from './reports/ProjectReportView';

interface FinancialReportsTabProps {
  accounts: Account[];
  trialBalance: TrialBalanceReport | null;
  incomeStatement: IncomeStatementReport | null;
  balanceSheet: BalanceSheetReport | null;
  ledgerReport: AccountLedgerReport | null;
  loading: boolean;
  onFetchTrialBalance: (level?: string, startDate?: string, endDate?: string) => Promise<void>;
  onFetchIncomeStatement: (startDate?: string, endDate?: string) => Promise<void>;
  onFetchBalanceSheet: (asOfDate?: string) => Promise<void>;
  onFetchLedger: (accountId: number, startDate?: string, endDate?: string) => Promise<void>;
}

export function FinancialReportsTab({
  accounts,
  trialBalance,
  incomeStatement,
  balanceSheet,
  ledgerReport,
  loading,
  onFetchTrialBalance,
  onFetchIncomeStatement,
  onFetchBalanceSheet,
  onFetchLedger,
}: FinancialReportsTabProps) {
  const [searchParams] = useSearchParams();
  const validSubTabs = ['trial_balance', 'party_ledger', 'journal_book', 'income_statement', 'balance_sheet', 'ledger', 'ratios', 'audit', 'automation', 'project'] as const;

  // Navigation
  const [activeSubTab, setActiveSubTab] = useState<
    'trial_balance' | 'party_ledger' | 'journal_book' | 'income_statement' | 'balance_sheet' | 'ledger' | 'ratios' | 'audit' | 'automation' | 'project'
  >(() => {
    const sub = searchParams.get('subTab');
    if (sub && (validSubTabs as readonly string[]).includes(sub)) {
      return sub as any;
    }
    return 'trial_balance';
  });

  useEffect(() => {
    const sub = searchParams.get('subTab');
    if (sub && (validSubTabs as readonly string[]).includes(sub) && sub !== activeSubTab) {
      setActiveSubTab(sub as any);
    }
  }, [searchParams]);

  // Filter States
  const [trialLevel, setTrialLevel] = useState<'all' | 'group' | 'general' | 'subsidiary' | 'detailed'>('all');
  const [trialCols, setTrialCols] = useState<'2' | '4' | '6' | '8'>('4');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [asOfDate] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState<number | ''>('');

  // Expand / Collapse state for tree view
  const [, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Journal Book State
  const [journalBookData, setJournalBookData] = useState<any>(null);
  const [journalLoading, setJournalLoading] = useState(false);

  // Financial Ratios State
  const [ratiosData, setRatiosData] = useState<any>(null);
  const [, setRatiosLoading] = useState(false);

  // Initial fetch of trial balance and ratios
  useEffect(() => {
    onFetchTrialBalance(trialLevel, startDate || undefined, endDate || undefined);
  }, []);

  const handleApplyTrialFilter = (newLevel?: 'all' | 'group' | 'general' | 'subsidiary' | 'detailed') => {
    const levelToFetch = newLevel || trialLevel;
    if (newLevel) setTrialLevel(newLevel);
    onFetchTrialBalance(levelToFetch, startDate || undefined, endDate || undefined);
  };

  const handleApplyIncomeFilter = () => {
    onFetchIncomeStatement(startDate || undefined, endDate || undefined);
  };

  const handleApplyBalanceSheetFilter = () => {
    onFetchBalanceSheet(asOfDate || undefined);
  };

  const handleApplyLedgerFilter = () => {
    if (!selectedLedgerAccountId) {
      toast.error('لطفاً یک حساب برای مشاهده گردش انتخاب نمایید');
      return;
    }
    onFetchLedger(Number(selectedLedgerAccountId), startDate || undefined, endDate || undefined);
  };

  const fetchJournalBook = async () => {
    setJournalLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const res = await fetchJson(`/accounting/reports/journal-book?${params.toString()}`);
      setJournalBookData(res?.report || res);
    } catch (err) {
      toast.error(err.message || 'خطا در بارگذاری دفتر روزنامه');
    } finally {
      setJournalLoading(false);
    }
  };

  const fetchFinancialRatios = async (currency?: string) => {
    setRatiosLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOfDate) params.append('asOfDate', asOfDate);
      if (currency && currency !== 'all') params.append('currency', currency);
      const res = await fetchJson(`/accounting/reports/financial-ratios?${params.toString()}`);
      setRatiosData(res?.report || res);
    } catch (err) {
      toast.error(err.message || 'خطا در محاسبه نسبت‌های مالی');
    } finally {
      setRatiosLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const expandAll = () => {
    const allExp: Record<string, boolean> = {};
    safeTrialRows.forEach(r => {
      allExp[r.code] = true;
    });
    setExpandedNodes(allExp);
  };

  const collapseAll = () => {
    setExpandedNodes({});
  };

  const safeTrialRows: TrialBalanceRow[] = Array.isArray(trialBalance?.rows) 
    ? trialBalance.rows 
    : (Array.isArray(trialBalance) ? trialBalance : []);

  // Filtered rows for live search
  const filteredTrialRows = useMemo(() => {
    if (!tableSearch.trim()) return safeTrialRows;
    const q = tableSearch.trim().toLowerCase();
    return safeTrialRows.filter(r => 
      r.code.toLowerCase().includes(q) || 
      r.name.toLowerCase().includes(q)
    );
  }, [safeTrialRows, tableSearch]);

  // Calculate totals for Trial Balance
  const trialTotals = useMemo(() => {
    let initialDebit = 0;
    let initialCredit = 0;
    let debitTurnover = 0;
    let creditTurnover = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    let debitBalance = 0;
    let creditBalance = 0;

    const rowsToSum = trialLevel === 'all' 
      ? safeTrialRows.filter(r => r.level === 'group') 
      : safeTrialRows;

    for (const r of rowsToSum) {
      initialDebit += Number(r.initialDebit || 0);
      initialCredit += Number(r.initialCredit || 0);
      debitTurnover += Number(r.debitTurnover || 0);
      creditTurnover += Number(r.creditTurnover || 0);
      totalDebit += Number(r.totalDebit || 0);
      totalCredit += Number(r.totalCredit || 0);
      debitBalance += Number(r.debitBalance || 0);
      creditBalance += Number(r.creditBalance || 0);
    }

    const isBalanced = Math.abs(debitBalance - creditBalance) < 0.01;
    const diff = Math.abs(debitBalance - creditBalance);

    return {
      initialDebit,
      initialCredit,
      debitTurnover,
      creditTurnover,
      totalDebit,
      totalCredit,
      debitBalance,
      creditBalance,
      isBalanced,
      diff,
    };
  }, [safeTrialRows, trialLevel]);

  // Navigate to Ledger for specific account
  const handleDrillDownToLedger = (accountId: number) => {
    setSelectedLedgerAccountId(accountId);
    setActiveSubTab('ledger');
    onFetchLedger(accountId, startDate || undefined, endDate || undefined);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tab Navigation */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm no-print">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl text-indigo-600 dark:text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">مرکز گزارشات و صورت‌های مالی استاندارد</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تراز آزمایشی در ۴ سطح کدینگ (گروه، کل، معین، تفصیلی)، دفاتر روزنامه و کل، صورت سود و زیان، ترازنامه و شاخص‌های مالی
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition"
          >
            <Printer className="w-4 h-4" />
            <span>چاپ گزارش فعال</span>
          </button>
        </div>
      </div>

      {/* Report Sub-Tabs Nav */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2 no-print overflow-x-auto">
        <button
          onClick={() => { setActiveSubTab('trial_balance'); handleApplyTrialFilter(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'trial_balance'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>تراز آزمایشی (۴ سطحی)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('party_ledger')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'party_ledger'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>صورت‌حساب طرف‌حساب (گردش اشخاص)</span>
        </button>

        <button
          onClick={() => { setActiveSubTab('journal_book'); fetchJournalBook(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'journal_book'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>دفتر روزنامه رسمی</span>
        </button>

        <button
          onClick={() => { setActiveSubTab('income_statement'); handleApplyIncomeFilter(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'income_statement'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>صورت سود و زیان</span>
        </button>

        <button
          onClick={() => { setActiveSubTab('balance_sheet'); handleApplyBalanceSheetFilter(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'balance_sheet'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>ترازنامه اساسی</span>
        </button>

        <button
          onClick={() => setActiveSubTab('ledger')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'ledger'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>دفاتر کل و معین</span>
        </button>

        <button
          onClick={() => { setActiveSubTab('ratios'); fetchFinancialRatios(); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'ratios'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>نسبت‌ها و سلامت مالی</span>
        </button>

        {/* V10-6.1: وضعیت اتوماسیون اسناد */}
        <button
          onClick={() => setActiveSubTab('automation')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'automation'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>وضعیت اتوماسیون اسناد</span>
        </button>

        {/* V10-6.1: گزارش حسابداری پروژه‌ها */}
        <button
          onClick={() => setActiveSubTab('project')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'project'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>گزارش پروژه‌ها</span>
        </button>

        <button
          onClick={() => setActiveSubTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition whitespace-nowrap ${
            activeSubTab === 'audit'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>بازرس سلامت مالی و ممیزی دفاتر</span>
        </button>
      </div>

      {/* 1. TRIAL BALANCE TAB */}
      {activeSubTab === 'trial_balance' && (
        <TrialBalanceView
          trialLevel={trialLevel}
          trialCols={trialCols}
          startDate={startDate}
          endDate={endDate}
          tableSearch={tableSearch}
          loading={loading}
          filteredTrialRows={filteredTrialRows}
          trialTotals={trialTotals}
          onApplyTrialFilter={handleApplyTrialFilter}
          setTrialCols={setTrialCols}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          setTableSearch={setTableSearch}
          onFetchTrialBalance={onFetchTrialBalance}
          expandAll={expandAll}
          collapseAll={collapseAll}
          onDrillDownToLedger={handleDrillDownToLedger}
        />
      )}

      {/* 2. PARTY LEDGER TAB (V3 Phase 3) */}
      {activeSubTab === 'party_ledger' && (
        <PartyLedgerReportView 
          initialPartyType={searchParams.get('partyType') || undefined}
        />
      )}

      {/* 3. JOURNAL BOOK TAB */}
      {activeSubTab === 'journal_book' && (
        <JournalBookView
          journalLoading={journalLoading}
          journalBookData={journalBookData}
          onFetchJournalBook={fetchJournalBook}
        />
      )}

      {/* 3. INCOME STATEMENT TAB */}
      {activeSubTab === 'income_statement' && (
        <IncomeStatementView
          incomeStatement={incomeStatement}
          onApplyIncomeFilter={handleApplyIncomeFilter}
        />
      )}

      {/* 4. BALANCE SHEET TAB */}
      {activeSubTab === 'balance_sheet' && (
        <BalanceSheetView
          balanceSheet={balanceSheet}
          onApplyBalanceSheetFilter={handleApplyBalanceSheetFilter}
        />
      )}

      {/* 5. LEDGER TAB */}
      {activeSubTab === 'ledger' && (
        <LedgerView
          accounts={accounts}
          ledgerReport={ledgerReport}
          selectedLedgerAccountId={selectedLedgerAccountId}
          setSelectedLedgerAccountId={setSelectedLedgerAccountId}
          onApplyLedgerFilter={handleApplyLedgerFilter}
          onFetchLedger={onFetchLedger}
          startDate={startDate}
          endDate={endDate}
        />
      )}

      {/* 6. FINANCIAL RATIOS TAB */}
      {activeSubTab === 'ratios' && (
        <FinancialRatiosView
          ratiosData={ratiosData}
          onFetchFinancialRatios={fetchFinancialRatios}
        />
      )}

      {/* 7. ACCOUNTING MODULE AUDIT TAB */}
      {activeSubTab === 'audit' && (
        <AccountingAuditChecklistView />
      )}

      {/* 8. AUTOMATION STATUS (V10-6.1) */}
      {activeSubTab === 'automation' && (
        <AutomationStatusView />
      )}

      {/* 9. PROJECT REPORT (V10-6.1) */}
      {activeSubTab === 'project' && (
        <ProjectReportView />
      )}
    </div>
  );
}
