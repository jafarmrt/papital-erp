import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import DocumentsPage from '../../pages/DocumentsPage';
import { SearchableSelect } from '../../components/SearchableSelect';
import type { User } from '../../types';

// TD-234: باقی‌مانده‌های فرم «ورود و خروج به انبار».
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
// v9.0.241 (TD-791): نوع سند و دکمه ثبت با مجوز ثبت همان نوع؛ انباردار آزمون مجوزهای ثبت این صفحه را دارد
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out', 'documents.finalize'], isAdmin: false } }),
  useHasPermission: () => false,
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));
// تقویم شمسی در jsdom با یک input ساده جایگزین می‌شود تا تاریخ خالی شبیه‌سازی شود
vi.mock('react-multi-date-picker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string | null) => void }) => (
    <input aria-label="تاریخ سند" value={value} onChange={e => onChange(e.target.value || null)} />
  ),
}));

const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };
const RETURN_REF = 'INV/7 A';

function apiResponse(url: string, init?: { method?: string }): unknown {
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url === '/documents/next-ref?type=receipt') return { nextRef: 'RC-1001' };
  if (url === '/documents/next-ref?type=return') return { nextRef: 'RT-1001' };
  if (url === '/documents/next-ref?type=remittance') return { nextRef: 'RM-2001' };
  if (url === `/documents/by-ref/${encodeURIComponent(RETURN_REF)}?type=invoice`) {
    return {
      id: 9, buyer_name: 'نگار کریمی', currency: 'USD', exchangeRate: 600000,
      items: [{ item_id: 5, name: 'گردنبند نقره', code: 'P-5', unit: 'عدد', quantity: 1, unit_price: 1000 }],
    };
  }
  if (url === '/documents' && init?.method === 'POST') return { id: 10 };
  if (url.startsWith('/items?search=') || url.startsWith('/items/options?search=')) return { data: [] };
  if (url === '/customers?limit=1000') return { data: [] };
  if (url === '/items/options') return { data: [] };
  return [];
}

beforeEach(() => {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => Promise.resolve(apiResponse(url, init)));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fetchJson.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsPage user={user} />
    </QueryClientProvider>,
  );
}

function currencySelect(): HTMLSelectElement {
  return screen.getByText('واحد پول (ارز سند)').parentElement!.querySelector('select') as HTMLSelectElement;
}

function postedDocument(): Record<string, unknown> {
  const call = fetchJson.mock.calls.find(c => c[0] === '/documents' && (c[1] as { method?: string })?.method === 'POST');
  if (!call) throw new Error('no POST /documents');
  return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
}

describe('stock document form residuals (TD-234)', () => {
  it('(1) a parent re-render does not refetch the item search of SearchableSelect', async () => {
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <>
          <button onClick={() => setN(v => v + 1)}>رندر دوباره {n}</button>
          <SearchableSelect value="" onChange={() => undefined} fetchUrl="/items" mapResultToOption={(it: { id: number; name: string }) => ({ value: it.id, label: `${it.name} ${n}` })} />
        </>
      );
    }
    render(<Parent />);
    await waitFor(() => expect(fetchJson.mock.calls.filter(c => String(c[0]).startsWith('/items?search=')).length).toBe(1));
    fireEvent.click(screen.getByText('رندر دوباره 0'));
    fireEvent.click(screen.getByText('رندر دوباره 1'));
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(fetchJson.mock.calls.filter(c => String(c[0]).startsWith('/items?search=')).length).toBe(1);
  });

  it('(2)(4)(3) encodes the return reference, falls back to the business-clock date and resets the currency after saving', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T22:00:00Z')); // تهران: ۱۰ مهر ۱۴۰۵، ساعت ۰۱:۳۰
    renderPage();
    await screen.findByDisplayValue('RC-1001');
    fireEvent.change(screen.getByDisplayValue('رسید خرید مواد اولیه / کالا (فاکتور خرید)'), { target: { value: 'return' } });
    fireEvent.change(screen.getByPlaceholderText('مثال: 1005'), { target: { value: RETURN_REF } });
    fireEvent.click(screen.getByText('جستجو'));
    expect(await screen.findByText('گردنبند نقره')).toBeTruthy();

    // v9.0.273 (TD-788): ارز و نرخ برگشت از فاکتور مرجع می‌آید (پیش‌تر کاربر آن را در فرم انتخاب می‌کرد)
    expect(currencySelect().value).toBe('USD');
    fireEvent.change(screen.getByLabelText('تاریخ سند'), { target: { value: '' } });

    const submit = screen.getAllByRole('button').find(b => b.textContent?.includes('ثبت نهایی'))!;
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(postedDocument().date).toBeDefined());
    expect(postedDocument().date).toBe('1405/07/10');
    expect(postedDocument().currency).toBe('USD');
    expect(postedDocument().exchangeRate).toBe(600000);
    await waitFor(() => expect(currencySelect().value).toBe('IRR'));
    expect(screen.queryByLabelText(/نرخ تسعیر/)).toBeNull();
  });

  it('(3) switching to remittance and back resets the currency to rial', async () => {
    renderPage();
    await screen.findByDisplayValue('RC-1001');
    fireEvent.change(currencySelect(), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByText('خروج از انبار (حواله مصرف)'));
    await screen.findByDisplayValue('RM-2001');
    fireEvent.click(screen.getByText('ورود به انبار (رسید انبار)'));
    expect(currencySelect().value).toBe('IRR');
  });
});
