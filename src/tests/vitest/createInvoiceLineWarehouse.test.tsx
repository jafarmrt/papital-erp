import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import { invoiceLineLocations, type InvoiceDocItem } from '../../lib/invoices/invoiceForm';
import type { Item, User } from '../../types';

// TD-790 (B08-21): ویرایش پیش‌فاکتور انبار هر ردیف را از خود ردیف می‌خواند و با همان ردیف می‌فرستد
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
const line = (itemId: number, name: string, location: string) => ({
  document_id: 5, item_id: itemId, quantity: 1, unit_price: 1000, unitPrice: 1000, discount: 0, location, name, code: `P-${itemId}`, unit: 'عدد',
});
const docs: Record<string, Record<string, unknown>> = {
  '/documents/5': { id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری', currency: 'IRR', items: [line(3, 'گردنبند نقره', 'WH2')] },
  '/documents/7': {
    id: 7, type: 'invoice', status: 'proforma', ref_number: 'PF-7', date: '2026-10-01 10:00:00', buyer_name: 'مشتری', currency: 'IRR',
    items: [line(3, 'گردنبند نقره', 'WH1'), line(8, 'دستبند چرمی', 'WH2')],
  },
};
const openProformas = [
  { id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری' },
  { id: 7, type: 'invoice', status: 'proforma', ref_number: 'PF-7', date: '2026-10-01 10:00:00', buyer_name: 'مشتری' },
];

function server() {
  fetchJson.mockImplementation((url: string, init?: Init) => {
    const method = init?.method ?? 'GET';
    if (url === '/warehouses') return Promise.resolve(warehouses);
    if (url.startsWith('/documents?statuses=proforma,draft')) return Promise.resolve({ data: openProformas, total: openProformas.length, page: 1, limit: 20 });
    if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
    if (docs[url] && method === 'GET') return Promise.resolve(docs[url]);
    if (docs[url] && method === 'PUT') return Promise.resolve({ success: true });
    return Promise.resolve([]);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateInvoicePage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const putBody = (url: string) => {
  const call = fetchJson.mock.calls.find(([u, i]) => u === url && (i as Init | undefined)?.method === 'PUT');
  return call ? JSON.parse(String((call[1] as Init).body)) as { location: string; items: Array<{ itemId: number; location?: string }> } : undefined;
};

async function editProforma(ref: string) {
  const row = (await screen.findByText(ref)).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByText('ویرایش'));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`پیش‌فاکتور شماره ${ref} جهت ویرایش بارگذاری شد.`));
}

const warehouseSelect = () => screen.getByRole('option', { name: '📦 انبار مرکزی' }).closest('select') as HTMLSelectElement;
const multiWarehouseNote = 'ردیف‌های این پیش‌فاکتور از چند انبار است و هر ردیف از انبار خودش ذخیره می‌شود. تغییر این انبار همه ردیف‌ها را به آن می‌برد.';

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
});

describe('CreateInvoicePage — editing a proforma keeps the warehouse of its lines (TD-790)', () => {
  it('a proforma of warehouse 2 opens on warehouse 2 and is saved there', async () => {
    server();
    renderPage();
    await editProforma('PF-5');
    expect(warehouseSelect().value).toBe('WH2');
    expect(screen.queryByText(multiWarehouseNote)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(putBody('/documents/5')).toBeDefined());
    expect(putBody('/documents/5')!.location).toBe('WH2');
    expect(putBody('/documents/5')!.items.map(i => i.location)).toEqual(['WH2']);
  });

  it('a proforma of two warehouses keeps each line in its own warehouse and says so', async () => {
    server();
    renderPage();
    await editProforma('PF-7');
    expect(screen.getByText(multiWarehouseNote)).toBeTruthy();
    expect(screen.getByText('انبار: انبار فروشگاه')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(putBody('/documents/7')).toBeDefined());
    expect(putBody('/documents/7')!.items.map(i => [i.itemId, i.location])).toEqual([[3, 'WH1'], [8, 'WH2']]);
  });

  it('choosing another warehouse at the top moves every line of a two-warehouse proforma to it', async () => {
    server();
    renderPage();
    await editProforma('PF-7');
    fireEvent.change(warehouseSelect(), { target: { value: 'WH2' } });
    expect(screen.queryByText(multiWarehouseNote)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(putBody('/documents/7')).toBeDefined());
    expect(putBody('/documents/7')!.items.map(i => i.location)).toEqual(['WH2', 'WH2']);
  });
});

describe('invoiceLineLocations (TD-790)', () => {
  const lineOf = (id: number, location?: string): InvoiceDocItem => ({ item: { id } as Item, quantity: 1, unitPrice: 1, discount: 0, location });

  it('lines of one warehouse follow the top warehouse; an unknown warehouse is dropped', () => {
    expect(invoiceLineLocations([lineOf(1, 'WH2'), lineOf(2, 'main')], ['WH1', 'WH2'])).toEqual({
      lines: [lineOf(1), lineOf(2)], header: 'WH2', multiWarehouse: false,
    });
    expect(invoiceLineLocations([lineOf(1, 'main')], ['WH1', 'WH2']).header).toBeNull();
  });

  it('lines of two warehouses keep their own warehouse', () => {
    const result = invoiceLineLocations([lineOf(1, 'WH2'), lineOf(2, 'WH1')], ['WH1', 'WH2']);
    expect(result.multiWarehouse).toBe(true);
    expect(result.header).toBe('WH2');
    expect(result.lines.map(l => l.location)).toEqual(['WH2', 'WH1']);
  });
});
