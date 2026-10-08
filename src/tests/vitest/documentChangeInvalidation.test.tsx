import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import DocumentsPage from '../../pages/DocumentsPage';
import { SearchProvider } from '../../SearchContext';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { User } from '../../types';

// v9.0.341 (TD-796, finding B08-27): saving a stock document and voiding a document refresh what the document changes
// (Kardex, vouchers, items, dashboard, reservations, projects, sales leads, parties); a settlement refreshes the bank
// accounts, treasury and the party card
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', async (orig) => ({
  ...(await orig<typeof import('../../components/ConfirmDialogHost')>()),
  confirmAction: () => Promise.resolve(true),
}));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out', 'documents.finalize'], isAdmin: false } }),
  useHasPermission: (key: string) => key === 'accounting.treasury' || key === 'documents.delete',
  useHasAnyPermission: (keys: readonly string[]) => keys.includes('accounting.treasury') || keys.includes('documents.delete'),
}));

interface Init { method?: string; body?: string }

const invoice = {
  id: 1, type: 'invoice', status: 'final', ref_number: 'INV-1', date: '2026-10-01', currency: 'IRR', buyer_name: 'نگار کریمی',
  itemsCount: 1, totalQuantity: 1, totalAmount: 1_000_000, payableAmount: 1_000_000, paidAmount: 0, remainingAmount: 1_000_000,
  settlementStatus: 'unpaid',
};

function server() {
  fetchJson.mockImplementation((url: string, init?: Init) => {
    const method = init?.method ?? 'GET';
    if (url.startsWith('/documents?')) return Promise.resolve({ data: [invoice], total: 1, page: 1, totalPages: 1 });
    if (url === '/documents/1' && method === 'DELETE') return Promise.resolve({ success: true });
    if (url === '/accounting/bank-accounts/options') return Promise.resolve([{ id: 7, title: 'بانک ملت', type: 'bank', currency: 'IRR', code: '1101', hasLedgerAccount: true }]);
    if (url === '/accounting/treasury' && method === 'POST') return Promise.resolve({ success: true });
    if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
    if (url.startsWith('/documents/next-ref?type=')) return Promise.resolve({ nextRef: 'RT-1001' });
    if (url === '/documents/by-ref/INV-1?type=invoice') {
      return Promise.resolve({
        id: 1, buyer_name: 'نگار کریمی', currency: 'IRR',
        items: [{ item_id: 5, name: 'گردنبند نقره', code: 'P-5', unit: 'عدد', quantity: 1, unit_price: 1000 }],
      });
    }
    if (url === '/documents' && method === 'POST') return Promise.resolve({ success: true, docId: 10 });
    if (url.startsWith('/items/options') || url === '/customers?limit=1000') return Promise.resolve({ data: [] });
    return Promise.resolve([]);
  });
}

// what a document changes, cached by other pages
const DOCUMENT_PAGES: QueryKey[] = [
  QUERY_KEYS.items.list({}), QUERY_KEYS.transactions.list({}), ['accounting', 'vouchers'], QUERY_KEYS.dashboard.general(),
  QUERY_KEYS.crm.leads({}), QUERY_KEYS.inventory.reservedItems(), QUERY_KEYS.projects.list(), QUERY_KEYS.customers.list({}),
];
const SETTLEMENT_PAGES: QueryKey[] = [
  QUERY_KEYS.accounting.bankAccounts(), QUERY_KEYS.accounting.treasuryTransactions(), QUERY_KEYS.dashboard.general(), QUERY_KEYS.customers.list({}),
];

// a key counts as refreshed when it was invalidated (an active query refetches at once and clears the flag, so every
// invalidation is recorded)
const invalidatedKeys = new WeakMap<QueryClient, QueryKey[]>();
function newClient(keys: QueryKey[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  keys.forEach(key => client.setQueryData(key, { data: [] }));
  const seen: QueryKey[] = [];
  invalidatedKeys.set(client, seen);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters, options) => {
    client.getQueryCache().findAll(filters).forEach(query => seen.push(query.queryKey));
    return invalidate(filters, options);
  }) as typeof client.invalidateQueries;
  return client;
}

function renderList(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <SearchProvider>
        <InvoicesListPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

const stale = (client: QueryClient, keys: QueryKey[]) => {
  const seen = (invalidatedKeys.get(client) ?? []).map(key => JSON.stringify(key));
  return keys.map(key => JSON.stringify(key)).filter(key => !seen.includes(key));
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('lists refreshed after a document change (TD-796)', () => {
  it('voiding a document from the list refreshes items, Kardex, vouchers, dashboard, sales leads, reservations, projects and parties', async () => {
    server();
    const client = newClient(DOCUMENT_PAGES);
    renderList(client);
    const row = (await screen.findByText('INV-۱')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTitle('عملیات سند'));
    fireEvent.click(await screen.findByText('ابطال / حذف سند'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/documents/1', { method: 'DELETE' }));
    await waitFor(() => expect(stale(client, DOCUMENT_PAGES)).toEqual([]));
  });

  it('a settlement refreshes the bank accounts, treasury, dashboard and the party card', async () => {
    server();
    const client = newClient(SETTLEMENT_PAGES);
    renderList(client);
    fireEvent.click(within((await screen.findByText('INV-۱')).closest('tr') as HTMLElement).getByText('تسویه سریع'));
    await waitFor(() => expect(screen.getByDisplayValue(/بانک ملت/)).toBeTruthy());
    fireEvent.click(screen.getByText('تایید و ثبت تسویه'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/accounting/treasury', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(stale(client, SETTLEMENT_PAGES)).toEqual([]));
  });

  it('a stock document saved from the stock page refreshes the same lists as an invoice', async () => {
    server();
    const client = newClient(DOCUMENT_PAGES);
    const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };
    render(
      <QueryClientProvider client={client}>
        <DocumentsPage user={user} />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByDisplayValue('رسید خرید مواد اولیه / کالا (فاکتور خرید)'), { target: { value: 'return' } });
    fireEvent.change(screen.getByPlaceholderText('مثال: 1005'), { target: { value: 'INV-1' } });
    fireEvent.click(screen.getByText('جستجو'));
    expect(await screen.findByText('گردنبند نقره')).toBeTruthy();
    const submit = screen.getAllByRole('button').find(b => b.textContent?.includes('ثبت نهایی'))!;
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/documents', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(stale(client, DOCUMENT_PAGES)).toEqual([]));
  });
});
