import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => [] }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import type { PieceworkPayroll } from '../../types';

afterEach(cleanup);

const noop = () => undefined;
// v10.1.71 (TD-1288): number fields show Persian digits and «٬» while typing
const SHOWN_REMAINDER = '۴۰۰٬۰۰۰';

// v9.0.322 (TD-814, B12P-11): the pay button inside a payslip gives the payment form what was already paid
describe('the payment form opened from a payslip takes its remainder (TD-814)', () => {
  it('a partly paid payslip of 1,000,000 with 600,000 paid offers 400,000, not the whole net', () => {
    const payroll: PieceworkPayroll = {
      id: 7, payrollNumber: 'PAY-7', personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
      totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 600000, status: 'partially_paid',
    };
    render(<PieceworkPayslipModal viewingPayroll={payroll} onClose={noop} onUpdateStatus={noop} onDeletePayroll={noop} />);
    fireEvent.click(screen.getByText('ثبت پرداخت (از خزانه)'));
    const amount = screen.getByPlaceholderText('مبلغ پرداختی...') as HTMLInputElement;
    expect(amount.value).toBe(SHOWN_REMAINDER);
    // v10.1.22 (TD-1273): the amount field is a text field; its max shows as an error under it and blocks the form
    fireEvent.change(amount, { target: { value: '500000' } });
    expect(amount.validity.valid).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('۴۰۰٬۰۰۰');
  });
});
