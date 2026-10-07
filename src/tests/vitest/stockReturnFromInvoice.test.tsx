import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentsPage from '../../pages/DocumentsPage';
import { invoiceReturnTerms } from '../../lib/documents/returnUnitPrice';
import type { User } from '../../types';

// v9.0.246 (TD-788، یافته B08-19، تصمیم ت۱۰ الف): برگشت از صفحه اسناد انبار ارز، نرخ و قیمت خالص هر واحد را از فاکتور
// مرجع می‌گیرد و فرم آن‌ها را قفل می‌کند. پیش‌تر برگشت فاکتور ۱۸۰ دلاری با «IRR»، قیمت ۱۰۰ و بی تخفیف فرستاده می‌شد.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out', 'documents.finalize'], isAdmin: false } }),
  useHasPermission: () => false,
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };

// فاکتور دلاری: ۲ × ۱۰۰ با تخفیف ۲۰ و ۱ × ۱۳۰ از همان کالا در ردیف دوم، نرخ ۶۰۰٬۰۰۰ (خالص ۳۱۰ دلار برای ۳ عدد)
const usdInvoice = {
  id: 40, buyer_name: 'مشتری دبی', currency: 'USD', exchangeRate: 600000,
  items: [
    { item_id: 3, name: 'گردنبند نقره', code: 'P-3', unit: 'عدد', quantity: 2, unit_price: 100, discount: 20 },
    { item_id: 3, name: 'گردنبند نقره', code: 'P-3', unit: 'عدد', quantity: 1, unit_price: 130, discount: 0 },
  ],
};

// v9.0.247 (TD-774): فاکتور ریالی با مالیات؛ مالیات برگشتش را سرور از همین فاکتور می‌گیرد
const irrInvoice = {
  id: 41, buyer_name: 'مشتری تهران', currency: 'IRR', exchangeRate: null, vatPercent: 10, vatAmount: 50000,
  items: [{ item_id: 5, name: 'گوشواره میخی', code: 'P-5', unit: 'عدد', quantity: 5, unit_price: 100000, discount: 0 }],
};

function apiResponse(url: string, init?: { method?: string }): unknown {
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url.startsWith('/documents/next-ref?type=')) return { nextRef: `${url.split('=')[1].toUpperCase()}-1` };
  if (url === '/documents/by-ref/INV-USD-1?type=invoice') return usdInvoice;
  if (url === '/documents/by-ref/INV-IRR-1?type=invoice') return irrInvoice;
  if (url === '/documents' && init?.method === 'POST') return { docId: 90 };
  if (url.startsWith('/items/options') || url === '/customers?limit=1000') return { data: [] };
  return [];
}

beforeEach(() => {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => Promise.resolve(apiResponse(url, init)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function postedDocument(): Record<string, unknown> {
  const call = fetchJson.mock.calls.find(c => c[0] === '/documents' && (c[1] as { method?: string })?.method === 'POST');
  if (!call) throw new Error('no POST /documents');
  return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
}

describe('the net unit price of an invoice item (TD-788)', () => {
  it('is the weighted net of its lines after line discounts, rounded to four decimals', () => {
    const terms = invoiceReturnTerms([
      { itemId: 3, quantity: 2, unitPrice: 100, discount: 20 },
      { itemId: 3, quantity: 1, unitPrice: 130 },
      { itemId: 4, quantity: 3, unitPrice: 1000, discount: 1000 },
      { itemId: 5, quantity: 1, unitPrice: 50, discount: 80 },
    ]);
    expect(terms.get(3)?.quantity.toNumber()).toBe(3);
    expect(terms.get(3)?.netUnitPrice.toString()).toBe('103.3333');
    expect(terms.get(4)?.netUnitPrice.toString()).toBe('666.6667');
    expect(terms.get(5)?.netUnitPrice.toNumber()).toBe(0);
  });
});

describe('a sales return from the stock page (TD-788)', () => {
  it('takes the currency, rate and net unit price of its invoice and locks them', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DocumentsPage user={user} />
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue('RECEIPT-1');
    fireEvent.change(screen.getByDisplayValue('رسید خرید مواد اولیه / کالا (فاکتور خرید)'), { target: { value: 'return' } });
    fireEvent.change(screen.getByPlaceholderText('مثال: 1005'), { target: { value: 'INV-USD-1' } });
    fireEvent.click(screen.getByText('جستجو'));
    expect(await screen.findByText('گردنبند نقره')).toBeTruthy();

    const currency = screen.getByText('واحد پول (ارز سند)').parentElement!.querySelector('select') as HTMLSelectElement;
    expect(currency.value).toBe('USD');
    expect(currency.disabled).toBe(true);
    expect((screen.getByLabelText(/نرخ تسعیر/) as HTMLInputElement).disabled).toBe(true);
    // one row for the item, its price shown and not editable
    expect(screen.getAllByText('گردنبند نقره')).toHaveLength(1);
    expect(screen.getByTitle('قیمت خالص هر واحد در فاکتور مرجع')).toBeTruthy();

    const submit = screen.getAllByRole('button').find(b => b.textContent?.includes('ثبت نهایی'))!;
    await act(async () => { fireEvent.click(submit); });
    await waitFor(() => expect(postedDocument().docType).toBe('return'));
    expect(postedDocument()).toMatchObject({ returnOfDocumentId: 40, currency: 'USD', exchangeRate: 600000 });
    expect(postedDocument().items).toEqual([{ itemId: 3, quantity: 3, unit_price: 103.3333 }]);
  });
});

describe('the VAT of a sales return from the stock page (TD-774)', () => {
  async function openReturnOf(ref: string): Promise<void> {
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
    expect(await screen.findByText('گوشواره میخی')).toBeTruthy();
  }

  async function submit(): Promise<void> {
    const button = screen.getAllByRole('button').find(b => b.textContent?.includes('ثبت نهایی'))!;
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(postedDocument().docType).toBe('return'));
  }

  it('leaves the VAT of a return with an invoice to the server and sends no percent', async () => {
    await openReturnOf('INV-IRR-1');
    expect(screen.getByText('مالیات بر ارزش افزوده به نسبت مبلغ برگشتی از مالیات همین فاکتور برمی‌گردد.')).toBeTruthy();
    expect(screen.queryByLabelText('درصد مالیات بر ارزش افزوده')).toBeNull();
    await submit();
    expect(postedDocument()).toMatchObject({ returnOfDocumentId: 41 });
    expect(postedDocument().vatPercent).toBeUndefined();
  });

  it('asks the VAT percent of a return without an invoice and sends it', async () => {
    await openReturnOf('INV-IRR-1');
    // the reference is changed by hand: the invoice is no longer linked, the lines stay
    fireEvent.change(screen.getByPlaceholderText('مثال: 1005'), { target: { value: 'INV-IRR-2' } });
    fireEvent.change(screen.getByLabelText('درصد مالیات بر ارزش افزوده'), { target: { value: '10' } });
    await submit();
    expect(postedDocument().returnOfDocumentId).toBeUndefined();
    expect(postedDocument().vatPercent).toBe(10);
  });
});
