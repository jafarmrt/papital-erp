import { useCallback } from 'react';
import { useOnDemandReport } from './accounting/useOnDemandReport';
import {
  BALANCE_SHEET_REPORT,
  INCOME_STATEMENT_REPORT,
  LEDGER_REPORT,
  TRIAL_BALANCE_REPORT,
} from './accounting/useFinancialReportQueries';

/**
 * P3-8 (v7.0.104): هر گزارش فقط نتیجه آخرین پارامترهای خودش را نشان می‌دهد و «در حال بارگذاری» تا پایان همه
 * درخواست‌های در جریان می‌ماند. از نسخه React Query، پارامترها (سطح، بازه تاریخ، حساب) بخشی از کلید کش‌اند:
 * پاسخ دیررس پارامترهای قدیمی فقط در کش همان پارامترها می‌نشیند و درخواست قبلی با رفتن به پارامتر دیگر یا بسته
 * شدن صفحه لغو می‌شود. ذخیره سند/خزانه/چک این گزارش‌ها را باطل و دوباره خوانده می‌کند.
 */
export function useAccountingReports() {
  const trial = useOnDemandReport(TRIAL_BALANCE_REPORT);
  const income = useOnDemandReport(INCOME_STATEMENT_REPORT);
  const balance = useOnDemandReport(BALANCE_SHEET_REPORT);
  const ledger = useOnDemandReport(LEDGER_REPORT);
  const runTrial = trial.run;
  const runIncome = income.run;
  const runBalance = balance.run;
  const runLedger = ledger.run;

  // v9.0.148 (TD-545): includeClosing = «همراه اسناد اختتامیه»
  const fetchTrialBalance = useCallback(async (level = 'subsidiary', startDate?: string, endDate?: string, includeClosing?: boolean) => {
    await runTrial({ level, startDate: startDate || undefined, endDate: endDate || undefined, includeClosing: includeClosing || undefined });
  }, [runTrial]);

  const fetchIncomeStatement = useCallback(async (startDate?: string, endDate?: string, includeClosing?: boolean) => {
    await runIncome({ startDate: startDate || undefined, endDate: endDate || undefined, includeClosing: includeClosing || undefined });
  }, [runIncome]);

  const fetchBalanceSheet = useCallback(async (asOfDate?: string, includeClosing?: boolean) => {
    await runBalance({ asOfDate: asOfDate || undefined, includeClosing: includeClosing || undefined });
  }, [runBalance]);

  const fetchLedger = useCallback(async (accountId: number, startDate?: string, endDate?: string) => {
    await runLedger({ accountId, startDate: startDate || undefined, endDate: endDate || undefined });
  }, [runLedger]);

  return {
    reportsLoading: trial.loading || income.loading || balance.loading || ledger.loading,
    trialBalance: trial.data,
    incomeStatement: income.data,
    balanceSheet: balance.data,
    ledgerReport: ledger.data,
    fetchTrialBalance,
    fetchIncomeStatement,
    fetchBalanceSheet,
    fetchLedger
  };
}
