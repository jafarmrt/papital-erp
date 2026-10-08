import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
const toastError = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ toast: { error: (msg: string) => toastError(msg), success: () => undefined } }));
// مرجع پایدار، مانند داده react-query؛ آرایه تازه در هر رندر useEffect انبارهای فرم را بی‌پایان اجرا می‌کند
const { warehousesResult, suppliersResult } = vi.hoisted(() => ({
  warehousesResult: { data: [{ id: 1, code: 'WH1', name: 'انبار مرکزی' }] },
  suppliersResult: { options: [] },
}));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => warehousesResult }));
vi.mock('../../hooks/useEntitySelectors', () => ({ useSupplierSelectOptions: () => suppliersResult }));
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="تامین‌کننده" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import { SplitOrderModal } from '../../components/procurement/SplitOrderModal';

const requisition = {
  id: 5, code: 'PR-1405-0005', title: 'درخواست آزمون', status: 'approved', notes: '',
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ فیروزه', unit: 'عدد', requestedQty: 10, orderedQty: 0, remainingQty: 10, unitPriceEstimate: 1000 }],
} as unknown as PurchaseRequisition;

const renderModal = () => render(<SplitOrderModal isOpen requisition={requisition} onClose={() => undefined} onSuccess={() => undefined} />);
const submit = () => fireEvent.click(screen.getByText('ثبت و صدور سفارش‌های خرید تفکیکی'));
const sentBody = () => JSON.parse(String((fetchJson.mock.calls[0][1] as { body: string }).body)) as Record<string, unknown>;

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockResolvedValue({ success: true, message: 'ok' });
  toastError.mockReset();
});
afterEach(cleanup);

// v8.0.38 (TD-289، تصمیم مالک محصول — گزینه ب): سفارش بیش از مانده درخواست با هشدار و دلیل الزامی
describe('split order over-ordering (TD-289)', () => {
  it('sends no reason and shows no warning when the packages stay within the requisition', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('تامین‌کننده'), { target: { value: 'تامین‌کننده الف' } });
    expect(screen.queryByText('سفارش بیش از درخواست')).toBeNull();
    submit();
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));
    expect(sentBody().overOrderReason).toBeUndefined();
  });

  it('warns about the excess and blocks submitting until a reason is entered, then sends it', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('تامین‌کننده'), { target: { value: 'تامین‌کننده الف' } });
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '12' } });

    expect(screen.getByText('سفارش بیش از درخواست')).toBeTruthy();
    expect(screen.getByText(/«سنگ فیروزه»: ۲ عدد بیش از مانده درخواست/)).toBeTruthy();

    submit();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('دلیل سفارش بیش از درخواست'));

    fireEvent.change(screen.getByPlaceholderText('مثال: حداقل تیراژ تامین‌کننده ۲۰ عدد است'), { target: { value: 'پک ۱۲ تایی' } });
    submit();
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));
    expect(sentBody().overOrderReason).toBe('پک ۱۲ تایی');
  });
});
