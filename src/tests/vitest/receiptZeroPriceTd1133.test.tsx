import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { receiptZeroPriceCheck } from '../../lib/documents/receiptZeroPrice';
import { REORDER_DIRECT_DOCUMENT_LABEL } from '../../lib/reorderAlerts/reorderPurchaseReceipt';
import { itemReservationSummary } from '../../lib/documents/stockReservations';
import type { StockDocumentForm } from '../../hooks/documents/useStockDocumentForm';
import type { StockDocumentReferenceData } from '../../hooks/documents/useStockDocumentReferenceData';
import type { Item, User } from '../../types';

// v10.0.248 (TD-1133, role guide): the stock page records a zero-price receipt or purchase line only after the user
// confirms donated goods (as the reorder alert has done since TD-830), and the reorder alert's direct document is only a
// final receipt: its draft option made a receipt no page could finalize, which stayed "in transit" for good.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const confirmAction = vi.fn();
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: toastError });
  return { toast: t, default: t };
});

import { useStockDocumentSubmit } from '../../hooks/documents/useStockDocumentSubmit';

const DRAFT_OPTION = 'پیش‌نویس سفارش خرید';
const DONATED_TITLE = 'کالای اهدایی';
const NO_COST_WORDS = 'میانگین موزون بها ندارد';

const user: User = { id: 1, username: 'storekeeper', full_name: 'Storekeeper', role: 'staff' };
const refData = { warehouses: [{ id: 1, name: 'WH', code: 'WH1', is_active: 1 }] } as unknown as StockDocumentReferenceData;
const bead = (wac: number | undefined) => ({ id: 4, type: 'raw_material', name: 'Bead', code: 'RM-4', current_stock: 5, unit: 'pcs', weighted_average_cost: wac }) as unknown as Item;

function formFor(overrides: Partial<StockDocumentForm>): StockDocumentForm {
  const noop = vi.fn();
  return {
    actionType: 'in', docType: 'receipt', refNumber: 'R-10', suggestedRef: 'R-10', date: '1405/07/15', location: 'WH1',
    buyerName: 'Supplier', currency: 'IRR', exchangeRate: 0, returnInvoiceId: null, returnVatPercent: '', notes: '',
    docItems: [{ item: bead(700), quantity: 2, unitPrice: 0 }], selectedProjectId: '', selectedProjectObj: null, attachments: [],
    getItemReservationSummary: (it: Item) => itemReservationSummary([], it, ''),
    setIsSaving: noop, setDocItems: noop, fetchNextRef: vi.fn(() => Promise.resolve()), changeReturnInvoiceRef: noop,
    setReturnVatPercent: noop, setBuyerName: noop, setSelectedSupplierObj: noop, setNotes: noop, setUnitPrice: noop,
    setQuantity: noop, setSelectedProjectId: noop, setSelectedProjectObj: noop, setAttachments: noop, setCurrency: noop,
    setExchangeRate: noop,
    ...overrides,
  } as unknown as StockDocumentForm;
}

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

async function submit(form: StockDocumentForm): Promise<boolean> {
  fetchJson.mockResolvedValue({ success: true, docId: 12 });
  const { result } = renderHook(() => useStockDocumentSubmit(form, refData, user), { wrapper });
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: () => undefined } as unknown as React.FormEvent);
  });
  return fetchJson.mock.calls.some(([url, init]) => url === '/documents' && init?.method === 'POST');
}

afterEach(() => { cleanup(); fetchJson.mockReset(); confirmAction.mockReset(); toastError.mockReset(); });

describe('TD-1133 zero-price receipt lines and the reorder direct document', () => {
  it('asks about donated goods for a zero-price receipt or purchase line, never for a return or priced lines', () => {
    expect(receiptZeroPriceCheck('receipt', [{ name: 'A', unitPrice: 0, weightedAverageCost: 500 }]).confirmMessage).toContain(DONATED_TITLE);
    expect(receiptZeroPriceCheck('purchase', [{ name: 'A', unitPrice: '', weightedAverageCost: undefined }]).confirmMessage).toContain('«A»');
    expect(receiptZeroPriceCheck('return', [{ name: 'A', unitPrice: 0, weightedAverageCost: 500 }])).toEqual({ error: null, confirmMessage: null });
    expect(receiptZeroPriceCheck('receipt', [{ name: 'A', unitPrice: 10, weightedAverageCost: 0 }])).toEqual({ error: null, confirmMessage: null });
  });

  it('refuses a zero-price line of an item known to have no weighted average cost', () => {
    const check = receiptZeroPriceCheck('receipt', [{ name: 'A', unitPrice: 0, weightedAverageCost: 0 }]);
    expect(check.error).toContain(NO_COST_WORDS);
    expect(check.confirmMessage).toBeNull();
  });

  it('the stock page records a zero-price receipt only after the donated goods confirmation', async () => {
    confirmAction.mockResolvedValue(false);
    expect(await submit(formFor({}))).toBe(false);
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(confirmAction.mock.calls[0][0]).toMatchObject({ title: DONATED_TITLE });

    confirmAction.mockReset();
    confirmAction.mockResolvedValue(true);
    expect(await submit(formFor({}))).toBe(true);
  });

  it('the stock page refuses a zero-price line of an item without cost and records priced lines without asking', async () => {
    expect(await submit(formFor({ docItems: [{ item: bead(0), quantity: 2, unitPrice: 0 }] }))).toBe(false);
    expect(toastError.mock.calls[0][0]).toContain(NO_COST_WORDS);
    expect(confirmAction).not.toHaveBeenCalled();

    expect(await submit(formFor({ docItems: [{ item: bead(700), quantity: 2, unitPrice: 900 }] }))).toBe(true);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('the reorder direct document offers no draft purchase order', () => {
    const fields = readFileSync('src/components/reorder/ReorderOrderFields.tsx', 'utf8');
    const modal = readFileSync('src/components/reorder/ReorderPurchaseModal.tsx', 'utf8');
    expect(fields).not.toContain(DRAFT_OPTION);
    expect(modal).not.toContain(DRAFT_OPTION);
    expect(fields).toContain('REORDER_DIRECT_DOCUMENT_LABEL');
    expect(REORDER_DIRECT_DOCUMENT_LABEL).toContain('رسید قطعی');
  });
});
