import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const viewer = { current: { id: 9, isAdmin: false } as { id: number; isAdmin: boolean } | null };
vi.mock('../../contexts/AuthContext', async () => ({
  ...(await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext')),
  useViewerIdentity: () => viewer.current,
}));
vi.mock('../../api', () => ({ fetchJson: async () => ({}) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canApprovePayroll: true, canPay: true }),
}));

import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import { payrollIssuerDutyRefusal } from '../../lib/payroll/payrollDuties';
import type { PieceworkPayroll } from '../../types';

afterEach(cleanup);

const noop = () => undefined;
const payslip = (id: number, status: PieceworkPayroll['status'], createdById: number | null): PieceworkPayroll => ({
  id, payrollNumber: `PAY-${id}`, personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
  totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 0, status, createdById,
});
const button = (text: string) => screen.getByText(text).closest('button') as HTMLButtonElement;

// v10.0.182 (TD-1083 / TD-1084, payroll duties plan t2 / t3 «الف»): the issuer sees approve and pay disabled with the reason
describe('the issuer of a payslip neither approves nor pays it (TD-1084)', () => {
  it('the shared rule spares other users, the system admin and a payslip without an issuer', () => {
    const own = { createdById: 9 };
    expect(payrollIssuerDutyRefusal(own, { id: 9, isAdmin: false }, 'approve')).toContain('تأیید آن با کاربر دیگری است');
    expect(payrollIssuerDutyRefusal(own, { id: 9, isAdmin: false }, 'pay')).toContain('پرداخت آن');
    expect(payrollIssuerDutyRefusal(own, { id: 4, isAdmin: false }, 'approve')).toBeNull();
    expect(payrollIssuerDutyRefusal(own, { id: 9, isAdmin: true }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal({ createdById: null }, { id: 9, isAdmin: false }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal(own, null, 'pay')).toBeNull();
  });

  it('disables approve and pay in the list for the issuer, with the reason', () => {
    viewer.current = { id: 9, isAdmin: false };
    render(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft', 9), payslip(2, 'approved', 9)]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(true);
    expect(button('تأیید فیش').title).toContain('خودتان صادر کرده‌اید');
    expect(button('ثبت پرداخت').disabled).toBe(true);
    cleanup();
    viewer.current = { id: 4, isAdmin: false };
    render(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft', 9), payslip(2, 'approved', 9)]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(false);
    expect(button('ثبت پرداخت').disabled).toBe(false);
  });

  it('the payslip window disables approve and pay for the issuer and offers back to draft on an unpaid approved payslip', () => {
    viewer.current = { id: 9, isAdmin: false };
    const onUpdateStatus = vi.fn();
    const { unmount } = render(<PieceworkPayslipModal viewingPayroll={payslip(3, 'draft', 9)} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(true);
    unmount();
    render(<PieceworkPayslipModal viewingPayroll={payslip(4, 'approved', 9)} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(button('ثبت پرداخت (از خزانه)').disabled).toBe(true);
    button('بازگشت به پیش‌نویس').click();
    expect(onUpdateStatus).toHaveBeenCalledWith(4, 'draft');
  });
});
