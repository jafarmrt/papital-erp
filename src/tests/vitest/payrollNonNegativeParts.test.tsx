import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => ({ outstandingAdvance: 500000, totalAdvances: 500000, totalDeducted: 0 }) }));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));

import { PieceworkPayrollModal } from '../../components/piecework/PieceworkPayrollModal';

afterEach(cleanup);

const noop = () => undefined;

function renderModal() {
  const setters = { bonuses: vi.fn(), deductions: vi.fn(), advance: vi.fn() };
  render(
    <PieceworkPayrollModal
      isOpen onClose={noop} onSubmit={noop} personnelSelectOptions={[{ value: '5', label: 'کارگر' }]}
      payrollPersonnelId={5} setPayrollPersonnelId={noop} payrollStartDate="1405/01/01" setPayrollStartDate={noop}
      payrollEndDate="1405/01/31" setPayrollEndDate={noop} payrollBonuses={0} setPayrollBonuses={setters.bonuses}
      payrollDeductions={0} setPayrollDeductions={setters.deductions} payrollNotes="" setPayrollNotes={noop}
      payrollPreviewLogs={[]} allowNoLogs advanceDeduction={0} setAdvanceDeduction={setters.advance}
    />
  );
  return setters;
}

const inputUnder = (label: RegExp) => screen.getByText(label).parentElement?.querySelector('input') as HTMLInputElement;

// v9.0.231 (TD-804, decision t1 «الف»): bonuses, deductions and the advance deduction of a payslip are never negative
describe('payslip parts are non-negative (TD-804)', () => {
  it('turns a negative bonus, deduction or advance deduction into zero and marks the fields min 0', () => {
    const setters = renderModal();
    const fields: Array<[HTMLInputElement, ReturnType<typeof vi.fn>]> = [
      [inputUnder(/پاداش \/ اضافه کار/), setters.bonuses],
      [inputUnder(/سایر کسورات/), setters.deductions],
      [screen.getByPlaceholderText('مبلغی که از مساعده قبلی پرسنل کسر می‌شود') as HTMLInputElement, setters.advance],
    ];
    for (const [input, setter] of fields) {
      expect(input.getAttribute('min')).toBe('0');
      fireEvent.change(input, { target: { value: '-5000' } });
      expect(setter).toHaveBeenLastCalledWith(0);
      fireEvent.change(input, { target: { value: '7000' } });
      expect(setter).toHaveBeenLastCalledWith(7000);
    }
  });
});
