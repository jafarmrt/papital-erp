import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { User } from '../../types';

// صفحه صدور فاکتور با React Query: ثبت فاکتور/پیش‌فاکتور کش صفحات دیگر را باطل می‌کند و بستن صفحه خواندنی‌های در جریان را لغو می‌کند
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface RequestInitLike { method?: string; body?: string; signal?: AbortSignal }

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر تست', role: 'admin' };
const warehouse = { id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 };
const draft = {
  docType: 'invoice',
  status: 'proforma',
  currency: 'IRR',
  buyerName: 'مشتری تست',
  buyerCity: 'تهران',
  docItems: [{ item: { id: 3, type: 'product', code: 'P-3', name: 'گردنبند نقره', unit: 'عدد', current_stock: 5 }, quantity: 2, unitPrice: 1000, discount: 0 }],
};
const savedDoc = {
  id: 11, type: 'invoice', status: 'proforma', ref_number: 'INV-1001', date: '2026-10-03', buyer_name: 'مشتری تست', currency: 'IRR',
  items: [{ item_name: 'گردنبند نقره', quantity: 2, unit_price: 1000, discount: 0 }],
};

function saveFlowResponse(url: string, init?: RequestInitLike): unknown {
  const method = init?.method ?? 'GET';
  if (url === '/warehouses') return [warehouse];
  if (url === '/customers/options') return { data: [] };
  if (url === '/documents?status=proforma&types=invoice,proforma&page=1&limit=20') return { data: [] };
  if (url === '/documents/next-ref?type=invoice') return { nextRef: 'INV-1001' };
  if (url === '/drafts/invoice?draftKey=new_invoice' && method === 'GET') return { draft: { payload: draft, isDeleted: 0, updatedAt: '2026-10-03T08:00:00Z' } };
  if (url === '/documents' && method === 'POST') return { success: true, docId: 11 };
  if (url === '/documents/11') return savedDoc;
  return [];
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateInvoicePage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('CreateInvoicePage — React Query cache', () => {
  it('invalidates the invoice/document lists, open proformas, items and stats after a proforma is saved', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(saveFlowResponse(url, init)));
    const client = newClient();
    // داده کش‌شده صفحات دیگر (فهرست فاکتورها، کالاها، داشبورد، رزروها، کاردکس) که ثبت فاکتور باید تازه‌شان کند
    const otherPages = [
      QUERY_KEYS.documents.list({ page: 1, limit: 50 }),
      QUERY_KEYS.items.list({ type: 'product', page: 1, limit: 50, search: '' }),
      QUERY_KEYS.dashboard.general(),
      ['inventory', 'reserved-items'],
      QUERY_KEYS.transactions.list({}),
    ];
    otherPages.forEach(key => client.setQueryData(key, { data: [] }));

    renderPage(client);
    fireEvent.click(await screen.findByText('بازیابی پیش‌نویس'));
    expect(await screen.findByText('گردنبند نقره')).toBeTruthy();
    await waitFor(() => expect(screen.getByDisplayValue('INV-1001')).toBeTruthy());
    // v9.0.327 (TD-783): the invoice number only comes from the server series
    expect((screen.getByDisplayValue('INV-1001') as HTMLInputElement).readOnly).toBe(true);
    otherPages.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'ثبت و صدور فاکتور' }));
    expect(await screen.findByText('بازگشت به فرم ثبت')).toBeTruthy();

    const post = fetchJson.mock.calls.find(([url, init]) => url === '/documents' && init?.method === 'POST');
    const body = JSON.parse(String(post?.[1].body));
    expect(body).toMatchObject({ docType: 'invoice', status: 'proforma', refNumber: 'auto', location: 'WH1', buyer_name: 'مشتری تست', inOut: 'out' });
    // v9.0.39 (TD-446): گردش کار تأیید پیش‌فاکتور را سرور در تراکنش ثبت شروع می‌کند، نه مرورگر
    expect(fetchJson).not.toHaveBeenCalledWith('/workflow/start', expect.anything());

    otherPages.forEach(key => expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true));
    // پیش‌فاکتورهای باز و شماره بعدی همین صفحه هم دوباره خوانده می‌شوند
    await waitFor(() => {
      expect(fetchJson.mock.calls.filter(([url]) => url === '/documents?status=proforma&types=invoice,proforma&page=1&limit=20').length).toBeGreaterThanOrEqual(2);
      expect(fetchJson.mock.calls.filter(([url]) => url === '/documents/next-ref?type=invoice').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('cancels in-flight reads (reference lists and the proforma being loaded for editing) on unmount', async () => {
    const signals = new Map<string, AbortSignal | undefined>();
    const hanging = new Set(['/warehouses', '/customers/options', '/documents/next-ref?type=invoice', '/documents/5']);
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      if (hanging.has(url)) {
        signals.set(url, init?.signal);
        return new Promise(() => undefined);
      }
      if (url === '/documents?status=proforma&types=invoice,proforma&page=1&limit=20') {
        return Promise.resolve({ data: [{ id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01', buyer_name: 'مشتری باز' }] });
      }
      return Promise.resolve([]);
    });

    const { unmount } = renderPage(newClient());
    fireEvent.click(await screen.findByText('ویرایش'));
    await waitFor(() => expect(signals.has('/documents/5')).toBe(true));

    unmount();

    hanging.forEach(url => expect(signals.get(url)?.aborted, url).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
