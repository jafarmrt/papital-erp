import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PAYMENTS = [
  { id: 11, transactionNumber: 'PAY-T-11', amount: 600000, status: 'completed', bankAccountTitle: 'بانک آزمون', date: '2026-05-01' },
  { id: 12, transactionNumber: 'PAY-T-12', amount: 400000, status: 'voided', bankAccountTitle: 'بانک آزمون', date: '2026-05-02' },
];
const fetchJson = vi.fn(async (url: string, _opts?: { method?: string; body?: string }) => {
  if (url === '/accounting/bank-accounts') return [];
  if (url === '/piecework/payrolls/7/payments') return PAYMENTS;
  return { message: 'پرداخت ابطال شد' };
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: { method?: string; body?: string }) => fetchJson(url, opts) }));
// v9.0.286 (TD-805): the payroll buttons follow their keys; this test grants all of them
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';

afterEach(cleanup);

// v8.0.31 (TD-283، تصمیم مالک محصول — گزینه الف): پرداخت فیش از سابقه پرداخت‌های پنجره پرداخت ابطال می‌شود
describe('payroll payment void (TD-283)', () => {
  it('lists voided payments without a void button and voids a payment with a reason', async () => {
    const onPaid = vi.fn();
    render(<PayrollPaymentModal payroll={{ id: 7, payrollNumber: 'PAY-7', netPayable: 1000000, paidAmount: 600000, status: 'partially_paid' }} onClose={() => undefined} onPaid={onPaid} />);
    fireEvent.click(await screen.findByText(/سابقه واریزهای قبلی/));
    const voidButtons = await screen.findAllByText('ابطال پرداخت');
    expect(voidButtons).toHaveLength(1);
    expect(screen.getByText('ابطال‌شده')).toBeTruthy();

    fireEvent.click(voidButtons[0]);
    fireEvent.change(await screen.findByPlaceholderText(/اشتباه در مبلغ/), { target: { value: 'ثبت اشتباه' } });
    fireEvent.click(screen.getByText('ابطال با سند معکوس'));
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    const call = fetchJson.mock.calls.find(([url]) => url === '/piecework/payrolls/7/payments/11/void');
    expect(call?.[1]?.method).toBe('POST');
    expect(JSON.parse(call?.[1]?.body ?? '{}')).toEqual({ reason: 'ثبت اشتباه' });
  });

  it('opens the payment history of a fully paid payroll', async () => {
    render(<PayrollPaymentModal payroll={{ id: 7, payrollNumber: 'PAY-7', netPayable: 1000000, paidAmount: 1000000, status: 'paid' }} onClose={() => undefined} />);
    expect(await screen.findByText('ابطال پرداخت')).toBeTruthy();
  });
});
