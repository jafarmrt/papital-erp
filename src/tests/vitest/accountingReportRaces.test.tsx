import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAccountingReports } from '../../hooks/useAccountingReports';

// P3-8 (v7.0.104): پاسخ کندِ درخواست قدیمی یک گزارش نباید روی گزارش تازه بنشیند
// (از نسخه React Query صفحه حسابداری: پارامترها بخشی از کلید کش‌اند)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

afterEach(() => fetchJson.mockReset());

describe('accounting report requests (P3-8)', () => {
  it('keeps the trial balance of the latest request when an older one answers last', async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    fetchJson.mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
      const d = url.includes('level=group') ? older : newer;
      // like fetchJson: an aborted request rejects with AbortError
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        void d.promise.then(resolve);
      });
    });
    const { result } = renderHook(() => useAccountingReports(), { wrapper: withClient().wrapper });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.fetchTrialBalance('group');
      second = result.current.fetchTrialBalance('subsidiary');
    });

    await act(async () => {
      newer.resolve({ report: { rows: ['subsidiary'] } });
      await second;
    });
    await waitFor(() => expect(result.current.reportsLoading).toBe(false));
    expect(result.current.trialBalance).toEqual({ rows: ['subsidiary'] });
    await act(async () => {
      older.resolve({ report: { rows: ['group'] } });
      await first;
    });
    expect(result.current.trialBalance).toEqual({ rows: ['subsidiary'] });
  });

  it('stays loading until every report request has finished', async () => {
    const tb = deferred<unknown>();
    const is = deferred<unknown>();
    fetchJson.mockImplementation((url: string) => (url.includes('trial-balance') ? tb.promise : is.promise));
    const { result } = renderHook(() => useAccountingReports(), { wrapper: withClient().wrapper });

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.fetchTrialBalance();
      b = result.current.fetchIncomeStatement();
    });
    await act(async () => {
      tb.resolve({ report: { rows: [] } });
      await a;
    });
    expect(result.current.reportsLoading).toBe(true);
    await act(async () => {
      is.resolve({ report: { totals: {} } });
      await b;
    });
    await waitFor(() => expect(result.current.reportsLoading).toBe(false));
  });

});

describe('report views pass an abortable signal (P3-8)', () => {
  const pendingAbortable = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const signalsOf = (part: string) => fetchJson.mock.calls
    .filter(([url]) => String(url).includes(part))
    .map(([, init]) => (init as { signal?: AbortSignal } | undefined)?.signal);

  it('journal book and ratios: a repeated click is not re-sent, a new currency aborts the previous request, closing aborts all', async () => {
    fetchJson.mockImplementation(pendingAbortable);
    const { FinancialReportsTab } = await import('../../components/accounting/FinancialReportsTab');
    const noop = vi.fn(() => Promise.resolve());
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
    const { MemoryRouter } = await import('react-router-dom');
    const { wrapper: Wrapper } = withClient();
    const view = render(
      <Wrapper><MemoryRouter><FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={null}
        loading={false} onFetchTrialBalance={noop} onFetchIncomeStatement={noop} onFetchBalanceSheet={noop} onFetchLedger={noop} /></MemoryRouter></Wrapper>
    );
    fireEvent.click(screen.getByText('دفتر روزنامه رسمی'));
    fireEvent.click(screen.getByText('دفتر روزنامه رسمی'));
    // همان پارامترها: درخواست در جریان دوباره فرستاده نمی‌شود
    expect(signalsOf('journal-book')).toHaveLength(1);
    expect(signalsOf('journal-book')[0]?.aborted).toBe(false);

    fireEvent.click(screen.getByText('نسبت‌ها و سلامت مالی'));
    await waitFor(() => expect(signalsOf('financial-ratios')).toHaveLength(1));
    fireEvent.click(await screen.findByText('USD'));
    await waitFor(() => expect(signalsOf('financial-ratios')).toHaveLength(2));
    const ratios = signalsOf('financial-ratios');
    expect(fetchJson.mock.calls.filter(([url]) => String(url).includes('financial-ratios'))[1][0]).toBe('/accounting/reports/financial-ratios?currency=USD');
    expect(ratios[0]?.aborted).toBe(true);
    expect(ratios[1]?.aborted).toBe(false);

    view.unmount();
    expect(signalsOf('journal-book')[0]?.aborted).toBe(true);
    expect(signalsOf('financial-ratios')[1]?.aborted).toBe(true);
  });

  it('the party ledger request is aborted when the view closes', async () => {
    fetchJson.mockImplementation((url: string, init?: { signal?: AbortSignal }) =>
      url === '/accounting/reports/parties'
        ? Promise.resolve([{ id: 4, name: 'نگار کریمی', partyType: 'customer' }])
        : pendingAbortable(url, init));
    const { PartyLedgerReportView } = await import('../../components/accounting/reports/PartyLedgerReportView');
    const { render, waitFor } = await import('@testing-library/react');
    const { wrapper: Wrapper } = withClient();
    const view = render(<Wrapper><PartyLedgerReportView initialPartyId={4} initialPartyName="نگار کریمی" initialPartyType="customer" /></Wrapper>);
    await waitFor(() => expect(signalsOf('party-ledger')).toHaveLength(1));
    view.unmount();
    expect(signalsOf('party-ledger')[0]?.aborted).toBe(true);
  });
});
