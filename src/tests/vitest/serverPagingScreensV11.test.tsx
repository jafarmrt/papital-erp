import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AccountLedgerReport, Customer } from '../../types';

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
import { CustomerDossierDrawer } from '../../components/crm/CustomerDossierDrawer';
import { LEDGER_REPORT } from '../../hooks/accounting/useFinancialReportQueries';
import { usePrintSnapshot } from '../../hooks/usePrintSnapshot';

/**
 * v11 phase 6.1ch (M13, review): the screens of the server-paged account card. A card of several pages prints every row
 * (before the paging the print had every row, and printing one page under the totals of the period hid the rest); a
 * party's card starts on its first page each time it opens, and a page past the end goes back to the last page.
 */
const row = (n: number, balance: number) => ({
  voucherId: n, voucherNumber: n, date: '2026-04-01', description: `ردیف آزمون ${n}`, accountName: 'صندوق', accountCode: '1101',
  currency: 'IRR', debit: 1_000, credit: 0, runningBalance: balance, rowNumber: n,
});
const pageOne: AccountLedgerReport = {
  items: [row(1, 1_000), row(2, 2_000)], openingBalance: 0, totalDebit: 3_000, totalCredit: 0, finalBalance: 3_000, currency: 'IRR',
  total: 3, page: 1, limit: 2,
};
const everyRow: AccountLedgerReport = { ...pageOne, items: [row(1, 1_000), row(2, 2_000), row(3, 3_000)], limit: 3 };

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  window.print = print as unknown as typeof window.print;
});
afterEach(() => { cleanup(); fetchJson.mockReset(); });

describe('print of a paged card (M13)', () => {
  it('prints once the snapshot is on the page and drops it after the print', () => {
    const { result } = renderHook(() => usePrintSnapshot<number[]>());
    act(() => result.current[1]([1, 2, 3]));
    expect(print).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toEqual([1, 2, 3]);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(result.current[0]).toBeNull();
  });

  it('the ledger tab prints every row of a card of several pages, then shows its page again', async () => {
    const onLoadLedgerForPrint = vi.fn(async () => everyRow);
    const rowsAtPrint: string[][] = [];
    print.mockImplementation(() => {
      rowsAtPrint.push(screen.queryAllByText(/^ردیف آزمون/).map(cell => cell.textContent ?? ''));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui: ReactNode = (
      <FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={pageOne} loading={false}
        onFetchTrialBalance={vi.fn(async () => {})} onFetchIncomeStatement={vi.fn(async () => {})} onFetchBalanceSheet={vi.fn(async () => {})}
        onFetchLedger={vi.fn(async () => {})} onLedgerPageChange={vi.fn(async () => {})} onLoadLedgerForPrint={onLoadLedgerForPrint} />
    );
    render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByText('دفاتر کل و معین'));
    expect(screen.queryAllByText(/^ردیف آزمون/)).toHaveLength(2);

    fireEvent.click(screen.getByText('چاپ گزارش فعال'));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onLoadLedgerForPrint).toHaveBeenCalledTimes(1);
    expect(rowsAtPrint[0]).toEqual(['ردیف آزمون 1', 'ردیف آزمون 2', 'ردیف آزمون 3']);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(screen.queryAllByText(/^ردیف آزمون/)).toHaveLength(2);
  });

  it('a card of one page prints as it is, and the print read asks every row without a page', async () => {
    const onLoadLedgerForPrint = vi.fn(async () => everyRow);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}><MemoryRouter>
        <FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={{ ...pageOne, total: 2 }} loading={false}
          onFetchTrialBalance={vi.fn(async () => {})} onFetchIncomeStatement={vi.fn(async () => {})} onFetchBalanceSheet={vi.fn(async () => {})}
          onFetchLedger={vi.fn(async () => {})} onLedgerPageChange={vi.fn(async () => {})} onLoadLedgerForPrint={onLoadLedgerForPrint} />
      </MemoryRouter></QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('دفاتر کل و معین'));
    fireEvent.click(screen.getByText('چاپ گزارش فعال'));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(onLoadLedgerForPrint).not.toHaveBeenCalled();
    expect(LEDGER_REPORT.url({ accountId: 5, startDate: '2026-03-21', page: 3, exportAll: true }))
      .toBe('/accounting/reports/ledger?accountId=5&startDate=2026-03-21&export=true');
  });
});

describe('party card pages (M13)', () => {
  const customer = { id: 7, name: 'علی کاظمی', phone: '09121110001', partyType: 'both', version: 1 } as Customer;
  const card = (page: number, total: number, items: unknown[]) => ({
    items, totalDebit: 1_000, totalCredit: 0, finalBalance: 1_000, currency: 'IRR', total, page, limit: 200,
  });
  const cardUrls = () => fetchJson.mock.calls.map(c => String(c[0])).filter(u => u.includes('account-card'));

  function renderDossier(qc: QueryClient, who: Customer | null) {
    return (
      <QueryClientProvider client={qc}>
        <CustomerDossierDrawer customer={who} onClose={() => undefined} onOpenLeadDrawer={() => undefined}
          onOpenLeadModal={() => undefined} onOpenActivityModal={() => undefined} />
      </QueryClientProvider>
    );
  }

  it('a party opens on its first page again after the dossier closed on a later page', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(
      url === '/customers/7/account-card' ? card(1, 400, [row(1, 1_000)])
        : url === '/customers/7/account-card?page=2' ? card(2, 400, [row(201, 1_000)])
          : url.startsWith('/documents') ? { data: [] } : [],
    ));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(renderDossier(qc, customer));
    fireEvent.click(screen.getByText('گردش و تراز مالی حسابداری'));
    await waitFor(() => expect(cardUrls()).toContain('/customers/7/account-card'));
    fireEvent.click(await screen.findByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(cardUrls().at(-1)).toBe('/customers/7/account-card?page=2'));

    view.rerender(renderDossier(qc, null));
    fetchJson.mockClear();
    view.rerender(renderDossier(qc, customer));
    await waitFor(() => expect(cardUrls().at(-1)).toBe('/customers/7/account-card'));
    expect(cardUrls()).not.toContain('/customers/7/account-card?page=2');
  });

  it('a page past the end (rows voided since) goes back to the last page', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(
      url === '/customers/7/account-card' ? card(1, 400, [row(1, 1_000)])
        : url === '/customers/7/account-card?page=2' ? card(2, 150, [])
          : url.startsWith('/documents') ? { data: [] } : [],
    ));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(renderDossier(qc, customer));
    fireEvent.click(screen.getByText('گردش و تراز مالی حسابداری'));
    fireEvent.click(await screen.findByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(cardUrls()).toContain('/customers/7/account-card?page=2'));
    // the card of 150 rows has one page: the dossier goes back to it and shows its row
    expect(await screen.findByText('ردیف آزمون 1')).toBeTruthy();
  });
});
