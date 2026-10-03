import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InventoryAuditPage from '../../pages/InventoryAuditPage';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { User } from '../../types';

// صفحه انبارگردانی با React Query: ثبت سند انبارگردانی کش صفحات دیگری که موجودی نشان می‌دهند را باطل می‌کند
// و بستن صفحه همه خواندنی‌های در جریان (از جمله جزئیات سند در حال بارگذاری) را لغو می‌کند
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

const keeper: User = { id: 2, username: 'keeper', full_name: 'انباردار تست', role: 'admin' };
const LOCATION = 'انبار مرکزی';
const AUDIT_ITEMS_URL = `/documents/audit-items?location=${encodeURIComponent(LOCATION)}`;
const auditItem = { id: 7, code: 'R-7', name: 'سیم نقره', category: 'سیم', unit: 'متر', system_stock: 10 };

function baseResponse(url: string, init?: RequestInitLike): unknown {
  const method = init?.method ?? 'GET';
  if (url === '/inventory/integrity-audit') return { report: { summary: { discrepancyItems: 0 }, items: [] } };
  if (url === '/items?limit=1000') return { data: [] };
  if (url === '/documents/next-ref?type=audit') return { nextRef: 'AUD-2001' };
  if (url === AUDIT_ITEMS_URL) return [auditItem];
  if (url === '/warehouses') return [{ id: 1, name: LOCATION, code: 'WH1', is_active: 1 }];
  if (url === '/documents' && method === 'POST') return { success: true, docId: 50 };
  return [];
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InventoryAuditPage user={keeper} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const callsTo = (url: string) => fetchJson.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === 'GET').length;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('InventoryAuditPage — React Query cache', () => {
  it('invalidates stock lists, Kardex, warehouse stats, documents and reservations after a stock count is finalized', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(baseResponse(url, init)));
    const client = newClient();
    // داده کش‌شده صفحات دیگر (کالاها، کاردکس، آمار انبار، فهرست اسناد، رزروها، حواله‌ها) که انبارگردانی باید تازه‌شان کند
    const otherPages = [
      QUERY_KEYS.items.list({ type: 'raw_material', page: 1, limit: 50, search: '' }),
      QUERY_KEYS.transactions.list({}),
      QUERY_KEYS.dashboard.general(),
      QUERY_KEYS.dashboard.bi(),
      QUERY_KEYS.documents.list({ page: 1, limit: 50 }),
      QUERY_KEYS.inventory.reservedItems(),
      QUERY_KEYS.transfers.list(),
    ];
    otherPages.forEach(key => client.setQueryData(key, { data: [] }));

    renderPage(client);
    const input = await screen.findByPlaceholderText('عدد شمارش شده...');
    await waitFor(() => expect(screen.getByDisplayValue('AUD-2001')).toBeTruthy());
    otherPages.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
    const auditItemsBefore = callsTo(AUDIT_ITEMS_URL);
    const nextRefBefore = callsTo('/documents/next-ref?type=audit');

    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /ثبت نهایی سند انبارگردانی/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'ثبت قطعی انبارگردانی' }));
    expect(await screen.findByText('سند انبارگردانی با شماره AUD-2001 با موفقیت ثبت و موجودی انبار به‌روزرسانی شد.')).toBeTruthy();

    const post = fetchJson.mock.calls.find(([url, init]) => url === '/documents' && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1].body))).toMatchObject({
      docType: 'audit', refNumber: 'AUD-2001', location: LOCATION, user: 'انباردار تست', status: 'final',
      notes: `ثبت انبارگردانی در موقعیت ${LOCATION}`,
      items: [{ itemId: 7, system_stock: 10, physical_stock: 8, quantity: 8, location: LOCATION }],
    });

    otherPages.forEach(key => expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true));
    // اقلام شمارش و شماره بعدی همین صفحه دوباره خوانده می‌شوند و مقدار شمارش‌شده پاک می‌شود
    await waitFor(() => {
      expect(callsTo(AUDIT_ITEMS_URL)).toBeGreaterThan(auditItemsBefore);
      expect(callsTo('/documents/next-ref?type=audit')).toBeGreaterThan(nextRefBefore);
    });
    await waitFor(() => expect((screen.getByPlaceholderText('عدد شمارش شده...') as HTMLInputElement).value).toBe(''));
  });

  it('cancels in-flight reads (page data and the audit document being opened) on unmount', async () => {
    const signals = new Map<string, AbortSignal | undefined>();
    const hanging = new Set(['/inventory/integrity-audit', '/items?limit=1000', '/documents/next-ref?type=audit', '/warehouses', '/documents/9']);
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      if (hanging.has(url)) {
        signals.set(url, init?.signal);
        return new Promise(() => undefined);
      }
      if (url === '/documents?type=audit') {
        return Promise.resolve({ data: [{ id: 9, refNumber: 'AUD-9', date: '2026-10-01', location: LOCATION, user: 'انباردار' }] });
      }
      return Promise.resolve(baseResponse(url, init));
    });

    const { unmount } = renderPage(newClient());
    fireEvent.click(screen.getByRole('button', { name: 'سوابق دوره‌ها' }));
    fireEvent.click(await screen.findByRole('button', { name: 'مشاهده جزئیات' }));
    await waitFor(() => expect(signals.has('/documents/9')).toBe(true));
    expect(screen.getByText('در حال دریافت اطلاعات...')).toBeTruthy();

    unmount();

    hanging.forEach(url => expect(signals.get(url)?.aborted, url).toBe(true));
  });
});
