import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => ({ outstandingAdvance: 0, totalAdvances: 0, totalDeducted: 0 }) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => '' }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { PieceworkPayrollModal } from '../../components/piecework/PieceworkPayrollModal';
import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import type { PieceworkPayroll } from '../../types';

afterEach(cleanup);

const noop = () => undefined;
const renderForm = (deductions: number, description: string) => render(
  <PieceworkPayrollModal
    isOpen onClose={noop} onSubmit={noop} personnelSelectOptions={[{ value: '5', label: 'کارگر' }]}
    payrollPersonnelId={5} setPayrollPersonnelId={noop} payrollStartDate="2026-09-23" setPayrollStartDate={noop}
    payrollEndDate="2026-10-22" setPayrollEndDate={noop} payrollBonuses={0} setPayrollBonuses={noop}
    payrollDeductions={deductions} setPayrollDeductions={noop} payrollDeductionsDescription={description} setPayrollDeductionsDescription={noop}
    payrollNotes="" setPayrollNotes={noop} payrollPreviewLogs={[]} allowNoLogs advanceDeduction={0} setAdvanceDeduction={noop}
  />,
);
const submit = () => screen.getByText('صدور فیش حقوقی پیش‌نویس').closest('button') as HTMLButtonElement;

// v9.0.329 (TD-861, owner decision t5): other deductions carry a description and claim no insurance or tax computation
describe('the deductions box needs a description (TD-861)', () => {
  it('drops the insurance and tax label and blocks issuing deductions without a description', () => {
    renderForm(150000, '');
    expect(screen.queryByText(/بیمه\/مالیات/)).toBeNull();
    expect((screen.getByLabelText('شرح سایر کسورات') as HTMLInputElement).required).toBe(true);
    expect(submit().disabled).toBe(true);
    cleanup();
    renderForm(150000, 'قسط وام صندوق');
    expect(submit().disabled).toBe(false);
    cleanup();
    renderForm(0, '');
    expect(screen.queryByLabelText('شرح سایر کسورات')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('the payslip prints the description beside the deductions', () => {
    const payroll: PieceworkPayroll = {
      id: 9, payrollNumber: 'PAY-9', personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
      totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 150000, deductionsDescription: 'قسط وام صندوق', netPayable: 850000,
      paidAmount: 0, status: 'approved', items: [],
    };
    render(<PieceworkPayslipModal viewingPayroll={payroll} onClose={noop} onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(screen.getByText('سایر کسورات (قسط وام صندوق):')).toBeTruthy();
  });
});
