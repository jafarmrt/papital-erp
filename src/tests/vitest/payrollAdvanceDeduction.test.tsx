import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

let outstandingAdvance = 0;
vi.mock('../../api', () => ({ fetchJson: async () => ({ outstandingAdvance, totalAdvances: outstandingAdvance, totalDeducted: 0 }) }));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));

import { PieceworkPayrollModal } from '../../components/piecework/PieceworkPayrollModal';

afterEach(cleanup);

const noop = () => undefined;
const renderModal = (advanceDeduction: number) => render(
  <PieceworkPayrollModal
    isOpen onClose={noop} onSubmit={noop} personnelSelectOptions={[{ value: '5', label: 'کارگر' }]}
    payrollPersonnelId={5} setPayrollPersonnelId={noop} payrollStartDate="1405/01/01" setPayrollStartDate={noop}
    payrollEndDate="1405/01/31" setPayrollEndDate={noop} payrollBonuses={0} setPayrollBonuses={noop}
    payrollDeductions={0} setPayrollDeductions={noop} payrollNotes="" setPayrollNotes={noop}
    payrollPreviewLogs={[]} allowNoLogs advanceDeduction={advanceDeduction} setAdvanceDeduction={noop}
  />
);
const submitButton = () => screen.getByText('تایید و صدور فیش حقوقی').closest('button') as HTMLButtonElement;

// v8.0.29 (TD-282، تصمیم مالک محصول — گزینه الف): کسر مساعده بیش از مانده مساعده پرسنل پذیرفته نمی‌شود
describe('payroll advance deduction (TD-282)', () => {
  it('blocks issuing a payroll whose advance deduction exceeds the outstanding advance, also when it is zero', async () => {
    outstandingAdvance = 0;
    renderModal(300000);
    await waitFor(() => expect(screen.getByText(/فیش با این مبلغ صادر نمی‌شود/)).toBeTruthy());
    expect(submitButton().disabled).toBe(true);
  });

  it('allows a deduction up to the outstanding advance', async () => {
    outstandingAdvance = 200000;
    renderModal(200000);
    await waitFor(() => expect(screen.getByText('مانده مساعده تسویه‌نشده پرسنل در سیستم:', { exact: false })).toBeTruthy());
    expect(screen.queryByText(/فیش با این مبلغ صادر نمی‌شود/)).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });
});
