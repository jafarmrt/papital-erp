import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithQuery } from './helpers/queryWrapper';

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

// v10.0.193 (TD-1083 / TD-1084, payroll duties plan t2 / t3 «الف»): the issuer sees approve and pay disabled with the reason
describe('the issuer of a payslip does not approve it, and pays it only once another user approved it (TD-1084, v11)', () => {
  it('the shared rule spares other users, the system admin and a payslip without an issuer', () => {
    const own = { createdById: 9 };
    expect(payrollIssuerDutyRefusal(own, { id: 9, isAdmin: false }, 'approve')).toContain('تأیید آن با کاربر دیگری است');
    expect(payrollIssuerDutyRefusal({ ...own, status: 'draft' }, { id: 9, isAdmin: false }, 'pay')).toContain('پس از تأیید کاربر دیگری');
    // v11: once another user approved it, the issuer pays it and voids its payment
    expect(payrollIssuerDutyRefusal({ ...own, status: 'approved' }, { id: 9, isAdmin: false }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal({ ...own, status: 'partially_paid' }, { id: 9, isAdmin: false }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal(own, { id: 4, isAdmin: false }, 'approve')).toBeNull();
    expect(payrollIssuerDutyRefusal(own, { id: 9, isAdmin: true }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal({ createdById: null }, { id: 9, isAdmin: false }, 'pay')).toBeNull();
    expect(payrollIssuerDutyRefusal(own, null, 'pay')).toBeNull();
  });

  it('disables approve in the list for the issuer, with the reason, and leaves pay on an approved payslip', () => {
    viewer.current = { id: 9, isAdmin: false };
    renderWithQuery(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft', 9), payslip(2, 'approved', 9)]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(true);
    expect(button('تأیید فیش').title).toContain('خودتان صادر کرده‌اید');
    expect(button('ثبت پرداخت').disabled).toBe(false); // approved by another user: the issuer pays it
    cleanup();
    viewer.current = { id: 4, isAdmin: false };
    renderWithQuery(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft', 9), payslip(2, 'approved', 9)]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(false);
    expect(button('ثبت پرداخت').disabled).toBe(false);
  });

  it('the payslip window disables approve for the issuer, leaves pay on an approved payslip, and offers back to draft on an unpaid approved payslip', () => {
    viewer.current = { id: 9, isAdmin: false };
    const onUpdateStatus = vi.fn();
    const { unmount } = renderWithQuery(<PieceworkPayslipModal viewingPayroll={payslip(3, 'draft', 9)} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(button('تأیید فیش').disabled).toBe(true);
    unmount();
    renderWithQuery(<PieceworkPayslipModal viewingPayroll={payslip(4, 'approved', 9)} onClose={noop} onUpdateStatus={onUpdateStatus} onDeletePayroll={noop} />);
    expect(button('ثبت پرداخت (از خزانه)').disabled).toBe(false);
    button('بازگشت به پیش‌نویس').click();
    expect(onUpdateStatus).toHaveBeenCalledWith(4, 'draft');
  });
});
