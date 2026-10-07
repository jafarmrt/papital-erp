import { useCallback } from 'react';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type {
  AccountLedgerReport,
  BalanceSheetReport,
  FinancialRatiosReport,
  IncomeStatementReport,
  TrialBalanceReport,
} from '../../types';
import { reportFromResponse, useOnDemandReport, type OnDemandReportSpec } from './useOnDemandReport';

/**
 * گزارش‌های تب «صورت‌ها و گزارش‌های مالی» با React Query: تراز آزمایشی، صورت سود و زیان، ترازنامه، گردش حساب،
 * دفتر روزنامه و نسبت‌های مالی. همه پارامترها (سطح، بازه تاریخ، حساب، ارز) بخشی از کلید کش‌اند و هر ذخیره سند،
 * خزانه یا چک این گزارش‌ها را باطل و دوباره خوانده می‌کند. همان آدرس‌ها و پیام‌های خطای صفحه پیشین.
 */

const R = QUERY_KEYS.accounting.report;

/** v9.0.120 (TD-545): «همراه اسناد اختتامیه» (پیش‌فرض اسناد بستن سالِ روز پایان گزارش شمرده نمی‌شوند) */
export interface ClosingVouchersParam { includeClosing?: boolean }
export interface TrialBalanceParams extends ClosingVouchersParam { level: string; startDate?: string; endDate?: string }
export interface DateRangeParams { startDate?: string; endDate?: string }
export interface IncomeStatementParams extends DateRangeParams, ClosingVouchersParam {}
export interface BalanceSheetParams extends ClosingVouchersParam { asOfDate?: string }
export interface LedgerParams { accountId: number; startDate?: string; endDate?: string }
export interface RatiosParams extends ClosingVouchersParam { asOfDate?: string; currency?: string }

function dateRange(params: URLSearchParams, { startDate, endDate }: DateRangeParams): URLSearchParams {
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  return params;
}

function closingFlag(params: URLSearchParams, { includeClosing }: ClosingVouchersParam): URLSearchParams {
  if (includeClosing) params.append('includeClosing', 'true');
  return params;
}

export const TRIAL_BALANCE_REPORT: OnDemandReportSpec<TrialBalanceParams, TrialBalanceReport | null> = {
  key: (p) => R('trial-balance', p),
  idleKey: R('trial-balance', { idle: true }),
  url: (p) => {
    const params = new URLSearchParams();
    params.append('level', p.level);
    return `/accounting/reports/trial-balance?${closingFlag(dateRange(params, p), p).toString()}`;
  },
  parse: reportFromResponse<TrialBalanceReport>,
  errorText: 'خطا در دریافت تراز آزمایشی',
};

export const INCOME_STATEMENT_REPORT: OnDemandReportSpec<IncomeStatementParams, IncomeStatementReport | null> = {
  key: (p) => R('income-statement', p),
  idleKey: R('income-statement', { idle: true }),
  url: (p) => `/accounting/reports/income-statement?${closingFlag(dateRange(new URLSearchParams(), p), p).toString()}`,
  parse: reportFromResponse<IncomeStatementReport>,
  errorText: 'خطا در دریافت صورت سود و زیان',
};

export const BALANCE_SHEET_REPORT: OnDemandReportSpec<BalanceSheetParams, BalanceSheetReport | null> = {
  key: (p) => R('balance-sheet', p),
  idleKey: R('balance-sheet', { idle: true }),
  url: (p) => {
    const params = new URLSearchParams();
    if (p.asOfDate) params.append('asOfDate', p.asOfDate);
    return `/accounting/reports/balance-sheet?${closingFlag(params, p).toString()}`;
  },
  parse: reportFromResponse<BalanceSheetReport>,
  errorText: 'خطا در دریافت ترازنامه',
};

export const LEDGER_REPORT: OnDemandReportSpec<LedgerParams, AccountLedgerReport | null> = {
  key: (p) => R('ledger', p),
  idleKey: R('ledger', { idle: true }),
  url: (p) => {
    const params = new URLSearchParams();
    params.append('accountId', String(p.accountId));
    return `/accounting/reports/ledger?${dateRange(params, p).toString()}`;
  },
  parse: reportFromResponse<AccountLedgerReport>,
  errorText: 'خطا در دریافت گردش حساب',
};

const JOURNAL_BOOK_REPORT: OnDemandReportSpec<DateRangeParams, unknown> = {
  key: (p) => R('journal-book', p),
  idleKey: R('journal-book', { idle: true }),
  url: (p) => `/accounting/reports/journal-book?${dateRange(new URLSearchParams(), p).toString()}`,
  parse: reportFromResponse<unknown>,
  errorText: 'خطا در بارگذاری دفتر روزنامه',
};

const FINANCIAL_RATIOS_REPORT: OnDemandReportSpec<RatiosParams, FinancialRatiosReport | null> = {
  key: (p) => R('financial-ratios', p),
  idleKey: R('financial-ratios', { idle: true }),
  url: (p) => {
    const params = new URLSearchParams();
    if (p.asOfDate) params.append('asOfDate', p.asOfDate);
    if (p.currency && p.currency !== 'all') params.append('currency', p.currency);
    return `/accounting/reports/financial-ratios?${closingFlag(params, p).toString()}`;
  },
  parse: reportFromResponse<FinancialRatiosReport>,
  errorText: 'خطا در محاسبه نسبت‌های مالی',
};

/** دفتر روزنامه رسمی (تب گزارش‌ها) */
export function useJournalBookReport() {
  const report = useOnDemandReport(JOURNAL_BOOK_REPORT);
  const { run } = report;
  const fetchJournalBook = useCallback(async (startDate?: string, endDate?: string) => {
    await run({ startDate: startDate || undefined, endDate: endDate || undefined });
  }, [run]);
  return { journalBookData: report.data, journalLoading: report.loading, fetchJournalBook };
}

/** نسبت‌ها و سلامت مالی (تب گزارش‌ها) */
export function useFinancialRatiosReport() {
  const report = useOnDemandReport(FINANCIAL_RATIOS_REPORT);
  const { run } = report;
  const fetchFinancialRatios = useCallback(async (asOfDate?: string, currency?: string, includeClosing?: boolean) => {
    await run({
      asOfDate: asOfDate || undefined,
      currency: currency && currency !== 'all' ? currency : undefined,
      includeClosing: includeClosing || undefined,
    });
  }, [run]);
  return { ratiosData: report.data, ratiosLoading: report.loading, fetchFinancialRatios };
}
