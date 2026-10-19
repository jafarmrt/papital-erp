import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AccountingPage from '../../pages/AccountingPage';
import { PERSONNEL_PICK_URL } from '../../lib/personnel/personnelList';

// OBS-R2-105 (TD-1322): the accounting page reads only the lists of the tab on screen (and the voucher window's lists
// while it is open); before, every tab mounted nine list queries, so the fiscal closing tab read accounts, bank
// accounts, cheques, customers and personnel it never shows, and a tab the viewer may not open read them all too.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const LISTS = {
  summary: '/accounting/summary',
  accounts: '/accounting/accounts',
  tree: '/accounting/accounts/tree',
  vouchers: '/accounting/vouchers',
  bankAccounts: '/accounting/bank-accounts',
  bankAccountOptions: '/accounting/bank-accounts/options',
  cheques: '/accounting/cheques',
  customers: '/customers/options',
  personnel: PERSONNEL_PICK_URL,
} as const;
type ListName = keyof typeof LISTS;
const REFRESH_LABEL = /به‌روزرسانی/;

function respond(url: string): unknown {
  if (url === LISTS.summary) return { stats: null };
  if (url.startsWith('/accounting/fiscal-closing/preview')) {
    return { summary: { totalRevenue: 0, totalExpenses: 0, netProfit: 0, isProfit: true }, temporaryAccounts: [], permanentAccounts: [] };
  }
  if (url === '/accounting/fiscal-closing/years') return { currentYear: 1405, years: [], defaultYear: 1404, reopenableYear: null };
  return [];
}

function renderTab(tab: string, permissions: { permissions: string[]; isAdmin: boolean } = { permissions: [], isAdmin: true }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/accounting/${tab}`]}>
        <Routes>
          <Route path="/accounting/:tab" element={<AccountingPage userPermissions={permissions} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const readLists = (): ListName[] => (Object.keys(LISTS) as ListName[])
  .filter(name => fetchJson.mock.calls.some(([url]) => url === LISTS[name]));
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('accounting_tab_lists_td_1322', () => {
  it.each<[string, ListName[]]>([
    ['dashboard', ['summary', 'vouchers', 'cheques']],
    ['treasury', ['accounts', 'bankAccounts', 'customers', 'personnel']],
    ['cheques', ['bankAccountOptions', 'cheques', 'customers', 'personnel']],
    ['explorer', ['accounts', 'bankAccounts', 'customers', 'personnel']],
    ['reports', ['accounts']],
    ['fiscal-closing', []],
  ])('the %s tab reads only its own lists', async (tab, expected) => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderTab(tab);
    await settle();
    await waitFor(() => expect(readLists()).toEqual(expected));
    await settle();
    expect(readLists()).toEqual(expected);
  });

  it('the voucher window reads the accounts and parties it needs from any tab', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderTab('fiscal-closing');
    await settle();
    expect(readLists()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /ثبت سند جدید/ }));
    await waitFor(() => expect(readLists()).toEqual(['accounts', 'customers', 'personnel']));
  });

  it('a tab the viewer may not open reads no list', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderTab('treasury', { permissions: [], isAdmin: false });
    expect(await screen.findByText('دسترسی محدود شده است')).toBeTruthy();
    await settle();
    expect(readLists()).toEqual([]);
  });

  it('the refresh button reads again only the lists on screen', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderTab('reports');
    await waitFor(() => expect(readLists()).toEqual(['accounts']));
    await settle();
    // the button is disabled while a list still loads: wait until it can be pressed, so the click is never lost
    const refresh = screen.getByRole('button', { name: REFRESH_LABEL }) as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fetchJson.mockClear();
    fireEvent.click(refresh);
    await waitFor(() => expect(readLists()).toEqual(['accounts']));
    await settle();
    expect(readLists()).toEqual(['accounts']);
  });
});
