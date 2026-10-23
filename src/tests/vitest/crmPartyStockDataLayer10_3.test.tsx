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
} as const;

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
let serverItemName = 'glue';
let serverCardRows = 1;
let serverDocRef = 'S-1';
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
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
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const invalidate = (client: QueryClient, queryKey: readonly unknown[]) => act(async () => { await client.invalidateQueries({ queryKey }); });
const readsOf = (prefix: string) => fetchJson.mock.calls.filter(([u]) => u.startsWith(prefix)).length;
const noop = () => undefined;

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
    client.setQueryData(QUERY_KEYS.accounting.report('customer-account-card', { customerId: 7 }), stale, { updatedAt: Date.now() - 60_000 });
    renderDossier(client);
    fireEvent.click(screen.getByText(SHOWN.financialsTab));
    expect(await screen.findByText(SHOWN.oneRow)).toBeTruthy();
    expect(screen.queryByText(SHOWN.threeRows)).toBeNull();

    serverCardRows = 3;
    await invalidate(client, QUERY_KEYS.accounting.reports());
    expect(await screen.findByText(SHOWN.threeRows)).toBeTruthy();
  });

  it('follows a document change while open', async () => {
    const client = newClient();
    renderDossier(client);
    fireEvent.click(screen.getByText(SHOWN.documentsTab));
    expect(await screen.findByText('#S-1')).toBeTruthy();
    serverDocRef = 'S-2';
    await invalidate(client, QUERY_KEYS.customers.all);
    expect(await screen.findByText('#S-2')).toBeTruthy();
  });

  it('the account card read takes the report however the server wraps it', async () => {
    const { result } = renderHook(() => useCustomerAccountCardQuery(7), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  });
});
