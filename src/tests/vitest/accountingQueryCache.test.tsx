import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, partialMatchKey, type QueryKey } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import AccountingPage from '../../pages/AccountingPage';
import { useAccounting } from '../../hooks/useAccounting';
import { QUERY_KEYS } from '../../lib/queryKeys';

// صفحه حسابداری با React Query: ذخیره سند، تراکنش خزانه، تغییر وضعیت چک و بستن سال مالی کش‌های متاثر (فهرست اسناد،
// مانده‌های خزانه، گزارش‌های مالی، اسناد انبار/فروش، لیست حقوق) را باطل می‌کنند؛ خواندنی‌ها سیگنال لغو می‌گیرند و با
// بسته شدن صفحه/مودال لغو می‌شوند و پاسخ دیررس پارامترهای قدیمی جای نتیجه تازه را نمی‌گیرد
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface RequestInitLike { method?: string; body?: string; signal?: AbortSignal }

const assetsGroup = { id: 1, code: '1', name: 'دارایی‌ها', level: 'group', accountType: 'asset', nature: 'debit', isSystem: 1 };
const LEDGER_ALL = '/accounting/reports/ledger?';
const LEDGER_ASSETS = '/accounting/reports/ledger?accountId=1';
const PREVIEW_PREFIX = '/accounting/fiscal-closing/preview?';
const preview = {
  summary: { totalRevenue: 1000, totalExpenses: 400, netProfit: 600, isProfit: true },
  temporaryAccounts: [], permanentAccounts: [],
};

