import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import type { User } from '../../types';

// TD-792 (B08-23): پیش‌فاکتورهای باز فرم فاکتور فروش فقط سندهای فروش‌اند و صفحه‌به‌صفحه خوانده می‌شوند
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر تست', role: 'admin' };
const proformaRows = (page: number) => Array.from({ length: page < 3 ? 20 : 5 }, (_, i) => ({
  id: page * 100 + i, type: 'invoice', status: 'proforma', ref_number: `PF-${page}-${i}`, date: '2026-10-01 10:00:00', buyer_name: 'مشتری',
}));

function server() {
  fetchJson.mockImplementation((url: string) => {
    if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
    if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
    const paged = /^\/documents\?status=proforma&types=invoice,proforma&page=(\d+)&limit=20$/.exec(url);
    if (paged) {
      const page = Number(paged[1]);
      return Promise.resolve({ data: proformaRows(page), total: 45, page, limit: 20 });
    }
    if (url.startsWith('/documents?status=proforma')) return Promise.resolve({ data: [{ id: 6, type: 'receipt', status: 'proforma', ref_number: 'RCP-6', date: '2026-10-02', buyer_name: 'تامین سنگ' }] });
    return Promise.resolve([]);
  });
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CreateInvoicePage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('CreateInvoicePage — open proformas are the sales proformas, page by page (TD-792)', () => {
  it('asks only for invoice and proforma types, shows the whole count in Persian digits and pages through it', async () => {
    server();
    renderPage();
    expect(await screen.findByText('PF-1-0')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/documents?status=proforma&types=invoice,proforma&page=1&limit=20', expect.anything());
    expect(fetchJson.mock.calls.some(([url]) => String(url).startsWith('/documents?status=proforma') && !String(url).includes('types=invoice,proforma'))).toBe(false);
    expect(screen.queryByText('RCP-6')).toBeNull();
    expect(screen.getByText('⏳ پیش فاکتورهای باز (۴۵)')).toBeTruthy();
    expect(screen.getByText('صفحه ۱ از ۳')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(await screen.findByText('PF-2-0')).toBeTruthy();
    expect(screen.getByText('صفحه ۲ از ۳')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(await screen.findByText('PF-3-4')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'بعدی' }) as HTMLButtonElement).disabled).toBe(true));
  });
});
