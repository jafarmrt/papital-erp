import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InventoryAuditPage from '../../pages/InventoryAuditPage';
import { DOCUMENT_LIST_PAGE_SIZE, documentListPage, typedDocumentListUrl } from '../../lib/documents/documentListPage';
import type { User } from '../../types';

// v9.0.290 (TD-787): GET /documents always answers one page, so the stock count history and transfer tabs page through it
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const keeper: User = { id: 2, username: 'keeper', full_name: 'انباردار تست', role: 'admin' };
const TOTAL = 120;

function pageOf(type: string, page: number) {
  const first = (page - 1) * DOCUMENT_LIST_PAGE_SIZE;
  const count = Math.max(0, Math.min(DOCUMENT_LIST_PAGE_SIZE, TOTAL - first));
  const prefix = type === 'audit' ? 'AUD' : 'TRF';
  return {
    data: Array.from({ length: count }, (_, i) => ({ id: first + i + 1, refNumber: `${prefix}-${first + i + 1}`, date: '2026-10-01', location: 'WH1', user: 'انباردار' })),
    total: TOTAL,
    page,
    limit: DOCUMENT_LIST_PAGE_SIZE,
    totalPages: Math.ceil(TOTAL / DOCUMENT_LIST_PAGE_SIZE),
  };
}

function respond(url: string): unknown {
  if (url === '/inventory/integrity-audit') return { summary: { discrepancyItems: 0 }, audits: [], warehouses: [] };
  if (url === '/items/options') return { data: [] };
  if (url === '/documents/next-ref?type=audit') return { nextRef: 'AUD-2001' };
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  for (const type of ['audit', 'transfer']) {
    for (let page = 1; page <= 3; page++) if (url === typedDocumentListUrl(type, page)) return pageOf(type, page);
  }
  return [];
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InventoryAuditPage user={keeper} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// distinct list URLs asked so far (opening a tab may refetch the same page once the warehouse list arrives)
const listCalls = () => [...new Set(fetchJson.mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('/documents?')))];

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('document list page helpers (TD-787)', () => {
  it('builds a page URL with the page size and reads a paged or legacy array response', () => {
    expect(typedDocumentListUrl('audit', 2)).toBe('/documents?type=audit&page=2&limit=50');
    expect(typedDocumentListUrl('transfer', 0)).toBe('/documents?type=transfer&page=1&limit=50');
    expect(documentListPage({ data: [{ id: 1 }], total: 75, totalPages: 2 })).toEqual({ rows: [{ id: 1 }], total: 75, totalPages: 2 });
    expect(documentListPage([{ id: 1 }, { id: 2 }])).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 2, totalPages: 1 });
    expect(documentListPage(null)).toEqual({ rows: [], total: 0, totalPages: 1 });
  });
});

describe('InventoryAuditPage history tabs page through GET /documents (TD-787)', () => {
  it('stock count history asks for one page, shows the total and moves to the next page with continued row numbers', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'سوابق دوره‌ها' }));

    expect(await screen.findByText('AUD-1')).toBeTruthy();
    expect(listCalls()).toEqual([typedDocumentListUrl('audit', 1)]);
    expect(screen.getByText(/تعداد اسناد: ۱۲۰/)).toBeTruthy();
    expect(screen.getByText(/نمایش ۵۰ از ۱۲۰ سند انبارگردانی/)).toBeTruthy();

    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    expect(await screen.findByText('AUD-51')).toBeTruthy();
    expect(listCalls()).toContain(typedDocumentListUrl('audit', 2));
    expect(screen.getByText('۵۱')).toBeTruthy();
    expect(screen.queryByText('AUD-1')).toBeNull();
  });

  it('transfer tab asks for one page and pages to the last one', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'حواله‌های انتقال' }));

    expect(await screen.findByText('TRF-1')).toBeTruthy();
    expect(listCalls()).toEqual([typedDocumentListUrl('transfer', 1)]);
    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    expect(await screen.findByText('TRF-51')).toBeTruthy();
    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    expect(await screen.findByText('TRF-101')).toBeTruthy();
    await waitFor(() => expect((screen.getByTitle('صفحه بعدی') as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/نمایش ۲۰ از ۱۲۰ حواله انتقال/)).toBeTruthy();
  });
});
