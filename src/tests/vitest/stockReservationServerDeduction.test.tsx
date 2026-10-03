import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { useStockDocumentSubmit } from '../../hooks/documents/useStockDocumentSubmit';
import { createStockDocumentItemActions, reservationSourceLabel } from '../../hooks/documents/stockDocumentItemActions';
import { itemReservationSummary, type GlobalReservation } from '../../lib/documents/stockReservations';
import type { DocItemRow } from '../../components/documents/DocItemsTable';
import type { StockDocumentForm } from '../../hooks/documents/useStockDocumentForm';
import type { StockDocumentReferenceData } from '../../hooks/documents/useStockDocumentReferenceData';
import type { Item, User } from '../../types';

// TD-233 (v7.0.102): رزرو پروژه حواله خروج در سرور کم می‌شود؛ فرم دیگر پروژه را جداگانه به‌روز نمی‌کند.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };
const stone = { id: 3, type: 'raw_material', name: 'سنگ فیروزه', code: 'RM-3', current_stock: 5, unit: 'عدد', purchase_price: 500 } as unknown as Item;
const project = { id: 7, project_code: 'PRJ-7', title: 'گردنبند سفارشی', inventory_control: { reservedItems: [{ itemId: 3, reservedQty: 4 }] } };

function reservation(overrides: Partial<GlobalReservation>): GlobalReservation {
  return { projectCode: '', projectTitle: '', itemCode: '', itemName: '', reservedQty: 0, unit: 'عدد', ...overrides };
}

function formFor(overrides: Partial<StockDocumentForm>): StockDocumentForm {
  const noop = vi.fn();
  return {
    actionType: 'out', docType: 'remittance', refNumber: 'RM-1', date: '1405/07/11', location: 'WH1', buyerName: 'علی رضایی',
    currency: 'IRR', exchangeRate: 0, returnInvoiceId: null, notes: '', docItems: [], selectedProjectId: '7',
    selectedProjectObj: project, attachments: [],
    getItemReservationSummary: (it: Item) => itemReservationSummary([], it, '7'),
    setIsSaving: noop, setDocItems: noop, fetchNextRef: vi.fn(() => Promise.resolve()), setReturnInvoiceRef: noop,
    setReturnInvoiceId: noop, setBuyerName: noop, setSelectedSupplierObj: noop, setNotes: noop, setUnitPrice: noop,
    setQuantity: noop, setSelectedProjectId: noop, setSelectedProjectObj: noop, setAttachments: noop, setCurrency: noop,
    setExchangeRate: noop,
    ...overrides,
  } as unknown as StockDocumentForm;
}

const refData = { warehouses: [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }] } as unknown as StockDocumentReferenceData;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  fetchJson.mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe('remittance submit (TD-233)', () => {
  it('posts only the document and reports the quantity the server released', async () => {
    fetchJson.mockImplementation((url: string, init?: { method?: string }) =>
      Promise.resolve(url === '/documents' && init?.method === 'POST'
        ? { success: true, docId: 11, projectReservation: { projectId: 7, releasedQuantity: 2, releasedItemIds: [3] } }
        : {}));
    const form = formFor({ docItems: [{ item: stone, quantity: 2, unitPrice: 0 }] });
    const { result } = renderHook(() => useStockDocumentSubmit(form, refData, user), { wrapper });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => undefined } as unknown as React.FormEvent);
    });

    const post = fetchJson.mock.calls.find(([url, init]) => url === '/documents' && init?.method === 'POST');
    expect(JSON.parse(post?.[1].body).projectId).toBe(7);
    expect(fetchJson.mock.calls.some(([url, init]) => String(url).startsWith('/projects/') && init?.method === 'PUT')).toBe(false);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('تعداد 2 عدد');
  });
});

describe('add all reserved items (TD-233)', () => {
  it('sums several reservation rows of one item and caps the quantity at the exit limit', () => {
    const setDocItems = vi.fn();
    const rows = [
      reservation({ sourceType: 'project', projectId: 7, itemId: 3, reservedQty: 2 }),
      reservation({ sourceType: 'project', projectId: 7, itemCode: 'RM-3', reservedQty: 4 }),
    ];
    const form = formFor({ setDocItems, selectedProjectReservedItems: rows } as Partial<StockDocumentForm>);
    createStockDocumentItemActions(form, [stone]).handleAddAllProjectReservedItems();

    const update = setDocItems.mock.calls[0][0] as (prev: DocItemRow[]) => DocItemRow[];
    // 2 + 4 = 6 reserved, but only 5 in stock: the line is capped and the user is told why
    expect(update([]).map(r => [r.item.id, r.quantity])).toEqual([[3, 5]]);
    expect(vi.mocked(toast).mock.calls[0][0]).toContain('«سنگ فیروزه» (5 عدد)');
  });

  it('names a proforma reservation as a proforma in the exit-limit message', () => {
    expect(reservationSourceLabel(reservation({ sourceType: 'proforma', projectCode: 'PF-1', reservedQty: 1 }))).toBe('پیش‌فاکتور «PF-1» (1 عدد)');
    expect(reservationSourceLabel(reservation({ sourceType: 'project', projectCode: 'PRJ-8', reservedQty: 3 }))).toBe('پروژه «PRJ-8» (3 عدد)');
  });
});
