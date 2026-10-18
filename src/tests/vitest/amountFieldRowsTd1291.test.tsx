import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({})) }));

import { VoucherItemsTable, type VoucherItemDraft } from '../../components/accounting/VoucherItemsTable';
import { useStockDocumentSubmit } from '../../hooks/documents/useStockDocumentSubmit';
import type { StockDocumentForm } from '../../hooks/documents/useStockDocumentForm';
import type { StockDocumentReferenceData } from '../../hooks/documents/useStockDocumentReferenceData';
import { itemReservationSummary } from '../../lib/documents/stockReservations';
import { withRowKeys } from '../../lib/rowKey';
import type { Item, User } from '../../types';

afterEach(() => { cleanup(); vi.mocked(toast.error).mockReset(); });

/** Persian text the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  twelveTypedGroupFive: '۱۲٬۵',
  groupKey: '٬',
  deleteRow: 'حذف سطر (Alt+D)',
  rateRequired: 'نرخ تسعیر الزامی است',
} as const;

async function nextFrame() {
  await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); });
}

/** a key typed where the caret is, as a browser reports it, then the frame in which the field places its caret */
async function typeKeys(input: HTMLInputElement, keys: string[]) {
  for (const key of keys) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const caret = start + key.length;
    fireEvent.change(input, { target: { value: input.value.slice(0, start) + key + input.value.slice(end), selectionStart: caret, selectionEnd: caret } });
    await nextFrame();
  }
}

describe('TD-1291 a misplaced thousands separator stays with its own field and is the only message', () => {
  it('deleting a voucher row whose debit holds 12,5 does not move the text or its error to the next row', async () => {
    const blank: VoucherItemDraft = { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' };
    function VoucherHost() {
      const [items, setItems] = useState<VoucherItemDraft[]>(() => withRowKeys<VoucherItemDraft>([{ ...blank }, { ...blank }]));
      const refs = useRef([0, 1].map(() => ({ debitRef: { current: null }, creditRef: { current: null } })));
      return (
        <form>
          <VoucherItemsTable items={items} selectableAccounts={[]} customers={[]} personnelList={[]} header={{ currency: 'IRR' }}
            updateItem={(i, patch) => setItems(prev => prev.map((it, n) => (n === i ? { ...it, ...patch } : it)))}
            addRow={() => undefined} removeRow={i => setItems(prev => prev.filter((_, n) => n !== i))} handleAutoBalanceRow={() => undefined}
            handleSwapDebitCredit={() => undefined} rowRefs={refs} />
        </form>
      );
    }
    render(<QueryClientProvider client={new QueryClient()}><VoucherHost /></QueryClientProvider>);
    const amountFields = () => screen.getAllByRole('textbox').filter(el => el.getAttribute('data-decimal-input') !== null) as HTMLInputElement[];
    const [debit] = amountFields();
    debit.focus();
    await typeKeys(debit, ['1', '2', SHOWN.groupKey, '5']);
    expect(debit.validity.valid).toBe(false);
    fireEvent.click(screen.getAllByTitle(SHOWN.deleteRow)[0]);
    const remaining = amountFields();
    expect(remaining.every(el => el.value !== SHOWN.twelveTypedGroupFive)).toBe(true);
    expect(remaining.every(el => el.validity.valid)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the stock form with 12,5 in its exchange rate field reports that field only, not that the rate is required', async () => {
    const noop = vi.fn();
    const item = { id: 4, type: 'raw_material', name: 'Bead', code: 'RM-4', current_stock: 5, unit: 'pcs', weighted_average_cost: 700 } as unknown as Item;
    const form = {
      actionType: 'in', docType: 'receipt', refNumber: 'R-10', suggestedRef: 'R-10', date: '1405/07/15', location: 'WH1',
      buyerName: 'Supplier', currency: 'USD', exchangeRate: 0, returnInvoiceId: null, returnVatPercent: '', notes: '',
      docItems: [{ item, quantity: 2, unitPrice: 10 }], selectedProjectId: '', selectedProjectObj: null, attachments: [],
      getItemReservationSummary: (it: Item) => itemReservationSummary([], it, ''),
      setIsSaving: noop, setDocItems: noop, fetchNextRef: vi.fn(() => Promise.resolve()), changeReturnInvoiceRef: noop,
      setReturnVatPercent: noop, setBuyerName: noop, setSelectedSupplierObj: noop, setNotes: noop, setUnitPrice: noop,
      setQuantity: noop, setSelectedProjectId: noop, setSelectedProjectObj: noop, setAttachments: noop, setCurrency: noop,
      setExchangeRate: noop,
    } as unknown as StockDocumentForm;
    const refData = { warehouses: [{ id: 1, name: 'WH', code: 'WH1', is_active: 1 }] } as unknown as StockDocumentReferenceData;
    const user: User = { id: 1, username: 'storekeeper', full_name: 'Storekeeper', role: 'staff' };
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useStockDocumentSubmit(form, refData, user), { wrapper });

    const formEl = document.createElement('form');
    const rateInput = document.createElement('input');
    formEl.appendChild(rateInput);
    document.body.appendChild(formEl);
    rateInput.setCustomValidity('separator error');
    const reportValidity = vi.spyOn(formEl, 'reportValidity');
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => undefined, currentTarget: formEl } as unknown as FormEvent);
    });
    expect(reportValidity).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    // the same form with a valid field still says the rate is required
    rateInput.setCustomValidity('');
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => undefined, currentTarget: formEl } as unknown as FormEvent);
    });
    expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).toContain(SHOWN.rateRequired);
    formEl.remove();
  });
});
