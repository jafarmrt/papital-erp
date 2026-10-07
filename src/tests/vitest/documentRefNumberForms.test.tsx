import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import DocumentsPage from '../../pages/DocumentsPage';
import { useStockDocumentSubmit } from '../../hooks/documents/useStockDocumentSubmit';
import { isAutoRefNumber, isServerSeriesDocumentType, refNumberToSend } from '../../lib/documents/documentRefRules';
import { itemReservationSummary } from '../../lib/documents/stockReservations';
import type { StockDocumentForm } from '../../hooks/documents/useStockDocumentForm';
import type { StockDocumentReferenceData } from '../../hooks/documents/useStockDocumentReferenceData';
import type { Item, User } from '../../types';

// v9.0.285 (TD-783، یافته B08-14، تصمیم ت۹ «الف» بسته ۸): شماره فاکتور فروش و برگشت از فروش فقط از سری سرور است و فرم
// آن را فقط نشان می‌دهد؛ فرم سند انبار شماره پیشنهادی دست‌نخورده را «auto» می‌فرستد و فقط شماره‌ای را که کاربر نوشته
// می‌فرستد. پیش‌تر شماره پیشنهادی فرستاده می‌شد و دو فرم باز یک شماره می‌فرستادند.
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
const bead = { id: 4, type: 'raw_material', name: 'مهره چوبی', code: 'RM-4', current_stock: 5, unit: 'عدد', purchase_price: 500 } as unknown as Item;
const refData = { warehouses: [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }] } as unknown as StockDocumentReferenceData;

function formFor(overrides: Partial<StockDocumentForm>): StockDocumentForm {
  const noop = vi.fn();
  return {
    actionType: 'in', docType: 'receipt', refNumber: 'R-10', suggestedRef: 'R-10', date: '1405/07/15', location: 'WH1',
    buyerName: 'تأمین‌کننده', currency: 'IRR', exchangeRate: 0, returnInvoiceId: null, returnVatPercent: '', notes: '',
    docItems: [{ item: bead, quantity: 2, unitPrice: 500 }], selectedProjectId: '', selectedProjectObj: null, attachments: [],
    getItemReservationSummary: (it: Item) => itemReservationSummary([], it, ''),
    setIsSaving: noop, setDocItems: noop, fetchNextRef: vi.fn(() => Promise.resolve()), changeReturnInvoiceRef: noop,
    setReturnVatPercent: noop, setBuyerName: noop, setSelectedSupplierObj: noop, setNotes: noop, setUnitPrice: noop,
    setQuantity: noop, setSelectedProjectId: noop, setSelectedProjectObj: noop, setAttachments: noop, setCurrency: noop,
    setExchangeRate: noop,
    ...overrides,
  } as unknown as StockDocumentForm;
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

async function postedRefNumber(form: StockDocumentForm): Promise<unknown> {
  fetchJson.mockResolvedValue({ success: true, docId: 12, refNumber: 'R-11' });
  const { result } = renderHook(() => useStockDocumentSubmit(form, refData, user), { wrapper });
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: () => undefined } as unknown as React.FormEvent);
  });
  const post = fetchJson.mock.calls.find(([url, init]) => url === '/documents' && init?.method === 'POST');
  return JSON.parse(String(post?.[1].body)).refNumber;
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('document number rules of the forms (TD-783)', () => {
  it('sales invoices and sales returns always take the server series; an untouched or empty number is "auto"', () => {
    expect(isServerSeriesDocumentType('invoice')).toBe(true);
    expect(isServerSeriesDocumentType('return')).toBe(true);
    expect(isServerSeriesDocumentType('receipt')).toBe(false);
    expect(refNumberToSend('invoice', 'INV-99', 'INV-12')).toBe('auto');
    expect(refNumberToSend('return', 'RET-5', 'RET-5')).toBe('auto');
    expect(refNumberToSend('receipt', ' R-10 ', 'R-10')).toBe('auto');
    expect(refNumberToSend('receipt', '', 'R-10')).toBe('auto');
    expect(refNumberToSend('receipt', ' R-77 ', 'R-10')).toBe('R-77');
    expect([undefined, null, '', '  ', 'auto', 'AUTO'].every(isAutoRefNumber)).toBe(true);
    expect(isAutoRefNumber('R-1')).toBe(false);
  });

  it('the stock page sends "auto" for the suggested number and the number the user typed otherwise', async () => {
    expect(await postedRefNumber(formFor({}))).toBe('auto');
    fetchJson.mockReset();
    expect(await postedRefNumber(formFor({ refNumber: 'R-77' }))).toBe('R-77');
    fetchJson.mockReset();
    expect(await postedRefNumber(formFor({ docType: 'return', refNumber: 'RET-9', suggestedRef: 'RET-1' }))).toBe('auto');
  });

  it('the stock page number is editable for a receipt and read-only for a sales return', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
      if (url.startsWith('/documents/next-ref?type=')) return Promise.resolve({ nextRef: `${url.split('=')[1].toUpperCase()}-1` });
      if (url.startsWith('/items/options')) return Promise.resolve({ data: [] });
      return Promise.resolve([]);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DocumentsPage user={user} />
      </QueryClientProvider>,
    );
    const receiptRef = await screen.findByDisplayValue('RECEIPT-1') as HTMLInputElement;
    expect(receiptRef.readOnly).toBe(false);
    fireEvent.change(screen.getByDisplayValue('رسید خرید مواد اولیه / کالا (فاکتور خرید)'), { target: { value: 'return' } });
    const returnRef = await screen.findByDisplayValue('RETURN-1') as HTMLInputElement;
    expect(returnRef.readOnly).toBe(true);
  });
});
