import { useState, useCallback, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import { errorMessageOf } from '../utils';
import type {
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
  AccountLedgerReport
} from '../types';

type ReportKind = 'trialBalance' | 'incomeStatement' | 'balanceSheet' | 'ledger';

/**
 * P3-8 (v7.0.104): هر گزارش فقط پاسخ آخرین درخواست خودش را نشان می‌دهد. درخواست قبلی همان گزارش لغو می‌شود
 * (پیش‌تر پاسخ کندتر یک تاریخ/سطح قدیمی می‌توانست روی گزارش تازه بنشیند) و «در حال بارگذاری» تا پایان آخرین
 * درخواست در جریان می‌ماند (پیش‌تر پایان هر درخواست آن را خاموش می‌کرد).
 */
export function useAccountingReports() {
  const [pendingCount, setPendingCount] = useState(0);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [ledgerReport, setLedgerReport] = useState<AccountLedgerReport | null>(null);
  const controllers = useRef<Partial<Record<ReportKind, AbortController>>>({});

  useEffect(() => {
    const active = controllers.current;
    return () => {
      Object.values(active).forEach(c => c?.abort());
    };
  }, []);

  const loadReport = useCallback(async <T,>(
    kind: ReportKind,
    url: string,
    apply: (report: T) => void,
    errorText: string
  ) => {
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    setPendingCount(n => n + 1);
    try {
      const res = await fetchJson(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res?.report) {
        apply(res.report as T);
      } else if (res) {
        apply(res as T);
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) toast.error(errorMessageOf(err) || errorText);
    } finally {
      if (controllers.current[kind] === controller) delete controllers.current[kind];
      setPendingCount(n => Math.max(0, n - 1));
    }
  }, []);

  const fetchTrialBalance = useCallback(async (level = 'subsidiary', startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    params.append('level', level);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    await loadReport<TrialBalanceReport>('trialBalance', `/accounting/reports/trial-balance?${params.toString()}`, setTrialBalance, 'خطا در دریافت تراز آزمایشی');
  }, [loadReport]);

  const fetchIncomeStatement = useCallback(async (startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    await loadReport<IncomeStatementReport>('incomeStatement', `/accounting/reports/income-statement?${params.toString()}`, setIncomeStatement, 'خطا در دریافت صورت سود و زیان');
  }, [loadReport]);

  const fetchBalanceSheet = useCallback(async (asOfDate?: string) => {
    const params = new URLSearchParams();
    if (asOfDate) params.append('asOfDate', asOfDate);
    await loadReport<BalanceSheetReport>('balanceSheet', `/accounting/reports/balance-sheet?${params.toString()}`, setBalanceSheet, 'خطا در دریافت ترازنامه');
  }, [loadReport]);

  const fetchLedger = useCallback(async (accountId: number, startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    params.append('accountId', String(accountId));
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    await loadReport<AccountLedgerReport>('ledger', `/accounting/reports/ledger?${params.toString()}`, setLedgerReport, 'خطا در دریافت گردش حساب');
  }, [loadReport]);

  return {
    reportsLoading: pendingCount > 0,
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
