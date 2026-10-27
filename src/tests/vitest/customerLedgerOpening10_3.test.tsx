import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Customer, User } from '../../types';

/**
 * 10.3 (ARCH review finding 3, part 12): the parties page account card reads through the shared cache, again on each
 * opening, never the card an earlier opening left there; a failed read is said once.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  open: 'تراز مالی',
  loading: 'در حال محاسبه تراز و بارگذاری اسناد حسابداری...',
  failed: 'خطا در دریافت کارت حساب شخص',
} as const;

const held: Array<(answer: unknown) => void> = [];
let holdCard = false;
let failCard = false;
const fetchJson = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/customers?')) return { data: [customer], total: 1, page: 1, totalPages: 1 };
  if (url === '/customers/7/account-card') {
    if (failCard) throw new Error('card failed');
    if (holdCard) { holdCard = false; return new Promise(resolve => { held.push(resolve); }); }
    return { report: cardOf('fresh') };
  }
  if (url.startsWith('/documents')) return { data: [] };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../SearchContext', () => ({
  useSearch: () => ({ searchQuery: '', debouncedSearchQuery: '', setSearchQuery: () => undefined }),
}));
vi.mock('../../hooks/useCRMData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useCRMData')>()),
  useCRMData: () => ({ leads: [], activities: [] }),
}));
vi.mock('../../components/crm/crmSharedHosts', () => ({
  CrmInteractionModalHost: () => null,
  CrmCustomerDossierHost: () => null,
  CrmLeadModalHost: () => null,
}));

import CustomersPage from '../../pages/CustomersPage';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { appQueryClient } from './helpers/queryWrapper';

const user: User = { id: 1, username: 'sales', full_name: 'sales user', role: 'sales' };
const customer = { id: 7, name: 'party', phone: '09121110001', partyType: 'both', version: 1 } as Customer;
const cardOf = (description: string) => ({
  items: [{ voucherId: 1, voucherNumber: 1, date: '2026-10-01', description, accountName: 'r', accountCode: '1201', detailedId: 7, debit: 1, credit: 0, runningBalance: 1 }],
  totalDebit: 1, totalCredit: 0, finalBalance: 1, currency: 'IRR',
});

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  held.length = 0;
  holdCard = false;
  failCard = false;
});

const pageOf = (client: QueryClient) => (
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <CustomersPage user={user} />
    </MemoryRouter>
  </QueryClientProvider>
);
const renderPage = (client: QueryClient) => render(pageOf(client));

describe('the parties page account card reads on each opening (10.3)', () => {
  it('never shows the card an earlier opening left while it reads again', async () => {
    const client = appQueryClient();
    client.setQueryData(QUERY_KEYS.accounting.report('customer-account-card', { customerId: 7, page: 1 }), cardOf('cached'), { updatedAt: Date.now() - 60_000 });
    holdCard = true;
    renderPage(client);
    fireEvent.click(await screen.findByText(SHOWN.open));
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.getByText(SHOWN.loading)).toBeTruthy();
    expect(screen.queryByText('cached')).toBeNull();
    await act(async () => { held[0]?.({ report: cardOf('fresh') }); });
    expect(await screen.findByText('fresh')).toBeTruthy();
  });

  it('says a failed read once', async () => {
    const toast = (await import('react-hot-toast')).toast as unknown as { error: ReturnType<typeof vi.fn> };
    toast.error.mockClear();
    failCard = true;
    const client = appQueryClient();
    const view = renderPage(client);
    fireEvent.click(await screen.findByText(SHOWN.open));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SHOWN.failed));
    view.rerender(pageOf(client));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(toast.error.mock.calls.filter(([m]) => m === SHOWN.failed)).toHaveLength(1);
  });
});
