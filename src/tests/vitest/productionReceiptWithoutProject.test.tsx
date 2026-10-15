import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { receiptZeroPriceCheck } from '../../lib/documents/receiptZeroPrice';
import { itemReservationSummary } from '../../lib/documents/stockReservations';
import type { StockDocumentForm } from '../../hooks/documents/useStockDocumentForm';
import type { StockDocumentReferenceData } from '../../hooks/documents/useStockDocumentReferenceData';
import type { Item, User } from '../../types';

// v10.1.6 (N-06, TD-1262, decision t26): the stock page records a production receipt without a project as a rial document
// with no party; an empty unit price means the item's current weighted average cost (never donated goods), and a product
// without a weighted average cost needs its material cost.
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

const NO_COST_WORDS = 'میانگین موزون بها ندارد';

const user: User = { id: 1, username: 'workshop', full_name: 'Workshop', role: 'staff' };
const refData = { warehouses: [{ id: 1, name: 'WH', code: 'WH1', is_active: 1 }] } as unknown as StockDocumentReferenceData;
const necklace = (wac: number | undefined) => ({ id: 9, type: 'product', name: 'Necklace', code: 'P-9', current_stock: 0, unit: 'pcs', weighted_average_cost: wac }) as unknown as Item;

function productionForm(overrides: Partial<StockDocumentForm>): StockDocumentForm {
  const noop = vi.fn();
  return {
    actionType: 'in', docType: 'production_receipt', refNumber: 'PR-3', suggestedRef: 'PR-3', date: '1405/07/23', location: 'WH1',
    buyerName: 'Left over supplier', currency: 'USD', exchangeRate: 600000, returnInvoiceId: null, returnVatPercent: '', notes: '',
    docItems: [{ item: necklace(1200), quantity: 3, unitPrice: 0 }], selectedProjectId: '', selectedProjectObj: null, attachments: [],
    selectedSupplierObj: { id: 44, name: 'Left over supplier' },
    getItemReservationSummary: (it: Item) => itemReservationSummary([], it, ''),
    setIsSaving: noop, setDocItems: noop, fetchNextRef: vi.fn(() => Promise.resolve()), changeReturnInvoiceRef: noop,
    setReturnVatPercent: noop, setBuyerName: noop, setReceiverPersonnelId: noop, setSelectedSupplierObj: noop, setNotes: noop,
    setUnitPrice: noop, setQuantity: noop, setSelectedProjectId: noop, setSelectedProjectObj: noop, setAttachments: noop,
    setCurrency: noop, setExchangeRate: noop,
    ...overrides,
  } as unknown as StockDocumentForm;
}

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

async function submit(form: StockDocumentForm): Promise<Record<string, unknown> | null> {
  fetchJson.mockResolvedValue({ success: true, docId: 31 });
  const { result } = renderHook(() => useStockDocumentSubmit(form, refData, user), { wrapper });
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: () => undefined } as unknown as React.FormEvent);
  });
  const call = fetchJson.mock.calls.find(([url, init]) => url === '/documents' && init?.method === 'POST');
  return call ? JSON.parse(String(call[1].body)) as Record<string, unknown> : null;
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  confirmAction.mockReset();
  toastError.mockReset();
});

describe('production receipt without a project on the stock page (N-06)', () => {
  it('an empty price of a product with a weighted average cost is neither an error nor donated goods', () => {
    expect(receiptZeroPriceCheck('production_receipt', [{ name: 'Necklace', unitPrice: 0, weightedAverageCost: 1200 }]))
      .toEqual({ error: null, confirmMessage: null });
    expect(receiptZeroPriceCheck('production_receipt', [{ name: 'Necklace', unitPrice: '', weightedAverageCost: undefined }]))
      .toEqual({ error: null, confirmMessage: null });
    const noCost = receiptZeroPriceCheck('production_receipt', [{ name: 'Necklace', unitPrice: 0, weightedAverageCost: 0 }]);
    expect(noCost.confirmMessage).toBeNull();
    expect(noCost.error).toContain(NO_COST_WORDS);
    expect(receiptZeroPriceCheck('receipt', [{ name: 'Necklace', unitPrice: 0, weightedAverageCost: 1200 }]).confirmMessage).not.toBeNull();
  });

  it('posts a final rial production receipt with no party, whatever the form held before, and asks no donated-goods question', async () => {
    const body = await submit(productionForm({}));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(body).toMatchObject({ docType: 'production_receipt', status: 'final', inOut: 'in', currency: 'IRR', exchangeRate: null, buyer_name: '' });
    expect(body?.partyId).toBeUndefined();
    expect(body?.projectId).toBeUndefined();
    expect(body?.items).toEqual([{ itemId: 9, quantity: 3, unit_price: 0 }]);
  });

  it('refuses before sending a zero-price product that has no weighted average cost', async () => {
    const body = await submit(productionForm({ docItems: [{ item: necklace(0), quantity: 1, unitPrice: 0 }] } as Partial<StockDocumentForm>));
    expect(body).toBeNull();
    expect(String(toastError.mock.calls[0]?.[0])).toContain(NO_COST_WORDS);
  });
});
