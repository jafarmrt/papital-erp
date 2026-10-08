import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
// the server's refusal of a payment dated after the business today (TREASURY_DATE_IN_FUTURE)
const SERVER_FUTURE_DATE_MESSAGE = 'تاریخ پرداخت (۱۴۰۵/۰۸/۱۰) نمی‌تواند پس از امروز (۱۴۰۵/۰۷/۱۶) باشد.';
const PAYMENT_SAVED_MESSAGE = 'پرداخت ثبت شد';
const SUBMIT_FULL_SETTLEMENT = 'ثبت تسویه کامل';
const BANK_TITLE = 'صندوق آزمون';

const payments: Array<Record<string, unknown>> = [];
let refuseWith: string | null = null;
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts) => {
  if (url === '/accounting/bank-accounts/options') return [{ id: 3, code: 'B-3', title: BANK_TITLE, type: 'cash', currency: 'IRR', hasLedgerAccount: true }];
  if (url === '/piecework/payrolls/7/payments') return [];
  if (url === '/piecework/payrolls/7/register-payment' && opts?.method === 'POST') {
    payments.push(JSON.parse(opts.body ?? '{}') as Record<string, unknown>);
    if (refuseWith) throw new Error(refuseWith);
    return { message: PAYMENT_SAVED_MESSAGE };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: (msg: string) => toastError(msg) } }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: false, canLog: false, canIssuePayroll: false, canPay: true }),
}));
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ value, onChange }: { value: string; onChange: (iso: string) => void }) => (
    <input aria-label="payment date" value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  ),
}));

import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';
import { getTodayIsoDate } from '../../utils';

afterEach(() => {
  cleanup();
  payments.length = 0;
  refuseWith = null;
  toastError.mockClear();
});

const renderModal = (onClose = vi.fn()) => {
  render(<PayrollPaymentModal payroll={{ id: 7, payrollNumber: 'PAY-7', netPayable: 900000, paidAmount: 0, status: 'approved' }} onClose={onClose} />);
  return onClose;
};

const chooseBank = async () => {
  await screen.findByText(BANK_TITLE);
  const bankSelect = screen.getAllByRole('combobox').find(el => el.querySelector('option[value="3"]'));
  if (!bankSelect) throw new Error('bank select not found');
  fireEvent.change(bankSelect, { target: { value: '3' } });
};

// v9.0.453 (TD-927, P5-W04): the payment date is an ISO date from JalaliDateInput, and the server's refusal reaches the user
describe('payroll payment date (TD-927)', () => {
  it('sends the business today as an ISO date by default', async () => {
    const onClose = renderModal();
    await chooseBank();
    fireEvent.click(screen.getByText(SUBMIT_FULL_SETTLEMENT));
    await waitFor(() => expect(payments).toHaveLength(1));
    expect(payments[0].paymentDate).toBe(getTodayIsoDate());
    expect(String(payments[0].paymentDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends the date chosen in the picker and shows the server message when the date is refused', async () => {
    refuseWith = SERVER_FUTURE_DATE_MESSAGE;
    const onClose = renderModal();
    await chooseBank();
    fireEvent.change(screen.getByLabelText('payment date'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByText(SUBMIT_FULL_SETTLEMENT));
    await waitFor(() => expect(payments).toHaveLength(1));
    expect(payments[0].paymentDate).toBe('2026-11-01');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(SERVER_FUTURE_DATE_MESSAGE));
    expect(onClose).not.toHaveBeenCalled();
  });
});
