import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import type { User } from '../../types';

// TD-789 (B08-20): پاک کردن فرم فاکتور فروش همه فیلدها را به مقدار آغازین برمی‌گرداند، پرونده فروش مسیریابی فقط به سند
// تازه همان بار می‌رسد و این فرم سند غیرفروش را ویرایش یا ثبت نمی‌کند
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface Init { method?: string; body?: string; signal?: AbortSignal }

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر تست', role: 'admin' };
const warehouses = [
  { id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 },
  { id: 2, name: 'انبار فروشگاه', code: 'WH2', is_active: 1 },
];
const openProformas = [
  { id: 5, type: 'proforma', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری دیگر' },
  { id: 6, type: 'receipt', status: 'proforma', ref_number: 'RCP-6', date: '2026-10-02 09:00:00', buyer_name: 'تامین سنگ' },
];
const line = { document_id: 5, item_id: 3, quantity: 1, unit_price: 100, unitPrice: 100, discount: 0, location: 'WH2', name: 'گردنبند نقره', code: 'P-3', unit: 'عدد' };
// پیش‌فاکتور ارزی پرونده ۹ در انبار ۲ با تاریخ گذشته
const doc5 = {
  id: 5, type: 'proforma', status: 'proforma', ref_number: 'PF-5', date: '2026-09-01 10:00:00', crmLeadId: 9,
  buyer_name: 'مشتری دیگر', buyer_city: 'تهران', currency: 'USD', exchangeRate: 600000, vatPercent: 9, items: [line],
};
const doc6 = { ...doc5, id: 6, type: 'receipt', ref_number: 'RCP-6', crmLeadId: null, currency: 'IRR', exchangeRate: null, buyer_name: 'تامین سنگ' };
const customer = { id: 31, name: 'مشتری نقدی', phone: '09120000000', city: 'تهران' };
const stockItem = { id: 3, type: 'product', code: 'P-3', name: 'گردنبند نقره', unit: 'عدد', current_stock: 5, stock_WH1: 5, reserved_stock: 0 };
const draft = {
  docType: 'invoice', status: 'proforma', currency: 'IRR', buyerName: 'مشتری پرونده ۷', buyerCity: 'تهران',
  docItems: [{ item: { id: 3, type: 'product', code: 'P-3', name: 'گردنبند نقره', unit: 'عدد', current_stock: 5 }, quantity: 2, unitPrice: 1000, discount: 0 }],
};

function server(withDraft: boolean) {
  fetchJson.mockImplementation((url: string, init?: Init) => {
    const method = init?.method ?? 'GET';
    if (url === '/warehouses') return Promise.resolve(warehouses);
    if (url === '/customers/options') return Promise.resolve({ data: [] });
    if (url.startsWith('/documents?status=proforma')) return Promise.resolve({ data: openProformas, total: openProformas.length, page: 1, limit: 20 });
    if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
    if (url === '/documents/next-ref?type=proforma') return Promise.resolve({ nextRef: 'PF-77' });
    if (url === '/documents/next-ref?type=receipt') return Promise.resolve({ nextRef: 'RC-77' });
    if (url.startsWith('/customers/options?')) return Promise.resolve({ data: [customer] });
    if (url.startsWith('/items/options?')) return Promise.resolve({ data: [stockItem] });
    if (url.startsWith('/drafts/invoice') && method === 'GET') {
      return Promise.resolve(withDraft ? { draft: { payload: draft, isDeleted: 0, updatedAt: '2026-10-03T08:00:00Z' } } : {});
    }
    if (url === '/documents' && method === 'POST') return Promise.resolve({ success: true, docId: 11 });
    if (url === '/documents/11') return Promise.resolve({ ...doc5, id: 11, type: 'invoice', ref_number: 'INV-1001', crmLeadId: 7 });
    if (url === '/documents/5' && method === 'GET') return Promise.resolve(doc5);
    if (url === '/documents/6' && method === 'GET') return Promise.resolve(doc6);
    if (/^\/documents\/[56]$/.test(url) && method === 'PUT') return Promise.resolve({ success: true });
    return Promise.resolve([]);
  });
}

let routerState: unknown = 'unread';
function RouterStateProbe() {
  routerState = useLocation().state;
  return null;
}

function renderPage(state?: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[state ? { pathname: '/remittances', state } : '/remittances']}>
        <CreateInvoicePage user={admin} />
        <RouterStateProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bodiesOf = (method: string, url: string) => fetchJson.mock.calls
  .filter(([u, i]) => u === url && (i as Init | undefined)?.method === method)
  .map(([, i]) => JSON.parse(String((i as Init).body)) as Record<string, unknown>);

async function clickEdit(ref: string) {
  const row = (await screen.findByText(ref)).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByText('ویرایش'));
}

