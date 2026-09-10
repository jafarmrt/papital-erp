import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import type {
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
  AccountLedgerReport
} from '../types';

export function useAccountingReports() {
  const [reportsLoading, setReportsLoading] = useState(false);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [ledgerReport, setLedgerReport] = useState<AccountLedgerReport | null>(null);

  const fetchTrialBalance = useCallback(async (level = 'subsidiary', startDate?: string, endDate?: string) => {
    setReportsLoading(true);
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
    } catch (err: any) {
      toast.error(err.message || 'خطا در دریافت تراز آزمایشی');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  const fetchIncomeStatement = useCallback(async (startDate?: string, endDate?: string) => {
    setReportsLoading(true);
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
    } catch (err: any) {
      toast.error(err.message || 'خطا در دریافت صورت سود و زیان');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  const fetchBalanceSheet = useCallback(async (asOfDate?: string) => {
    setReportsLoading(true);
    try {
      const params = new URLSearchParams();
      if (asOfDate) params.append('asOfDate', asOfDate);
      const res = await fetchJson(`/accounting/reports/balance-sheet?${params.toString()}`);
      if (res?.report) {
        setBalanceSheet(res.report);
      } else if (res) {
        setBalanceSheet(res);
      }
    } catch (err: any) {
      toast.error(err.message || 'خطا در دریافت ترازنامه');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  const fetchLedger = useCallback(async (accountId: number, startDate?: string, endDate?: string) => {
    setReportsLoading(true);
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
    } catch (err: any) {
      toast.error(err.message || 'خطا در دریافت گردش حساب');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  return {
    reportsLoading,
    trialBalance,
    incomeStatement,
    balanceSheet,
    ledgerReport,
    fetchTrialBalance,
    fetchIncomeStatement,
    fetchBalanceSheet,
    fetchLedger
  };
}
