import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReorderModalItem } from '../../lib/reorderAlerts/reorderItems';
import { reorderReceiptPriceError } from '../../lib/reorderAlerts/reorderPurchaseReceipt';

const mutate = vi.fn();
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => { const toast = { error: toastError, success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../hooks/reorderAlerts/useReorderAlertsQueries', () => ({
  useReorderSuppliersQuery: () => [{ id: 3, name: 'تأمین‌کننده الف', partyType: 'supplier' }],
}));
vi.mock('../../hooks/reorderAlerts/useReorderAlertsMutations', () => ({
  useReorderPurchaseSubmit: () => ({ mutate: (...args: unknown[]) => mutate(...args), isPending: false }),
}));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({
  useWarehousesQuery: () => ({ data: [{ id: 1, name: 'انبار اصلی', code: 'MAIN' }, { id: 2, name: 'انبار دوم', code: 'W2' }] }),
}));
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="supplier" value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  ),
}));
vi.mock('../../components/common/FinancialAmountInput', () => ({
  FinancialAmountInput: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <input aria-label="unit price" value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))} />
  ),
}));
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange }: { value: string; onChange: (iso: string) => void }) => (
    <input aria-label="order date" value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  ),
}));

import { ReorderPurchaseModal } from '../../components/reorder/ReorderPurchaseModal';
import { getTodayIsoDate } from '../../utils';

afterEach(() => { cleanup(); mutate.mockReset(); toastError.mockReset(); });

const line = (wac: number): ReorderModalItem => ({
  id: 7, name: 'مهره سفید', code: 'R-7', unit: 'عدد', current_stock: 0, reorder_point: 10, deficit: 10,
  weighted_average_cost: wac, type: 'raw_material', orderQty: 10, unitPrice: 0,
});

function openDirectFinal(item: ReorderModalItem) {
  render(<ReorderPurchaseModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} selectedItems={[item]} />);
  fireEvent.click(screen.getByText('صدور مستقیم سند انبار / خرید'));
  fireEvent.change(screen.getByLabelText('supplier'), { target: { value: 'تأمین‌کننده الف' } });
  fireEvent.change(screen.getByDisplayValue('پیش‌نویس سفارش خرید (عدم تغییر موجودی)'), { target: { value: 'final' } });
}
const submit = () => fireEvent.click(screen.getByText('ثبت سند خرید انبار'));
const sentPayload = () => (mutate.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;

// v9.0.403 (TD-830، یافته B07-14): رسید نهایی از هشدار نقطه سفارش با بهای صفر برای کالای بی میانگین موزون بها رد می‌شود و
// برای کالای دارای بها فقط با تأیید «کالای اهدایی» پذیرفته می‌شود؛ انبار مقصد و تاریخ (ISO با JalaliDateInput) انتخاب‌شدنی‌اند.
// پیش‌تر رسید نهایی ۱۰ × ۰ بی هشدار ثبت می‌شد، انبار setter نداشت و تاریخ کادر متنی شمسی بود.
describe('reorder purchase receipt at price zero, warehouse and date (TD-830)', () => {
  it('refuses a final receipt at price zero for an item without cost', () => {
    openDirectFinal(line(0));
    submit();
    expect(mutate).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0]?.[0])).toContain('میانگین موزون بها ندارد');
  });

  it('accepts price zero for an item with cost only as donated goods', () => {
    openDirectFinal(line(5000));
    fireEvent.change(screen.getByLabelText('unit price'), { target: { value: '0' } });
    submit();
    expect(mutate).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0]?.[0])).toContain('کالای اهدایی');
    fireEvent.click(screen.getByRole('checkbox'));
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect((sentPayload().items as Array<{ unit_price: number }>)[0].unit_price).toBe(0);
  });

  it('sends the chosen warehouse and the ISO date', () => {
    openDirectFinal(line(5000));
    expect((screen.getByLabelText(/انبار مقصد/) as HTMLSelectElement).value).toBe('MAIN');
    fireEvent.change(screen.getByLabelText(/انبار مقصد/), { target: { value: 'W2' } });
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sentPayload().location).toBe('W2');
    expect(sentPayload().date).toBe(getTodayIsoDate());
    expect(sentPayload().status).toBe('final');
  });

  it('dates a requisition with the picker in ISO', () => {
    render(<ReorderPurchaseModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} selectedItems={[line(5000)]} />);
    fireEvent.change(screen.getByLabelText('order date'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByText('ثبت و ارسال درخواست خرید'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sentPayload().requiredDate).toBe('2026-10-20');
  });

  it('leaves drafts and priced lines alone', () => {
    const items = [{ name: 'الف', unitPrice: 0, weighted_average_cost: 0 }];
    expect(reorderReceiptPriceError({ status: 'draft', donatedConfirmed: false, items })).toBeNull();
    expect(reorderReceiptPriceError({ status: 'final', donatedConfirmed: false, items: [{ name: 'ب', unitPrice: 10, weighted_average_cost: 0 }] })).toBeNull();
    expect(reorderReceiptPriceError({ status: 'final', donatedConfirmed: true, items })).toContain('میانگین موزون بها ندارد');
  });
});
