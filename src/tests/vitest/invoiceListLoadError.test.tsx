import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';

// v9.0.293 (TD-797, finding B08-28): a failed documents list read shows the server's message and a retry button, never the
// «no document matches the filters» empty state
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const EMPTY = 'سندی مطابق شرط‌های جستجو یافت نشد.';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SearchProvider>
        <InvoicesListPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('documents list load error (TD-797)', () => {
  it('a refused list shows the server message and loads again on retry', async () => {
    const reason = 'دسترسی غیرمجاز برای این عملیات';
    let refuse = true;
    fetchJson.mockImplementation((url: string) => {
      if (url.startsWith('/documents?')) {
        return refuse
          ? Promise.reject(Object.assign(new Error(reason), { status: 403 }))
          : Promise.resolve({ data: [{ id: 1, type: 'invoice', status: 'final', ref_number: 'INV-1', date: '2026-10-01', currency: 'IRR', totalAmount: 100 }], total: 1, page: 1, totalPages: 1 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.getByText('فهرست اسناد دریافت نشد')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();

    refuse = false;
    fireEvent.click(screen.getByText('تلاش دوباره'));
    expect(await screen.findByText('INV-۱')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(reason)).toBeNull());
  });

  it('an empty answer still shows the empty state', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url.startsWith('/documents?') ? { data: [], total: 0, page: 1, totalPages: 1 } : []));
    renderPage();
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText('فهرست اسناد دریافت نشد')).toBeNull();
  });
});