function baseResponse(url: string, init?: RequestInitLike): unknown {
  const method = init?.method ?? 'GET';
  if (method === 'GET') {
    if (url === '/accounting/summary') return { stats: null };
    if (url === '/accounting/accounts') return [assetsGroup];
    if (url.startsWith(PREVIEW_PREFIX)) return preview;
    if (url.startsWith('/accounting/reports/ledger')) return { items: [], totalDebit: 0, totalCredit: 0, finalBalance: 0 };
    return [];
  }
  if (url === '/accounting/vouchers' && method === 'POST') return { id: 50 };
  if (url === '/accounting/treasury' && method === 'POST') return { id: 9 };
  if (url === '/accounting/cheques/3/status' && method === 'PATCH') return { success: true };
  if (url === '/accounting/fiscal-closing/execute' && method === 'POST') return { success: true, message: 'سال مالی بسته شد', year: '1405', netProfit: 600, closingVouchers: [] };
  return { success: true };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function hookWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderAccountingPage(client: QueryClient, tab: string) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/accounting/${tab}`]}>
        <Routes>
          <Route path="/accounting/:tab" element={<AccountingPage userPermissions={{ permissions: [], isAdmin: true }} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const getCalls = (match: (url: string) => boolean) =>
  fetchJson.mock.calls.filter(([u, init]) => match(String(u)) && ((init as RequestInitLike | undefined)?.method ?? 'GET') === 'GET');
const callsTo = (url: string) => getCalls(u => u === url).length;
const signalOf = (match: (url: string) => boolean, index = 0): AbortSignal | undefined =>
  (getCalls(match)[index]?.[1] as RequestInitLike | undefined)?.signal;
const bodyOf = (url: string, method: string) => {
  const call = fetchJson.mock.calls.find(([u, init]) => u === url && (init as RequestInitLike | undefined)?.method === method);
  return JSON.parse(String((call?.[1] as RequestInitLike).body));
};

/** داده کش‌شده صفحات/گزارش‌های دیگر که الان مشاهده‌گر ندارند؛ پیش از ذخیره هیچ‌کدام باطل نیست */
function seed(client: QueryClient, keys: QueryKey[]) {
  keys.forEach(key => client.setQueryData(key, { data: [] }));
}
function expectInvalidated(client: QueryClient, keys: QueryKey[], value: boolean) {
  keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(value));
}
/** کلیدهای فعال صفحه بلافاصله دوباره خوانده می‌شوند؛ باطل شدن آن‌ها از فیلترهای invalidateQueries دیده می‌شود */
function wasInvalidated(spy: MockInstance, key: QueryKey): boolean {
  return spy.mock.calls.some(([filters]) => {
    const filterKey = (filters as { queryKey?: QueryKey } | undefined)?.queryKey;
    return filterKey !== undefined && partialMatchKey(key, filterKey);
  });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('useAccounting — mutations invalidate the affected caches', () => {
  it('a voucher save invalidates the vouchers list, balances, trial balance / ledger reports, documents and payroll lists', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(baseResponse(url, init)));
    const client = newClient();
    const otherKeys = [
      QUERY_KEYS.accounting.report('trial-balance', { level: 'all' }),
      QUERY_KEYS.accounting.report('ledger', { accountId: 5 }),
      QUERY_KEYS.documents.list({ page: 1, limit: 50 }),
      QUERY_KEYS.piecework.payrolls(),
    ];
    const unrelated = [QUERY_KEYS.items.list({ type: 'all', all: true })];
    seed(client, [...otherKeys, ...unrelated]);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAccounting(), { wrapper: hookWrapper(client) });
    await waitFor(() => expect(callsTo('/accounting/vouchers')).toBe(1));
    expectInvalidated(client, otherKeys, false);

    await act(async () => {
      await result.current.handleSaveVoucher({ description: 'سند تست', date: '1405/07/01', items: [] });
    });

    // همان POST صفحه پیشین
    expect(bodyOf('/accounting/vouchers', 'POST')).toEqual({ description: 'سند تست', date: '1405/07/01', items: [] });
    expectInvalidated(client, otherKeys, true);
    expectInvalidated(client, unrelated, false);
    [QUERY_KEYS.accounting.vouchers({}), QUERY_KEYS.accounting.accountsList(), QUERY_KEYS.accounting.summary()]
      .forEach(key => expect(wasInvalidated(spy, key), JSON.stringify(key)).toBe(true));
    await waitFor(() => expect(callsTo('/accounting/vouchers')).toBe(2));
  });

  it('a treasury transaction and a cheque status change invalidate treasury balances, cheques, reports, documents and payroll', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(baseResponse(url, init)));
    const client = newClient();
    const otherKeys = [
      QUERY_KEYS.accounting.report('cash-flow', { startDate: '1405/01/01' }),
      QUERY_KEYS.accounting.report('trial-balance', { level: 'all' }),
      QUERY_KEYS.documents.list({ page: 1, limit: 50 }),
      QUERY_KEYS.piecework.payrolls(),
    ];
    seed(client, otherKeys);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAccounting(), { wrapper: hookWrapper(client) });
    await waitFor(() => expect(callsTo('/accounting/bank-accounts')).toBe(1));

    await act(async () => {
      await result.current.handleCreateTreasuryTransaction({ type: 'receipt', bankAccountId: 2, amount: 5000 });
    });
    expect(bodyOf('/accounting/treasury', 'POST')).toEqual({ type: 'receipt', bankAccountId: 2, amount: 5000 });
    expectInvalidated(client, otherKeys, true);
    [QUERY_KEYS.accounting.bankAccounts(), QUERY_KEYS.accounting.treasuryTransactions(), QUERY_KEYS.accounting.vouchers({})]
      .forEach(key => expect(wasInvalidated(spy, key), JSON.stringify(key)).toBe(true));
    await waitFor(() => expect(callsTo('/accounting/bank-accounts')).toBe(2));

    seed(client, otherKeys);
    spy.mockClear();
    await act(async () => {
      await result.current.handleUpdateChequeStatus(3, 'passed', 'وصول چک', 2);
    });
    expect(bodyOf('/accounting/cheques/3/status', 'PATCH')).toEqual({ status: 'passed', description: 'وصول چک', notes: 'وصول چک', bankAccountId: 2 });
    expectInvalidated(client, otherKeys, true);
    [QUERY_KEYS.accounting.bankAccounts(), QUERY_KEYS.accounting.treasuryTransactions(), QUERY_KEYS.accounting.cheques({})]
      .forEach(key => expect(wasInvalidated(spy, key), JSON.stringify(key)).toBe(true));
  });
});

describe('AccountingPage — reads are abortable and race-free', () => {
  it('passes an abort signal to the explorer ledger and core lists and aborts them when the page closes', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => (
      url.startsWith('/accounting/reports/ledger') || url === '/accounting/vouchers'
        ? new Promise(() => undefined)
        : Promise.resolve(baseResponse(url, init))
    ));
    const { unmount } = renderAccountingPage(newClient(), 'explorer');
    await waitFor(() => expect(callsTo(LEDGER_ALL)).toBe(1));
    const ledgerSignal = signalOf(u => u === LEDGER_ALL);
    const vouchersSignal = signalOf(u => u === '/accounting/vouchers');
    expect(ledgerSignal).toBeInstanceOf(AbortSignal);
    expect(ledgerSignal?.aborted).toBe(false);

    unmount();

    expect(ledgerSignal?.aborted).toBe(true);
    expect(vouchersSignal?.aborted).toBe(true);
  });

  it('a late explorer-ledger response for the previous selection never overwrites the newer selection', async () => {
    const stale = deferred<unknown>();
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      if (url === LEDGER_ALL) return stale.promise;
      if (url === LEDGER_ASSETS) {
        return Promise.resolve({ items: [{ voucherId: 2, voucherNumber: 2, date: '1405/07/02', description: '', accountName: 'ردیف تازه', accountCode: '1', debit: 10, credit: 0, runningBalance: 10 }], totalDebit: 10, totalCredit: 0, finalBalance: 10 });
      }
      return Promise.resolve(baseResponse(url, init));
    });
    renderAccountingPage(newClient(), 'explorer');
    await waitFor(() => expect(callsTo(LEDGER_ALL)).toBe(1));

    fireEvent.click(await screen.findByText('دارایی‌ها', { selector: 'div' }));
    expect(await screen.findByText('ردیف تازه')).toBeTruthy();
    expect(signalOf(u => u === LEDGER_ALL)?.aborted).toBe(true);

    await act(async () => {
      stale.resolve({ items: [{ voucherId: 1, voucherNumber: 1, date: '1405/07/01', description: '', accountName: 'ردیف کهنه', accountCode: '9', debit: 5, credit: 0, runningBalance: 5 }], totalDebit: 5, totalCredit: 0, finalBalance: 5 });
    });
    expect(screen.queryByText('ردیف کهنه')).toBeNull();
    expect(screen.getByText('ردیف تازه')).toBeTruthy();
  });

  it('the cash-flow report request carries a signal and is aborted when its modal closes', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => (
      url.startsWith('/accounting/reports/cash-flow') ? new Promise(() => undefined) : Promise.resolve(baseResponse(url, init))
    ));
    renderAccountingPage(newClient(), 'treasury');
    fireEvent.click(await screen.findByRole('button', { name: /گزارش جریان نقدینگی/ }));
    await waitFor(() => expect(getCalls(u => u.startsWith('/accounting/reports/cash-flow'))).toHaveLength(1));
    const signal = signalOf(u => u.startsWith('/accounting/reports/cash-flow'));
    expect(signal).toBeInstanceOf(AbortSignal);

    fireEvent.click(screen.getByRole('button', { name: 'بستن' }));

    expect(signal?.aborted).toBe(true);
  });

  it('fiscal closing: the preview is abortable, execution runs once while pending and invalidates vouchers and reports but not the preview', async () => {
    const execute = deferred<unknown>();
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => (
      url === '/accounting/fiscal-closing/execute' ? execute.promise : Promise.resolve(baseResponse(url, init))
    ));
    const client = newClient();
    const otherKeys = [QUERY_KEYS.accounting.report('trial-balance', { level: 'all' }), QUERY_KEYS.documents.list({ page: 1, limit: 50 })];
    seed(client, otherKeys);
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderAccountingPage(client, 'fiscal-closing');

    const runButton = await screen.findByRole('button', { name: /اجرای قطعی بستن سال مالی/ });
    expect(signalOf(u => u.startsWith(PREVIEW_PREFIX))).toBeInstanceOf(AbortSignal);
    const previewCalls = getCalls(u => u.startsWith(PREVIEW_PREFIX)).length;
    fireEvent.click(runButton);
    const confirm = screen.getByRole('button', { name: /تایید و بستن قطعی سال مالی/ }) as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(fetchJson.mock.calls.filter(([u]) => u === '/accounting/fiscal-closing/execute')).toHaveLength(1);

    await act(async () => { execute.resolve(baseResponse('/accounting/fiscal-closing/execute', { method: 'POST' })); });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('سال مالی بسته شد'));
    expectInvalidated(client, otherKeys, true);
    expect(wasInvalidated(spy, QUERY_KEYS.accounting.vouchers({}))).toBe(true);
    // پیش‌نمایش نمایش‌داده‌شده مثل قبل دوباره خوانده نمی‌شود
    expect(getCalls(u => u.startsWith(PREVIEW_PREFIX))).toHaveLength(previewCalls);
  });
});
