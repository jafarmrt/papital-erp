import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import type { User } from '../../types';

// TD-794 (B08-25): شکست بارگذاری نسخه چاپی پس از ثبت موفق، ثبت را شکست نمی‌دهد؛ فرم پاک می‌شود و کلیک دوم سند دوم نمی‌سازد
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface Init { method?: string; body?: string; signal?: AbortSignal }

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر تست', role: 'admin' };
const draft = {
  docType: 'invoice', status: 'proforma', currency: 'IRR', buyerName: 'سارا احمدی', buyerCity: 'اصفهان',
  docItems: [{ item: { id: 3, type: 'product', code: 'P-3', name: 'گردنبند نقره', unit: 'عدد', current_stock: 5 }, quantity: 2, unitPrice: 1000, discount: 0 }],
};
const NETWORK_FAILURE = 'Network request failed';
const printCopyFailed = 'سند ثبت شد، اما نسخه چاپی آن بارگذاری نشد. آن را از «فهرست اسناد و فاکتورها» چاپ کنید.';

function server() {
  fetchJson.mockImplementation((url: string, init?: Init) => {
    const method = init?.method ?? 'GET';
    if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
    if (url.startsWith('/documents?status=proforma')) return Promise.resolve({ data: [], total: 0, page: 1, limit: 20 });
    if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
    if (url.startsWith('/drafts/invoice') && method === 'GET') {
      return Promise.resolve({ draft: { payload: draft, isDeleted: 0, updatedAt: '2026-10-03T08:00:00Z' } });
    }
    if (url === '/documents' && method === 'POST') return Promise.resolve({ success: true, docId: 11 });
    // سند ثبت شده، اما خواندن آن برای چاپ به شبکه نمی‌رسد
    if (url === '/documents/11') return Promise.reject(new Error(NETWORK_FAILURE));
    return Promise.resolve([]);
  });
}

const posts = () => fetchJson.mock.calls.filter(([u, i]) => u === '/documents' && (i as Init | undefined)?.method === 'POST');

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('CreateInvoicePage — a failed print copy after a saved document (TD-794)', () => {
  it('the save succeeds, the form is cleared and a second click sends no second document', async () => {
    server();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CreateInvoicePage user={admin} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('بازیابی پیش‌نویس'));
    await screen.findByText('گردنبند نقره');
    fireEvent.click(screen.getByRole('button', { name: 'ثبت و صدور فاکتور' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(printCopyFailed, { duration: 6000 }));
    expect(toast.success).toHaveBeenCalledWith('پیش‌فاکتور با موفقیت ثبت شد و وارد چرخه تاییدات گردید!');
    // خطای بارگذاری چاپ خطای ثبت نیست
    expect(toast.error).not.toHaveBeenCalledWith(NETWORK_FAILURE, { duration: 5000 });
    await waitFor(() => expect(screen.queryByText('گردنبند نقره')).toBeNull());
    expect(screen.queryByDisplayValue('سارا احمدی')).toBeNull();
    expect(fetchJson).toHaveBeenCalledWith('/drafts/invoice?draftKey=new_invoice', { method: 'DELETE' });

    fireEvent.click(screen.getByRole('button', { name: 'ثبت و صدور فاکتور' }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(posts()).toHaveLength(1);
  });
});
