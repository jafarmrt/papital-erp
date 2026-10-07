import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  getAuthToken: () => null,
  isAbortError: () => false,
}));
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { FinancialReportsTab } from '../../components/accounting/FinancialReportsTab';
import { BALANCE_SHEET_REPORT, INCOME_STATEMENT_REPORT, TRIAL_BALANCE_REPORT } from '../../hooks/accounting/useFinancialReportQueries';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

function renderTab() {
  const props = {
    onFetchTrialBalance: vi.fn(async () => {}), onFetchIncomeStatement: vi.fn(async () => {}),
    onFetchBalanceSheet: vi.fn(async () => {}), onFetchLedger: vi.fn(async () => {}),
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={null} loading={false} {...props} />;
  render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
  return props;
}

const BOX = 'همراه اسناد اختتامیه';

// v9.0.120 (TD-545, B03-03, product-owner decision t3 option A): once a year was closed, every report up to its last day showed
// it as zero. The server now leaves the closing run's vouchers out by default; the box «همراه اسناد اختتامیه» brings them back.
describe('reports leave year-end closing vouchers out unless the box is ticked (TD-545)', () => {
  it('the report URLs carry includeClosing only when the box is ticked', () => {
    expect(TRIAL_BALANCE_REPORT.url({ level: 'subsidiary', endDate: '2017-03-20' })).toBe('/accounting/reports/trial-balance?level=subsidiary&endDate=2017-03-20');
    expect(TRIAL_BALANCE_REPORT.url({ level: 'subsidiary', endDate: '2017-03-20', includeClosing: true }))
      .toBe('/accounting/reports/trial-balance?level=subsidiary&endDate=2017-03-20&includeClosing=true');
    expect(INCOME_STATEMENT_REPORT.url({ startDate: '2016-03-20', includeClosing: true })).toBe('/accounting/reports/income-statement?startDate=2016-03-20&includeClosing=true');
    expect(BALANCE_SHEET_REPORT.url({ asOfDate: '2017-03-20', includeClosing: true })).toBe('/accounting/reports/balance-sheet?asOfDate=2017-03-20&includeClosing=true');
    expect(BALANCE_SHEET_REPORT.url({ asOfDate: '2017-03-20' })).toBe('/accounting/reports/balance-sheet?asOfDate=2017-03-20');
  });

  it('trial balance, income statement and balance sheet: ticking the box refetches the open report with closing vouchers', () => {
    const p = renderTab();
    const box = () => screen.getByLabelText(BOX) as HTMLInputElement;
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(p.onFetchTrialBalance).toHaveBeenLastCalledWith('all', undefined, undefined, true);

    fireEvent.click(screen.getByText('صورت سود و زیان'));
    expect(p.onFetchIncomeStatement).toHaveBeenLastCalledWith(undefined, undefined, true);
    fireEvent.click(box());
    expect(p.onFetchIncomeStatement).toHaveBeenLastCalledWith(undefined, undefined, false);

    fireEvent.click(screen.getByText('ترازنامه اساسی'));
    expect(p.onFetchBalanceSheet).toHaveBeenLastCalledWith(undefined, false);
    fireEvent.click(box());
    expect(p.onFetchBalanceSheet).toHaveBeenLastCalledWith(undefined, true);
  });

  it('ratios: the box goes to the server', async () => {
    fetchJson.mockResolvedValue({ report: null });
    renderTab();
    fireEvent.click(screen.getByText('نسبت‌ها و سلامت مالی'));
    await waitFor(() => expect(fetchJson.mock.calls.at(-1)![0]).toBe('/accounting/reports/financial-ratios?'));
    fireEvent.click(screen.getByLabelText(BOX));
    await waitFor(() => expect(fetchJson.mock.calls.at(-1)![0]).toBe('/accounting/reports/financial-ratios?includeClosing=true'));
  });

  it('the account card has no such box', () => {
    renderTab();
    expect(screen.getByLabelText(BOX)).toBeTruthy();
    fireEvent.click(screen.getByText('دفاتر کل و معین'));
    expect(screen.queryByLabelText(BOX)).toBeNull();
  });
});
