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
// the Jalali picker as a plain text field holding the ISO value (its own conversion is covered by jalaliDateInput.test.tsx)
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange, placeholder }: { value: string; onChange: (iso: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { FinancialReportsTab } from '../../components/accounting/FinancialReportsTab';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

function renderTab() {
  const props = {
    onFetchTrialBalance: vi.fn(async () => {}), onFetchIncomeStatement: vi.fn(async () => {}),
    onFetchBalanceSheet: vi.fn(async () => {}), onFetchLedger: vi.fn(async () => {}),
  };
  render(withClient(<FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={null} loading={false} {...props} />));
  return props;
}

// v9.0.116 (TD-566, B03-24): the balance sheet and the ratios had no as-of date (always «today»), and the income statement had no
// period control of its own: it silently took the trial balance dates and showed no period.
describe('each financial statement has its own date in its header (TD-566)', () => {
  it('balance sheet: "as of today" by default, then the chosen date is requested and shown', () => {
    const p = renderTab();
    fireEvent.click(screen.getByText('ترازنامه اساسی'));
    expect(p.onFetchBalanceSheet).toHaveBeenLastCalledWith(undefined, false);
    expect(screen.getByText('تا امروز')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('امروز'), { target: { value: '2026-03-20' } });
    expect(p.onFetchBalanceSheet).toHaveBeenLastCalledWith('2026-03-20', false);
    expect(screen.getByText('تا تاریخ ۱۴۰۴/۱۲/۲۹')).toBeTruthy();
    fireEvent.click(screen.getByText('به‌روزرسانی ترازنامه'));
    expect(p.onFetchBalanceSheet).toHaveBeenLastCalledWith('2026-03-20', false);
  });

  it('income statement: its own period, not the trial balance dates, and the period is shown', () => {
    const p = renderTab();
    fireEvent.click(screen.getByText('صورت سود و زیان'));
    expect(p.onFetchIncomeStatement).toHaveBeenLastCalledWith(undefined, undefined, false);
    expect(screen.getByText('دوره: از آغاز دفاتر تا امروز')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('آغاز دفاتر'), { target: { value: '2026-03-21' } });
    expect(p.onFetchIncomeStatement).toHaveBeenLastCalledWith('2026-03-21', undefined, false);
    fireEvent.change(screen.getByLabelText('امروز'), { target: { value: '2026-09-22' } });
    expect(p.onFetchIncomeStatement).toHaveBeenLastCalledWith('2026-03-21', '2026-09-22', false);
    expect(screen.getByText('دوره: از ۱۴۰۵/۰۱/۰۱ تا ۱۴۰۵/۰۶/۳۱')).toBeTruthy();
  });

  it('ratios: the as-of date goes to the server and is kept when the currency changes', async () => {
    fetchJson.mockResolvedValue({ report: null });
    renderTab();
    fireEvent.click(screen.getByText('نسبت‌ها و سلامت مالی'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(fetchJson.mock.calls.at(-1)![0]).toBe('/accounting/reports/financial-ratios?');
    fireEvent.change(screen.getByLabelText('امروز'), { target: { value: '2026-03-20' } });
    await waitFor(() => expect(fetchJson.mock.calls.at(-1)![0]).toBe('/accounting/reports/financial-ratios?asOfDate=2026-03-20'));
    fireEvent.click(screen.getByText('دلار'));
    await waitFor(() => expect(fetchJson.mock.calls.at(-1)![0]).toBe('/accounting/reports/financial-ratios?asOfDate=2026-03-20&currency=USD'));
    expect(screen.getByText('تا تاریخ ۱۴۰۴/۱۲/۲۹')).toBeTruthy();
  });
});
