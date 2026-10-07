import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: () => false,
}));

import { TreasuryTransactionsTable } from '../../components/accounting/treasury/TreasuryTransactionsTable';
import { useTreasuryTransactionPageQuery } from '../../hooks/accounting/useTreasuryQueries';

afterEach(() => { cleanup(); fetchJson.mockReset(); });
const noop = () => undefined;
const bank = { id: 7, code: 'BANK-07', title: 'بانک ملت مرکزی', type: 'bank', bankName: 'ملت', currency: 'IRR', currentBalance: 0, accountId: 50 };
const row = (id: number) => ({
  id, transactionNumber: `REC-${String(id).padStart(6, '0')}`, type: 'receipt', status: 'completed', reversalOfId: null, voucherId: id,
  date: '2026-10-06', method: 'bank_transfer', amount: 1000, currency: 'IRR', bankAccountId: 7, partyType: 'other', partyName: `واریز ${id}`, attachments: [],
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// v9.0.102 (TD-509, B04-13): the treasury page reads one server page (filters, total and running balance from SQL),
// instead of loading the whole list (20,000 rows, 15.88 MB) and slicing it in the browser.
describe('treasury list is paged on the server (TD-509)', () => {
  it('asks the server for the page with its filters and returns its total', async () => {
    fetchJson.mockResolvedValue({ data: [row(21), row(22)], total: 45, page: 2, limit: 20 });
    const filters = { type: 'receipt', method: 'all', bankAccountId: '7', startDate: '2026-09-01', endDate: '', q: ' اجاره ' };
    const { result } = renderHook(() => useTreasuryTransactionPageQuery(filters, 2, 20), { wrapper });
    await waitFor(() => expect(result.current.data?.total).toBe(45));
    const url = String(fetchJson.mock.calls[0][0]);
    const params = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/accounting/treasury?')).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      type: 'receipt', bankAccountId: '7', startDate: '2026-09-01', q: 'اجاره', page: '2', limit: '20',
    });
    expect(result.current.data?.data.map(t => t.id)).toEqual([21, 22]);
  });

  it('the table shows the server page as it is on page 2 (20 rows of 45)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(21 + i));
    render(
      <TreasuryTransactionsTable transactions={rows as never} totalFilteredCount={45} bankAccounts={[bank] as never}
        runningBalanceMap={new Map([[21, 1_021_000]])} appCurrency="IRR" searchQuery="" setSearchQuery={noop} selectedTypeFilter="all"
        setSelectedTypeFilter={noop} selectedMethodFilter="all" setSelectedMethodFilter={noop} txAccountFilter="7" setTxAccountFilter={noop}
        dateFromFilter="" setDateFromFilter={noop} dateToFilter="" setDateToFilter={noop} txPage={2} setTxPage={noop} pageSize={20}
        copiedId={null} onCopy={noop} onExportExcel={noop} onViewAttachments={noop} onVoidTransaction={noop} />,
    );
    expect(screen.getByText('REC-000021')).toBeTruthy();
    expect(screen.getByText('REC-000040')).toBeTruthy();
    expect(screen.getAllByTitle('ابطال تراکنش و ثبت سند معکوس')).toHaveLength(20);
  });
});
