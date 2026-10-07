import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
// v9.0.291 (TD-795): the row buttons follow their API permission; this characterization runs as a user holding every key
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useHasPermission: () => true,
  useHasAnyPermission: () => true,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
  default: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const invoice = {
  id: 1, type: 'invoice', status: 'final', ref_number: 'INV-1001', date: '2026-09-20', currency: 'IRR',
  buyer_name: 'نگار کریمی', buyer_city: 'تهران', buyer_phone: '09121234567',
  itemsCount: 2, totalQuantity: 3, totalAmount: 1500000,
  settlementStatus: 'partially_paid', paidAmount: 500000, remainingAmount: 1000000, notes: 'ارسال با پیک',
};
const receipt = {
  id: 2, type: 'receipt', status: 'final', ref_number: 'RC-2001', date: '2026-09-21', currency: 'USD',
  buyer_name: 'تامین سنگ', itemsCount: 1, totalQuantity: 10, totalAmount: 200,
};
const proforma = {
  id: 3, type: 'proforma', status: 'proforma', ref_number: 'PF-3001', date: '2026-09-22', currency: 'IRR',
  buyer_name: 'سارا احمدی', totalAmount: 900000,
};
const remittance = {
  id: 4, type: 'remittance', status: 'final', ref_number: 'RM-4001', date: '2026-09-23',
  items: [{ quantity: 2, unit_price: 100, discount: 0 }],
};

const fullInvoice = {
  ...invoice,
  user: 'admin',
  items: [
    { id: 11, item_id: 5, code: 'P-5', name: 'گردنبند نقره', quantity: 2, unit_price: 600000, discount: 50000, unit: 'عدد' },
    { id: 12, item_id: 6, code: 'P-6', name: 'گوشواره میخی', quantity: 1, unit_price: 350000, discount: 0, unit: 'جفت' },
  ],
};

function apiResponse(url: string, init?: { method?: string }): unknown {
  if (url.startsWith('/documents?')) return { data: [invoice, receipt, proforma, remittance], total: 4, page: 1, totalPages: 1 };
  if (url === '/documents/1' && !init?.method) return fullInvoice;
  if (url.startsWith('/workflow/instance/')) return { instance: null };
  if (url === '/documents/1/notes') return { success: true };
  return [];
}

beforeEach(() => {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => Promise.resolve(apiResponse(url, init)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
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

describe('InvoicesListPage — invoices list (TD-080 part 3 characterization)', () => {
  it('renders the KPI cards, the rows and the pagination summary from the documents list', async () => {
    renderPage();
    expect(screen.getByText('لیست اسناد، فاکتورها و رسیدهای انبار')).toBeTruthy();
    expect(await screen.findByText('INV-۱۰۰۱')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/documents?page=1&limit=50');

    // KPI cards: totals grouped by currency
    expect(screen.getByText('۱ فاکتور فروش نهایی')).toBeTruthy();
    expect(screen.getByText('۱ رسید خرید ثبت‌شده')).toBeTruthy();
    expect(screen.getByText('۱ پیش‌فاکتور در جریان')).toBeTruthy();
    expect(screen.getByText('۲۰۰ دلار')).toBeTruthy();
    expect(screen.getByText('۹۰۰٬۰۰۰ ریال')).toBeTruthy();
    expect(screen.getByText('۴ سند ثبت‌شده')).toBeTruthy();

    const invoiceRow = rowOf('INV-۱۰۰۱');
    expect(within(invoiceRow).getByText('فاکتور فروش')).toBeTruthy();
    expect(within(invoiceRow).getByText('مشتری: نگار کریمی')).toBeTruthy();
    expect(within(invoiceRow).getByText('تسویه ناقص')).toBeTruthy();
    expect(within(invoiceRow).getByText('۱٬۰۰۰٬۰۰۰')).toBeTruthy();
    expect(within(invoiceRow).getByText('تسویه سریع')).toBeTruthy();

    const receiptRow = rowOf('RC-۲۰۰۱');
    expect(within(receiptRow).getByText('رسید ورود (خرید کالا)')).toBeTruthy();
    expect(within(receiptRow).getByText('تامین‌کننده: تامین سنگ')).toBeTruthy();
    expect(within(receiptRow).getByText('تسویه نشده')).toBeTruthy();

    const remittanceRow = rowOf('RM-۴۰۰۱');
    expect(within(remittanceRow).getByText('حواله خروج / مصرف')).toBeTruthy();
    expect(within(remittanceRow).getByText('۲۰۰')).toBeTruthy();

    expect(screen.getByText('نمایش ۴ از مجموع ۴ سند ثبت‌شده (صفحه ۱ از ۱)')).toBeTruthy();
  });

  it('refetches with the type filter and clears the filters', async () => {
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    expect(screen.queryByText('پاک کردن فیلترها')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('همه انواع سند (خرید، فروش، انبار)'), { target: { value: 'invoice' } });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/documents?type=invoice&page=1&limit=50'));
    fireEvent.click(screen.getByText('پاک کردن فیلترها'));
    expect(screen.queryByText('پاک کردن فیلترها')).toBeNull();
    expect(screen.getByDisplayValue('همه انواع سند (خرید، فروش، انبار)')).toBeTruthy();
  });

  it('opens the document details modal with its items and totals', async () => {
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    fireEvent.click(within(rowOf('INV-۱۰۰۱')).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    expect(await screen.findByText('گردنبند نقره')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/documents/1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('صورتحساب فروش کالا')).toBeTruthy();
    expect(screen.getByText('ریز اقلام و ردیف‌های سند (۲ قلم)')).toBeTruthy();
    expect(screen.getByText('مجموع تعداد: ۳ واحد')).toBeTruthy();
    expect(screen.getAllByText('۱٬۵۰۰٬۰۰۰ ریال')).toHaveLength(2);
    expect(screen.getByText('۱٬۵۵۰٬۰۰۰')).toBeTruthy();
    fireEvent.click(screen.getByText('بستن پنجره'));
    expect(screen.queryByText('گردنبند نقره')).toBeNull();
  });

  it('edits a row note inline and saves it with PUT /documents/:id/notes', async () => {
    renderPage();
    await screen.findByText('INV-۱۰۰۱');
    fireEvent.click(within(rowOf('INV-۱۰۰۱')).getByTitle('ویرایش توضیحات'));
    const textarea = screen.getByDisplayValue('ارسال با پیک');
    fireEvent.change(textarea, { target: { value: 'تحویل حضوری' } });
    fireEvent.click(screen.getByText('ثبت'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('توضیحات با موفقیت ثبت شد.'));
    expect(fetchJson).toHaveBeenCalledWith('/documents/1/notes', { method: 'PUT', body: JSON.stringify({ notes: 'تحویل حضوری' }) });
    await waitFor(() => expect(screen.queryByDisplayValue('تحویل حضوری')).toBeNull());
  });
});
