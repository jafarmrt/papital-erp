import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => ({}) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
// v9.0.320 (TD-805): the payroll buttons follow their keys; this test grants all of them
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canApprovePayroll: true, canPay: true }),
}));

import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import type { PieceworkPayroll } from '../../types';

afterEach(cleanup);

const noop = () => undefined;
const payslip = (id: number, status: PieceworkPayroll['status']): PieceworkPayroll => ({
  id, payrollNumber: `PAY-${id}`, personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
  totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 0, status,
});

// v9.0.269 (TD-816): a draft payslip offers approval, never a payment
describe('a draft payslip is not payable (TD-816)', () => {
  it('shows approve instead of pay for a draft in the payslip list', () => {
    const onUpdateStatus = vi.fn();
    render(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft'), payslip(2, 'approved')]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(screen.getAllByText('ثبت پرداخت')).toHaveLength(1);
    fireEvent.click(screen.getByText('تأیید فیش'));
    expect(onUpdateStatus).toHaveBeenCalledWith(1, 'approved');
  });

  it('offers no payment on a draft payslip and one on an approved payslip', () => {
    const onUpdateStatus = vi.fn();
    const { unmount } = render(<PieceworkPayslipModal viewingPayroll={payslip(3, 'draft')} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(screen.queryByText('ثبت پرداخت (از خزانه)')).toBeNull();
    fireEvent.click(screen.getByText('تأیید فیش'));
    expect(onUpdateStatus).toHaveBeenCalledWith(3, 'approved');
    unmount();
    render(<PieceworkPayslipModal viewingPayroll={payslip(4, 'approved')} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(screen.getByText('ثبت پرداخت (از خزانه)')).toBeTruthy();
    expect(screen.queryByText('تأیید فیش')).toBeNull();
  });
});
