import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PersonnelStatutoryFlags } from '../../components/personnel/PersonnelStatutoryFlags';
import { isEidiCovered, suggestEidiPayslip, type EidiRates } from '../../lib/payroll/eidi';

/**
 * v10.1.32 (TD-1282, product-owner decision t34 A): eidi is optional per person like insurance and payroll tax. The
 * personnel form has an «eidi covered» box, on by default; a person with it off has no yearly entitlement and the eidi
 * payslip suggests only the accrual recorded earlier.
 */

afterEach(cleanup);

const EIDI_BOX_LABEL = 'مشمول عیدی';

const LABOR_LAW: EidiRates = {
  jalaliYear: 1405, method: 'labor_law', percent: '0', yearlyCap: '0', laborDays: '60', laborCapDays: '90', minDailyWage: '1000000', fixedAmount: '0',
};

describe('eidi flag on the personnel form (TD-1282)', () => {
  it('shows the eidi box beside insurance and tax and sends all three flags on change', () => {
    const onChange = vi.fn();
    render(<PersonnelStatutoryFlags insurance={false} tax={true} eidi={true} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: EIDI_BOX_LABEL });
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ isInsuranceCovered: false, isTaxCovered: true, isEidiCovered: false });
  });

  it('reads a missing flag as covered, like the column default', () => {
    expect(isEidiCovered({})).toBe(true);
    expect(isEidiCovered({ isEidiCovered: 1 })).toBe(true);
    expect(isEidiCovered({ isEidiCovered: 0 })).toBe(false);
  });
});

describe('eidi payslip suggestion of a person not covered (TD-1282)', () => {
  const base = { rates: LABOR_LAW, issuedFromAccrual: '0', issuedTotal: '0', monthlySalary: '30000000', workedDays: 365, yearDays: 365 };

  it('has no yearly entitlement and suggests only the accrual left from earlier payslips', () => {
    const covered = suggestEidiPayslip({ ...base, accruedApproved: '0' });
    expect(covered.entitlement).toBe('60000000');
    const notCovered = suggestEidiPayslip({ ...base, accruedApproved: '0', covered: false });
    expect(notCovered.entitlement).toBeNull();
    expect(notCovered.amount).toBe('0');
    const withAccrual = suggestEidiPayslip({ ...base, accruedApproved: '2000000', covered: false });
    expect(withAccrual.amount).toBe('2000000');
  });
});
