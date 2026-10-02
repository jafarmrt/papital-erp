import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';

// TD-235 (بند ۵ و ۶): درخواست اضافه با صفحه قبلی هنگام تغییر فیلتر، و جزئیات سند اشتباه هنگام باز کردن سریع دو سند.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const docA = { id: 1, type: 'invoice', status: 'final', ref_number: 'INV-1001', currency: 'IRR', buyer_name: 'الف', totalAmount: 1000 };
const docB = { id: 2, type: 'invoice', status: 'final', ref_number: 'INV-1002', currency: 'IRR', buyer_name: 'ب', totalAmount: 2000 };
const fullA = { ...docA, items: [{ id: 11, item_id: 5, code: 'P-5', name: 'گردنبند الف', quantity: 1, unit_price: 1000, discount: 0 }] };
const fullB = { ...docB, items: [{ id: 21, item_id: 6, code: 'P-6', name: 'دستبند ب', quantity: 1, unit_price: 2000, discount: 0 }] };

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchProvider>
        <InvoicesListPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

function rowOf(refText: string): HTMLElement {
  const row = screen.getByText(refText).closest('tr');
  if (!row) throw new Error(`row ${refText} not found`);
  return row as HTMLElement;
}

function documentListCalls(): string[] {
  return fetchJson.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/documents?'));
}

describe('invoices list — no stale requests (TD-235 parts 5 and 6)', () => {
  it('a filter change on page 2 asks the server for page 1 only', async () => {
    fetchJson.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/documents?') ? { data: [docA, docB], total: 120, page: 1, totalPages: 3 } : []));
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    await waitFor(() => expect(documentListCalls()).toContain('/documents?page=2&limit=50'));
    await screen.findByText('۲ / ۳');

    fireEvent.change(screen.getByDisplayValue('همه انواع سند (خرید، فروش، انبار)'), { target: { value: 'invoice' } });
    await waitFor(() => expect(documentListCalls()).toContain('/documents?type=invoice&page=1&limit=50'));
    expect(documentListCalls()).not.toContain('/documents?type=invoice&page=2&limit=50');
    expect(await screen.findByText('۱ / ۳')).toBeTruthy();
  });

  it('shows the details of the document opened last, even when an earlier load finishes later', async () => {
    let resolveA: (v: unknown) => void = () => undefined;
    fetchJson.mockImplementation((url: string) => {
      if (url.startsWith('/documents?')) return Promise.resolve({ data: [docA, docB], total: 2, page: 1, totalPages: 1 });
      if (url === '/documents/1') return new Promise(resolve => { resolveA = resolve; });
      if (url === '/documents/2') return Promise.resolve(fullB);
      return Promise.resolve({ instance: null });
    });
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    fireEvent.click(within(rowOf('INV-۱۰۰۱')).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    fireEvent.click(screen.getByText('بستن پنجره'));
    fireEvent.click(within(rowOf('INV-۱۰۰۲')).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    expect(await screen.findByText('دستبند ب')).toBeTruthy();

    await act(async () => { resolveA(fullA); await Promise.resolve(); });
    expect(screen.queryByText('گردنبند الف')).toBeNull();
    expect(screen.getByText('دستبند ب')).toBeTruthy();
  });

  it('a closed details window stays closed when its load finishes afterwards', async () => {
    let resolveA: (v: unknown) => void = () => undefined;
    fetchJson.mockImplementation((url: string) => {
      if (url.startsWith('/documents?')) return Promise.resolve({ data: [docA, docB], total: 2, page: 1, totalPages: 1 });
      if (url === '/documents/1') return new Promise(resolve => { resolveA = resolve; });
      return Promise.resolve({ instance: null });
    });
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    fireEvent.click(within(rowOf('INV-۱۰۰۱')).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    fireEvent.click(screen.getByText('بستن پنجره'));

    await act(async () => { resolveA(fullA); await Promise.resolve(); });
    expect(screen.queryByText('گردنبند الف')).toBeNull();
    expect(screen.queryByText('بستن پنجره')).toBeNull();
  });
});
