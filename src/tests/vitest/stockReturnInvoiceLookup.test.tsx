import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import DocumentsPage from '../../pages/DocumentsPage';
import type { User } from '../../types';

// v9.0.284 (TD-782، یافته B08-13 و مشاهده ۳.۲-۳ بسته ۸): فاکتور مرجع برگشت با سال مالی. شماره‌ای که در دو سال فاکتور قطعی
// دارد سال را می‌پرسد و فاکتور سال انتخاب‌شده بار می‌شود؛ پیام هر خطا همان خطای رخ‌داده است. پیش‌تر فاکتور سال جاری همیشه
// برنده بود و هر خطایی، حتی ۴۰۳ یا قطع شبکه، «فاکتوری با این شماره یافت نشد» می‌شد.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out', 'documents.finalize'], isAdmin: false } }),
  useHasPermission: () => false,
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };

const AMBIGUOUS = 'شماره «INV-7» در چند سال مالی فاکتور فروش قطعی دارد (۱۴۰۵، ۱۴۰۴)؛ سال مالی را انتخاب کنید.';
const FORBIDDEN = 'دیدن این سند مجوز بخش اسناد را می‌خواهد؛ مجوز انبارگردانی فقط سندهای شمارش و انتقال را نشان می‌دهد.';
const apiError = (status: number, code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { name: 'ApiError', status, code, details });

const lastYearInvoice = {
  id: 50, refFiscalYear: 1404, buyer_name: 'مشتری پارسال', currency: 'IRR', exchangeRate: null,
  items: [{ item_id: 5, name: 'گوشواره میخی', code: 'P-5', unit: 'عدد', quantity: 2, unit_price: 100000, discount: 0 }],
};

function apiResponse(url: string, init?: { method?: string }): Promise<unknown> {
  if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
  if (url.startsWith('/documents/next-ref?type=')) return Promise.resolve({ nextRef: `${url.split('=')[1].toUpperCase()}-1` });
  if (url === '/documents/by-ref/INV-7?type=invoice') {
    return Promise.reject(apiError(409, 'DOCUMENT_REF_AMBIGUOUS', AMBIGUOUS, {
      ref: 'INV-7',
      candidates: [
        { id: 51, refFiscalYear: 1405, date: '2026-09-01 10:00:00', buyerName: 'مشتری امسال' },
        { id: 50, refFiscalYear: 1404, date: '2025-09-01 10:00:00', buyerName: 'مشتری پارسال' },
      ],
    }));
  }
  if (url === '/documents/by-ref/INV-7?type=invoice&fiscalYear=1404') return Promise.resolve(lastYearInvoice);
  if (url === '/documents/by-ref/INV-403?type=invoice') return Promise.reject(apiError(403, 'DOCUMENT_TYPE_NOT_READABLE', FORBIDDEN));
  if (url === '/documents/by-ref/INV-NET?type=invoice') return Promise.reject(new TypeError('Failed to fetch'));
  if (url === '/documents' && init?.method === 'POST') return Promise.resolve({ docId: 90 });
  if (url.startsWith('/items/options') || url === '/customers?limit=1000') return Promise.resolve({ data: [] });
  return Promise.resolve([]);
}

beforeEach(() => {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => apiResponse(url, init));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

async function searchReturnInvoice(ref: string): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DocumentsPage user={user} />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue('RECEIPT-1');
  fireEvent.change(screen.getByDisplayValue('رسید خرید مواد اولیه / کالا (فاکتور خرید)'), { target: { value: 'return' } });
  fireEvent.change(screen.getByPlaceholderText('مثال: 1005'), { target: { value: ref } });
  fireEvent.click(screen.getByText('جستجو'));
}

describe('the reference invoice of a sales return by fiscal year (TD-782)', () => {
  it('a number used in two fiscal years asks for the year and loads the chosen year\'s invoice', async () => {
    await searchReturnInvoice('INV-7');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(AMBIGUOUS));
    const lastYear = await screen.findByRole('button', { name: /سال مالی ۱۴۰۴/ });
    expect(screen.getByRole('button', { name: /سال مالی ۱۴۰۵/ })).toBeTruthy();
    expect(screen.queryByText('گوشواره میخی')).toBeNull();

    fireEvent.click(lastYear);
    expect(await screen.findByText('گوشواره میخی')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/documents/by-ref/INV-7?type=invoice&fiscalYear=1404');
    expect(screen.queryByRole('button', { name: /سال مالی ۱۴۰۵/ })).toBeNull();

    const submit = screen.getAllByRole('button').find(b => b.textContent?.includes('ثبت نهایی'))!;
    await act(async () => { fireEvent.click(submit); });
    const post = await waitFor(() => {
      const call = fetchJson.mock.calls.find(c => c[0] === '/documents' && (c[1] as { method?: string })?.method === 'POST');
      if (!call) throw new Error('no POST /documents');
      return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
    });
    expect(post).toMatchObject({ docType: 'return', returnOfDocumentId: 50 });
    expect(String(post.notes)).toContain('سال مالی ۱۴۰۴');
  });

  it('a refused lookup shows the server message, not "no invoice with this number"', async () => {
    await searchReturnInvoice('INV-403');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FORBIDDEN));
    expect(screen.queryByRole('group', { name: 'سال مالی فاکتور مرجع' })).toBeNull();
  });

  it('a network failure says the lookup did not run', async () => {
    await searchReturnInvoice('INV-NET');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('جست‌وجوی فاکتور مرجع انجام نشد؛ اتصال را بررسی کنید و دوباره جست‌وجو کنید.'));
  });
});
