import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * 10.3 (ARCH review finding 3, part 12): the sales file drawer's stock tab and the party dossier's documents and account
 * card read through the shared cache. Each opening reads again and never shows what an earlier opening left; a stock,
 * document or voucher change refreshes them while they are open.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  stockTab: 'استعلام موجودی لحظه‌ای کالاها',
  activitiesTab: /تاریخچه تماس‌ها/,
  financialsTab: 'گردش و تراز مالی حسابداری',
  documentsTab: /پیش‌فاکتورها و اسناد/,
  oneRow: /\(۱ ردیف\)/,
  threeRows: /\(۳ ردیف\)/,
  stockFailed: 'خطا در دریافت اطلاعات موجودی انبارها',
  cardFailed: 'خطا در دریافت کارت حساب و صورت‌حساب مالی مشتری',
  documentsFailed: 'خطا در دریافت اسناد مشتری',
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
let serverItemName = 'glue';
let serverCardRows = 1;
let serverDocRef = 'S-1';
let holdPrefix: string | null = null;
const held: Array<{ resolve: (answer: unknown) => void; reject: (err: unknown) => void }> = [];
const failing = new Set<string>();
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (holdPrefix && url.startsWith(holdPrefix)) {
    holdPrefix = null;
    return new Promise((resolve, reject) => { held.push({ resolve, reject }); });
  }
  for (const prefix of failing) if (url.startsWith(prefix)) throw new Error(`${prefix} failed`);
  if (url.startsWith('/items/options')) return [{ id: 9, code: 'RM-9', name: serverItemName, current_stock: 3, stocks: { W1: 3 } }];
  if (url === '/warehouses') return [{ id: 1, code: 'W1', name: 'main' }];
  if (url === '/customers/7/account-card') {
    const card = { items: Array.from({ length: serverCardRows }, (_, i) => ({ id: i, debit: 1, credit: 0, runningBalance: 1 })), totalDebit: 1, totalCredit: 0, finalBalance: 1, currency: 'IRR' };
    return { report: card };
  }
  if (url.startsWith('/customers/7/documents')) return { data: [{ id: 1, refNumber: serverDocRef, type: 'invoice', status: 'final', date: '2026-10-01', currency: 'IRR' }] };
  if (url === '/settings') return {};
  return [];
});
vi.mock('../../api', () => ({
  API_URL: '/api',
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));

import { CRMLeadDrawer } from '../../components/crm/CRMLeadDrawer';
import { CustomerDossierDrawer } from '../../components/crm/CustomerDossierDrawer';
import { useCustomerAccountCardQuery } from '../../hooks/queries/useCustomerQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { CRMLead, Customer } from '../../types';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  serverItemName = 'glue';
  serverCardRows = 1;
  serverDocRef = 'S-1';
  holdPrefix = null;
  held.length = 0;
  failing.clear();
  toastError.mockClear();
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const invalidate = (client: QueryClient, queryKey: readonly unknown[]) => act(async () => { await client.invalidateQueries({ queryKey }); });
const readsOf = (prefix: string) => fetchJson.mock.calls.filter(([u]) => u.startsWith(prefix)).length;
const noop = () => undefined;
const toastError = vi.mocked((await import('react-hot-toast')).toast.error);
const stockItemsKey = [...QUERY_KEYS.items.all, 'options', 'crm-stock'];
const cardKey = QUERY_KEYS.accounting.report('customer-account-card', { customerId: 7 });
const earlier = { updatedAt: Date.now() - 60_000 };
const until = (n: number) => waitFor(() => expect(held).toHaveLength(n));

describe('the sales file drawer stock tab reads through the shared cache (10.3)', () => {
  const lead = { id: 1, title: 'file', stage: 'lead' } as CRMLead;
  const renderDrawer = (client: QueryClient) => render(
    <CRMLeadDrawer selectedLeadDrawer={lead} onCloseDrawer={noop} drawerActivities={[]} onOpenActivityModal={noop} onOpenLeadModal={noop} onToggleFollowup={noop} />,
    { wrapper: wrapperOf(client) },
  );

  it('reads the items when the tab opens and again on each opening, and follows a stock change while open', async () => {
    const client = newClient();
    renderDrawer(client);
    expect(readsOf('/items/options')).toBe(0);
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    expect(await screen.findByText('glue')).toBeTruthy();

    serverItemName = 'paint';
    await invalidate(client, QUERY_KEYS.items.all);
    expect(await screen.findByText('paint')).toBeTruthy();

    fireEvent.click(screen.getByText(SHOWN.activitiesTab));
    const before = readsOf('/items/options');
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    await waitFor(() => expect(readsOf('/items/options')).toBe(before + 1));
  });

  it('never shows the items an earlier opening of the tab left while it reads them again', async () => {
    const client = newClient();
    client.setQueryData(stockItemsKey, [{ id: 9, code: 'RM-9', name: 'cached', current_stock: 3, stocks: { W1: 3 } }], earlier);
    renderDrawer(client);
    holdPrefix = '/items/options';
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    await until(1);
    expect(screen.queryByText('cached')).toBeNull();
    await act(async () => { held[0]?.resolve([{ id: 9, code: 'RM-9', name: 'glue', current_stock: 3, stocks: { W1: 3 } }]); });
    expect(await screen.findByText('glue')).toBeTruthy();

    // closing the tab and opening it again is a new opening too
    fireEvent.click(screen.getByText(SHOWN.activitiesTab));
    holdPrefix = '/items/options';
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    await until(2);
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(screen.queryByText('glue')).toBeNull();
  });

  it('waits for the warehouses as well as the items', async () => {
    renderDrawer(newClient());
    holdPrefix = '/warehouses';
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    await until(1);
    await waitFor(() => expect(readsOf('/items/options')).toBe(1));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(screen.queryByText('glue')).toBeNull();
    await act(async () => { held[0]?.resolve([{ id: 1, code: 'W1', name: 'main' }]); });
    expect(await screen.findByText('glue')).toBeTruthy();
  });

  it('says a failure once when both reads fail, each at its own moment', async () => {
    failing.add('/items/options');
    holdPrefix = '/warehouses';
    renderDrawer(newClient());
    fireEvent.click(screen.getByText(SHOWN.stockTab));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await until(1);
    await act(() => new Promise(resolve => setTimeout(resolve, 5)));
    await act(async () => { held[0]?.reject(new Error('warehouses failed')); });
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    // react-hot-toast shows one message for one id
    expect(new Set(toastError.mock.calls.map(([message, opts]) => `${String(message)}|${(opts as { id?: string } | undefined)?.id}`))).toEqual(new Set([`${SHOWN.stockFailed}|crm-stock-failed`]));
  });
});

describe('the party dossier reads through the shared cache (10.3)', () => {
  const customer = { id: 7, name: 'party', partyType: 'customer', version: 1 } as Customer;
  const renderDossier = (client: QueryClient) => render(
    <CustomerDossierDrawer customer={customer} onClose={noop} onOpenLeadDrawer={noop} onOpenLeadModal={noop} onOpenActivityModal={noop} />,
    { wrapper: wrapperOf(client) },
  );

  it('never shows the account card an earlier opening left, and follows a voucher change while open', async () => {
    const client = newClient();
    const stale = { items: [{}, {}, {}], totalDebit: 3, totalCredit: 0, finalBalance: 3, currency: 'IRR' };
    client.setQueryData(cardKey, stale, earlier);
    holdPrefix = '/customers/7/account-card';
    renderDossier(client);
    fireEvent.click(screen.getByText(SHOWN.financialsTab));
    await until(1);
    expect(screen.queryByText(SHOWN.threeRows)).toBeNull();
    const card = { items: [{ id: 0, debit: 1, credit: 0, runningBalance: 1 }], totalDebit: 1, totalCredit: 0, finalBalance: 1, currency: 'IRR' };
    await act(async () => { held[0]?.resolve({ report: card }); });
    expect(await screen.findByText(SHOWN.oneRow)).toBeTruthy();

    serverCardRows = 3;
    await invalidate(client, QUERY_KEYS.accounting.reports());
    expect(await screen.findByText(SHOWN.threeRows)).toBeTruthy();
  });

  it('never shows the documents an earlier opening left, and follows a document change while open', async () => {
    const client = newClient();
    client.setQueryData([...QUERY_KEYS.customers.detail(7), 'documents'], [{ id: 1, refNumber: 'S-0', type: 'invoice', status: 'final', date: '2026-10-01', currency: 'IRR' }], earlier);
    holdPrefix = '/customers/7/documents';
    renderDossier(client);
    fireEvent.click(screen.getByText(SHOWN.documentsTab));
    await until(1);
    expect(screen.queryByText('#S-0')).toBeNull();
    await act(async () => { held[0]?.resolve({ data: [{ id: 1, refNumber: 'S-1', type: 'invoice', status: 'final', date: '2026-10-01', currency: 'IRR' }] }); });
    expect(await screen.findByText('#S-1')).toBeTruthy();
    serverDocRef = 'S-2';
    await invalidate(client, QUERY_KEYS.customers.all);
    expect(await screen.findByText('#S-2')).toBeTruthy();
  });

  it.each([
    ['/customers/7/account-card', SHOWN.cardFailed],
    ['/customers/7/documents', SHOWN.documentsFailed],
  ])('says a failed read of %s', async (prefix, message) => {
    failing.add(prefix);
    renderDossier(newClient());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
  });

  it('the account card read takes the report however the server wraps it', async () => {
    const { result } = renderHook(() => useCustomerAccountCardQuery(7), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  });
});
