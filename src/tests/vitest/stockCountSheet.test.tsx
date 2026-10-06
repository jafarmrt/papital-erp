import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InventoryAuditPage from '../../pages/InventoryAuditPage';
import type { User } from '../../types';

// Package 6 stock-count sheet (TD-480 / B06-01, TD-484 / B06-05). The server answers follow the real route: the sheet
// location is a warehouse code or name (empty = default warehouse), the stock is read by the resolved CODE, and a
// posted count whose shown book stock is stale gets 409 AUDIT_BOOK_STOCK_CHANGED.
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

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر', role: 'admin' };
const WAREHOUSES = [
  { id: 1, code: 'main', name: 'انبار مرکزی', is_active: 1 },
  { id: 2, code: 'shop', name: 'فروشگاه', is_active: 1 },
];
let stock: Record<string, number> = {};
let staleOnce = false;
const posted: Array<Record<string, unknown>> = [];

function resolveWarehouse(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return WAREHOUSES[0].code;
  return WAREHOUSES.find(w => w.code.toLowerCase() === key || w.name.toLowerCase() === key)?.code ?? null;
}

function server(url: string, init?: RequestInitLike): Promise<unknown> {
  const method = init?.method ?? 'GET';
  if (url === '/warehouses') return Promise.resolve(WAREHOUSES);
  if (url === '/documents/next-ref?type=audit') return Promise.resolve({ nextRef: 'AUD-7' });
  if (url.startsWith('/documents/audit-items')) {
    const raw = decodeURIComponent(url.split('location=')[1] ?? '');
    const code = resolveWarehouse(raw);
    if (!code) return Promise.reject(Object.assign(new Error(`انبار «${raw}» تعریف نشده یا غیرفعال است.`), { code: 'VALIDATION_ERROR', status: 422 }));
    return Promise.resolve([{ id: 501, code: 'A-501', name: 'سنگ فیروزه', unit: 'عدد', category: 'سنگ', type: 'raw_material', system_stock: stock[code] ?? 0, physical_stock: '', location: code }]);
  }
  if (url === '/documents' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    posted.push(body);
    if (staleOnce) {
      staleOnce = false;
      stock = { ...stock, main: 12 };
      return Promise.reject(Object.assign(new Error('موجودی دفتری این کالاها پس از بارگذاری برگه انبارگردانی تغییر کرده است: «سنگ فیروزه» (A-501): برگه 10، اکنون 12.'), { code: 'AUDIT_BOOK_STOCK_CHANGED', status: 409 }));
    }
    return Promise.resolve({ success: true, docId: 90 });
  }
  if (url === '/inventory/integrity-audit') return Promise.resolve({ summary: {}, audits: [], warehouses: [] });
  if (url.startsWith('/items')) return Promise.resolve({ data: [] });
  return Promise.resolve([]);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InventoryAuditPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const systemCell = () => screen.getByText('A-501').closest('tr')!.querySelectorAll('td')[4];
const countInput = () => screen.getByPlaceholderText('عدد شمارش شده...') as HTMLInputElement;
const locationSelect = () => screen.getByRole('combobox', { name: 'موقعیت انبار جهت شمارش:' }) as HTMLSelectElement;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  posted.length = 0;
  staleOnce = false;
});

describe('stock-count sheet (TD-480)', () => {
  it('lists warehouses by code, shows the real book stock of the default warehouse and posts it with «copy + submit»', async () => {
    stock = { main: 10, shop: 3 };
    fetchJson.mockImplementation(server);
    renderPage();
    await screen.findByText('A-501');
    await waitFor(() => expect(systemCell().textContent).toBe('۱۰'));
    const values = within(locationSelect()).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
    expect(values).toEqual(['main', 'shop']);
    expect(locationSelect().value).toBe('main');

    fireEvent.click(screen.getByRole('button', { name: 'کپی موجودی اسمی به موجودی فیزیکی برای تمام اقلام' }));
    fireEvent.click(screen.getByRole('button', { name: /ثبت نهایی سند انبارگردانی/ }));
    expect(await screen.findByText(/در موقعیت «انبار مرکزی»/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ثبت قطعی انبارگردانی' }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({
      location: 'main',
      notes: 'ثبت انبارگردانی در موقعیت انبار مرکزی',
      items: [{ itemId: 501, system_stock: 10, physical_stock: 10, quantity: 10, location: 'main' }],
    });
  });

  it('a stale book stock (409) closes the summary, shows the server message and reloads the sheet with the counts kept', async () => {
    stock = { main: 10, shop: 3 };
    staleOnce = true;
    fetchJson.mockImplementation(server);
    renderPage();
    await screen.findByText('A-501');
    await waitFor(() => expect(systemCell().textContent).toBe('۱۰'));
    fireEvent.change(countInput(), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /ثبت نهایی سند انبارگردانی/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'ثبت قطعی انبارگردانی' }));

    expect(await screen.findByText(/پس از بارگذاری برگه انبارگردانی تغییر کرده است/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ثبت قطعی انبارگردانی' })).toBeNull();
    await waitFor(() => expect(systemCell().textContent).toBe('۱۲'));
    expect(countInput().value).toBe('9');
  });
});

describe('stock-count sheet warehouse change (TD-484)', () => {
  it('switching the warehouse after counting asks first; cancel keeps the sheet, confirm clears the counts', async () => {
    stock = { main: 10, shop: 3 };
    fetchJson.mockImplementation(server);
    renderPage();
    await screen.findByText('A-501');
    fireEvent.change(countInput(), { target: { value: '7' } });

    fireEvent.change(locationSelect(), { target: { value: 'shop' } });
    expect(await screen.findByText(/شمارش‌های واردشده برای «انبار مرکزی» پاک می‌شوند/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ماندن در همین انبار' }));
    expect(locationSelect().value).toBe('main');
    expect(countInput().value).toBe('7');

    fireEvent.change(locationSelect(), { target: { value: 'shop' } });
    fireEvent.click(await screen.findByRole('button', { name: 'پاک کردن و تغییر انبار' }));
    await waitFor(() => expect(locationSelect().value).toBe('shop'));
    await waitFor(() => expect(systemCell().textContent).toBe('۳'));
    expect(countInput().value).toBe('');
    expect((screen.getByRole('button', { name: /ثبت نهایی سند انبارگردانی/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switching the warehouse before any count needs no confirmation', async () => {
    stock = { main: 10, shop: 3 };
    fetchJson.mockImplementation(server);
    renderPage();
    await screen.findByText('A-501');
    fireEvent.change(locationSelect(), { target: { value: 'shop' } });
    await waitFor(() => expect(systemCell().textContent).toBe('۳'));
    expect(screen.queryByRole('button', { name: 'پاک کردن و تغییر انبار' })).toBeNull();
  });
});
