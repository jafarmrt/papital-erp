import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { fixedSalaryPeriodStart, payrollPrepaymentError, serviceStartOf } from '../../lib/payroll/payrollPeriod';
import { PayrollPrepaymentField, PrepaymentNotice, prepaymentNeedsReason } from '../../components/piecework/PayrollPrepaymentField';

// v10.0.183 (TD-1085, TD-1086): the prepayment and service start rules shared by the server and the payslip form
describe('prepayment payslip and service start rules (TD-1085, TD-1086)', () => {
  it('starts fixed salary on the service start date, and none for a period before it', () => {
    expect(serviceStartOf({ startDate: '1405/01/26' })).toBe('2026-04-15');
    expect(serviceStartOf({ startDate: '' })).toBeNull();
    expect(fixedSalaryPeriodStart('2026-03-21', '2026-04-20', '2026-04-15')).toBe('2026-04-15');
    expect(fixedSalaryPeriodStart('2026-04-21', '2026-05-21', '2026-04-15')).toBe('2026-04-21');
    expect(fixedSalaryPeriodStart('2026-03-21', '2026-04-20', '2026-05-22')).toBeNull();
    expect(fixedSalaryPeriodStart('2026-03-21', '2026-04-20', null)).toBe('2026-03-21');
  });

  it('accepts a future period only as a prepayment with a reason', () => {
    expect(payrollPrepaymentError('2026-10-07', '2026-10-07', {})).toBeNull();
    expect(payrollPrepaymentError('2026-12-21', '2026-10-07', {})?.code).toBe('PAYROLL_PERIOD_IN_FUTURE');
    expect(payrollPrepaymentError('2026-12-21', '2026-10-07', { isPrepayment: true, prepaymentReason: ' ' })?.code).toBe('PAYROLL_PREPAYMENT_REASON_REQUIRED');
    expect(payrollPrepaymentError('2026-09-30', '2026-10-07', { isPrepayment: true, prepaymentReason: 'x' })?.code).toBe('PAYROLL_PREPAYMENT_NOT_FUTURE');
    expect(payrollPrepaymentError('2026-12-21', '2026-10-07', { isPrepayment: true, prepaymentReason: 'نوروز' })).toBeNull();
  });

  it('asks for the reason once the prepayment is ticked and shows the reason on the payslip', () => {
    const setIsPrepayment = vi.fn();
    const state = { isPrepayment: false, setIsPrepayment, reason: '', setReason: vi.fn() };
    const { rerender } = render(<PayrollPrepaymentField prepayment={state} hasFixedSalary />);
    expect(screen.queryByLabelText('دلیل پیش‌پرداخت *')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(setIsPrepayment).toHaveBeenCalledWith(true);
    const ticked = { ...state, isPrepayment: true };
    rerender(<PayrollPrepaymentField prepayment={ticked} hasFixedSalary={false} />);
    expect(screen.getByLabelText('دلیل پیش‌پرداخت *')).toBeTruthy();
    expect(screen.getByText(/حقوق ثابت ماهانه ندارد/)).toBeTruthy();
    expect(prepaymentNeedsReason(ticked)).toBe(true);
    expect(prepaymentNeedsReason({ ...ticked, reason: 'نوروز' })).toBe(false);

    rerender(<PrepaymentNotice payroll={{ isPrepayment: 1, prepaymentReason: 'پرداخت پیش از نوروز' }} />);
    expect(screen.getByText(/پرداخت پیش از نوروز/)).toBeTruthy();
    rerender(<PrepaymentNotice payroll={{ isPrepayment: 0 }} />);
    expect(screen.queryByText(/فیش پیش‌پرداخت/)).toBeNull();
  });
});
