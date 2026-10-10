import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Cheque } from '../../types';
import { toPersianDigits } from '../../utils';

vi.mock('../../hooks/accounting/useChequeQueries', () => ({ useChequeReconciliationReport: () => ({ data: [], loading: false }) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: async () => false }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (...args: unknown[]) => toastError(...args), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { ChequesTab } from '../../components/accounting/ChequesTab';
import { CHEQUE_STATUS_LABELS, chequeStatusLabel } from '../../lib/treasury/chequeTransitions';

afterEach(() => { cleanup(); toastError.mockReset(); });

const cheque = {
  id: 1, type: 'received', chequeNumber: '100009', bankName: 'ملت', issueDate: '2026-09-30', dueDate: '2026-12-01',
  amount: 6_000_000, currency: 'IRR', partyName: 'مشتری نمونه', status: 'in_collection',
  statusHistory: [
    { date: '2026-09-30', status: 'received', user: 'مدیر', notes: 'ثبت اولیه چک دریافتی' },
    { date: '2026-10-01', status: 'in_collection', user: 'مدیر', notes: 'ارسال به بانک ملت شعبه بازار' },
  ],
} as unknown as Cheque;

function renderTab() {
  render(
    <ChequesTab cheques={[cheque]} bankAccounts={[]} customers={[]} personnelList={[]} loading={false} onRefresh={() => undefined}
      onCreateCheque={async () => undefined} onUpdateStatus={async () => undefined} onDeleteCheque={async () => undefined} />,
  );
}

function openMenuItem(label: string) {
  const row = screen.getAllByText(toPersianDigits('100009'))[0].closest('tr');
  if (!row) throw new Error('no cheque row');
  fireEvent.click(row.querySelector('button[title="عملیات بیشتر"]') as HTMLButtonElement);
  const item = Array.from(row.querySelectorAll('div.absolute button')).find(b => (b.textContent ?? '').trim() === label);
  if (!item) throw new Error(`no menu item ${label}`);
  fireEvent.click(item);
}

// v9.0.105 (TD-513, B04-17): the history window reads the notes the server writes, statuses are Persian everywhere,
// the status filter offers «در خزانه / صندوق», and a failed copy says so without «کلیپ‌بورد».
/** The filter option label of the in-treasury status */
const IN_TREASURY_LABEL = 'در خزانه / صندوق';

describe('cheque history, status wording and filter (TD-513)', () => {
  it('the history window shows each step note the server stored in notes', () => {
    renderTab();
    openMenuItem('تاریخچه گردش وضعیت');
    expect(screen.getByText('ثبت اولیه چک دریافتی')).toBeTruthy();
    expect(screen.getByText('ارسال به بانک ملت شعبه بازار')).toBeTruthy();
  });

  it('the status filter offers every status, including in treasury', () => {
    renderTab();
    const options = Array.from(document.querySelectorAll('option')).map(o => [o.value, o.textContent]);
    expect(options).toContainEqual(['in_treasury', IN_TREASURY_LABEL]);
    for (const status of Object.keys(CHEQUE_STATUS_LABELS)) expect(options.some(([value]) => value === status)).toBe(true);
  });

  it('a failed copy is reported without the Persian word for "clipboard"', async () => {
    renderTab();
    openMenuItem('کپی شماره چک');
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).not.toContain('کلیپ‌بورد');
  });

  it('every status has a Persian label and an unknown one is not shown as a code', () => {
    expect(chequeStatusLabel('passed')).toBe('وصول شده (پاس شده)');
    expect(chequeStatusLabel('in_collection')).toBe('در جریان وصول (خوابانده به حساب)');
    expect(chequeStatusLabel('weird_status')).toBe('نامشخص');
  });
});
