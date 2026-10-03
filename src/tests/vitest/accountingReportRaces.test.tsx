import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAccountingReports } from '../../hooks/useAccountingReports';
import { useLatestRequest } from '../../hooks/useLatestRequest';

// P3-8 (v7.0.104): پاسخ کندِ درخواست قدیمی یک گزارش نباید روی گزارش تازه بنشیند
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
    const { result } = renderHook(() => useAccountingReports());

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
    expect(result.current.reportsLoading).toBe(false);
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
    const { result } = renderHook(() => useAccountingReports());

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
    expect(result.current.reportsLoading).toBe(false);
  });

  it('useLatestRequest supersedes the previous request and aborts on unmount', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const first = result.current();
    const second = result.current();
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
    unmount();
    expect(second.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(false);
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

  it('journal book and ratios abort the previous request when reloaded', async () => {
    fetchJson.mockImplementation(pendingAbortable);
    const { FinancialReportsTab } = await import('../../components/accounting/FinancialReportsTab');
    const noop = vi.fn(() => Promise.resolve());
    const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
    const { MemoryRouter } = await import('react-router-dom');
    render(
      <MemoryRouter><FinancialReportsTab accounts={[]} trialBalance={null} incomeStatement={null} balanceSheet={null} ledgerReport={null}
        loading={false} onFetchTrialBalance={noop} onFetchIncomeStatement={noop} onFetchBalanceSheet={noop} onFetchLedger={noop} /></MemoryRouter>
    );
    fireEvent.click(screen.getByText('دفتر روزنامه رسمی'));
    fireEvent.click(screen.getByText('دفتر روزنامه رسمی'));
    fireEvent.click(screen.getByText('نسبت‌ها و سلامت مالی'));
    fireEvent.click(screen.getByText('نسبت‌ها و سلامت مالی'));
    for (const part of ['journal-book', 'financial-ratios']) {
      const signals = signalsOf(part);
      expect(signals).toHaveLength(2);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
    }
    cleanup();
  });

  it('the party ledger request is aborted when the view closes', async () => {
    fetchJson.mockImplementation((url: string, init?: { signal?: AbortSignal }) =>
      url === '/accounting/reports/parties'
        ? Promise.resolve([{ id: 4, name: 'نگار کریمی', partyType: 'customer' }])
        : pendingAbortable(url, init));
    const { PartyLedgerReportView } = await import('../../components/accounting/reports/PartyLedgerReportView');
    const { render, waitFor } = await import('@testing-library/react');
    const view = render(<PartyLedgerReportView initialPartyId={4} initialPartyName="نگار کریمی" initialPartyType="customer" />);
    await waitFor(() => expect(signalsOf('party-ledger')).toHaveLength(1));
    view.unmount();
    expect(signalsOf('party-ledger')[0]?.aborted).toBe(true);
  });
});