async function editProforma(ref: string) {
  await clickEdit(ref);
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`پیش‌فاکتور شماره ${ref} جهت ویرایش بارگذاری شد.`));
}

const statusSelect = () => screen.getByRole('option', { name: /پیش فاکتور \(رزرو موقت\)/ }).closest('select') as HTMLSelectElement;
const currencySelect = () => screen.getByRole('option', { name: 'ریال' }).closest('select') as HTMLSelectElement;
const warehouseSelect = () => screen.getByRole('option', { name: '📦 انبار مرکزی' }).closest('select') as HTMLSelectElement;

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  routerState = 'unread';
});

describe('CreateInvoicePage — the sales lead of the navigation reaches only the new document (TD-789)', () => {
  it('the lead proforma is saved with lead 7; editing another lead\'s proforma afterwards leaves its link alone', async () => {
    server(true);
    renderPage({ crmLeadId: 7, buyerName: 'مشتری پرونده ۷', status: 'proforma' });
    fireEvent.click(await screen.findByText('بازیابی پیش‌نویس'));
    await screen.findByText('گردنبند نقره');
    fireEvent.click(screen.getByRole('button', { name: 'ثبت و صدور فاکتور' }));
    fireEvent.click(await screen.findByText('بازگشت به فرم ثبت'));
    expect(bodiesOf('POST', '/documents')[0].crmLeadId).toBe(7);

    await editProforma('PF-5');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(bodiesOf('PUT', '/documents/5')).toHaveLength(1));
    expect('crmLeadId' in bodiesOf('PUT', '/documents/5')[0]).toBe(false);
  });

  it('the navigation state is read once and then cleared', async () => {
    server(false);
    renderPage({ crmLeadId: 7, buyerName: 'مشتری پرونده ۷', status: 'proforma' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('اطلاعات خریدار و پرونده فروش منتقل شد.'));
    await waitFor(() => expect(routerState).toBeNull());
  });
});

describe('CreateInvoicePage — cancelling an edit puts every field back to its start value (TD-789)', () => {
  it('after cancelling the edit of a USD proforma moved to warehouse 2, the next invoice is an IRR invoice of the default warehouse', async () => {
    server(false);
    renderPage();
    await editProforma('PF-5');
    fireEvent.change(warehouseSelect(), { target: { value: 'WH2' } });
    expect(currencySelect().value).toBe('USD');
    expect(warehouseSelect().value).toBe('WH2');
    expect(statusSelect().value).toBe('proforma');

    fireEvent.click(screen.getAllByText('انصراف')[0]);
    await waitFor(() => expect(screen.queryByText('ذخیره تغییرات پیش‌فاکتور')).toBeNull());
    expect(currencySelect().value).toBe('IRR');
    expect(warehouseSelect().value).toBe('WH1');
    expect(statusSelect().value).toBe('final');
    expect(await screen.findByDisplayValue('INV-1001')).toBeTruthy();

    fireEvent.click(screen.getByText('-- جهت انتخاب خریدار، کلیک کرده یا نام/تلفن وی را تایپ کنید --'));
    fireEvent.click(await screen.findByText(/👤 مشتری نقدی/, {}, { timeout: 2000 }));
    fireEvent.click(screen.getByText('انتخاب کالا / ماده اولیه'));
    fireEvent.click(await screen.findByText(/^P-3 - گردنبند نقره/, {}, { timeout: 2000 }));
    const inputOf = (label: string) => screen.getByText(label).parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(inputOf('تعداد'), { target: { value: '2' } });
    fireEvent.change(inputOf('مبلغ واحد (IRR)'), { target: { value: '1000000' } });
    fireEvent.click(screen.getByText('افزودن به لیست'));
    fireEvent.click(screen.getByRole('button', { name: 'ثبت و صدور فاکتور' }));
    await waitFor(() => expect(bodiesOf('POST', '/documents')).toHaveLength(1));
    const body = bodiesOf('POST', '/documents')[0];
    expect(body).toMatchObject({ docType: 'invoice', status: 'final', currency: 'IRR', exchangeRate: null, location: 'WH1', vatPercent: 0, refNumber: 'INV-1001' });
    expect(body.crmLeadId).toBeUndefined();
  });
});

describe('CreateInvoicePage — a document that is not a sale is not edited here (TD-789)', () => {
  it('editing a purchase proforma is refused and the form stays a sales invoice', async () => {
    server(false);
    renderPage();
    await clickEdit('RCP-6');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('سند شماره RCP-6 سند فروش نیست و در این فرم ویرایش نمی‌شود.'));
    expect(screen.queryByText('ذخیره تغییرات پیش‌فاکتور')).toBeNull();
    expect(screen.queryByDisplayValue('RC-77')).toBeNull();
    expect(fetchJson).not.toHaveBeenCalledWith('/documents/next-ref?type=receipt', expect.anything());
  });
});
