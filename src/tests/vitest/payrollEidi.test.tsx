import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const calls: Array<{ url: string; options?: { method?: string; body?: string } }> = [];
const answers: { current: (url: string) => unknown } = { current: () => ({}) };
vi.mock('../../api', () => ({ fetchJson: async (url: string, options?: { method?: string; body?: string }) => { calls.push({ url, options }); return answers.current(url); } }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { daysInclusive, eidiEntitlement, eidiFromAccrual, eidiRatesError, payslipEidiShare, suggestEidiPayslip, type EidiRates } from '../../lib/payroll/eidi';
import { eidiReportFileName, eidiReportSheetRows, type EidiReport } from '../../lib/payroll/eidiReport';
import { PayslipEidiRows } from '../../components/piecework/PayslipEidiRows';
import { PayrollEidiRatesSection } from '../../components/settings/PayrollEidiRatesSection';
import type { PieceworkPayroll } from '../../types';

afterEach(() => { cleanup(); calls.length = 0; answers.current = () => ({}); });

const PERCENT: EidiRates = { jalaliYear: 1405, method: 'percent_of_work', percent: '15', yearlyCap: '5000000', laborDays: '0', laborCapDays: '0', minDailyWage: '0', fixedAmount: '0' };
const LABOR: EidiRates = { ...PERCENT, method: 'labor_law', percent: '0', yearlyCap: '0', laborDays: '60', laborCapDays: '90', minDailyWage: '1000000' };

// v10.0.212 (TD-1089, payroll duties plan §3.8): yearly eidi rules
describe('eidi rule (TD-1089)', () => {
  it('takes the percent of a payslip up to what is left of the yearly cap', () => {
    expect(payslipEidiShare({ base: 20_000_000, rates: PERCENT, otherShares: 0 })).toBe('3000000');
    expect(payslipEidiShare({ base: 20_000_000, rates: PERCENT, otherShares: 3_000_000 })).toBe('2000000');
    expect(payslipEidiShare({ base: 20_000_000, rates: PERCENT, otherShares: 5_000_000 })).toBe('0');
    expect(payslipEidiShare({ base: 20_000_000, rates: LABOR, otherShares: 0 })).toBe('0');
    expect(payslipEidiShare({ base: 20_000_000, rates: null, otherShares: 0 })).toBe('0');
  });

  it('computes the labor-law entitlement for the days worked, capped at the minimum wage days', () => {
    expect(daysInclusive('2026-09-23', '2027-03-20')).toBe(179);
    expect(eidiEntitlement({ rates: LABOR, monthlySalary: 30_000_000, workedDays: 179, yearDays: 365 })?.toNumber()).toBe(Math.round(60_000_000 * 179 / 365));
    // a high wage is capped at 90 days × 1,000,000
    expect(eidiEntitlement({ rates: LABOR, monthlySalary: 300_000_000, workedDays: 365, yearDays: 365 })?.toNumber()).toBe(90_000_000);
    expect(eidiEntitlement({ rates: PERCENT, monthlySalary: 1, workedDays: 1, yearDays: 365 })).toBeNull();
  });

  it('suggests the approved accrual less what earlier eidi payslips took, and splits an amount above it', () => {
    const s = suggestEidiPayslip({ rates: PERCENT, accruedApproved: 3_000_000, issuedFromAccrual: 1_000_000, issuedTotal: 1_000_000, monthlySalary: 0, workedDays: 365, yearDays: 365 });
    expect([s.amount, s.remainingAccrual, s.entitlement]).toEqual(['2000000', '2000000', null]);
    expect(eidiFromAccrual(2_500_000, s.remainingAccrual)).toBe('2000000');
    expect(eidiFromAccrual(500_000, s.remainingAccrual)).toBe('500000');
    const labor = suggestEidiPayslip({ rates: LABOR, accruedApproved: 0, issuedFromAccrual: 0, issuedTotal: 10_000_000, monthlySalary: 30_000_000, workedDays: 365, yearDays: 365 });
    expect(labor.amount).toBe('50000000');
  });

  it('refuses incomplete rates for each method', () => {
    expect(eidiRatesError(PERCENT)).toBeNull();
    expect(eidiRatesError({ ...PERCENT, yearlyCap: '0' })).toBeTruthy();
    expect(eidiRatesError({ ...PERCENT, percent: '120' })).toBeTruthy();
    expect(eidiRatesError(LABOR)).toBeNull();
    expect(eidiRatesError({ ...LABOR, minDailyWage: '0' })).toBeTruthy();
    expect(eidiRatesError({ ...PERCENT, method: 'fixed_amount' })).toBeTruthy();
  });

  it('builds the yearly report rows with a total and a Persian file name', () => {
    const report: EidiReport = {
      jalaliYear: 1405, method: 'percent_of_work',
      rows: [{ personnelId: 1, fullName: 'الف', personnelCode: 'P1', due: '3000000', draftShares: '2000000', cap: '5000000', issued: '3000000', paid: '1000000', remaining: '0' }],
      totals: { due: '3000000', issued: '3000000', paid: '1000000', remaining: '0' },
    };
    const rows = eidiReportSheetRows(report);
    expect(rows).toHaveLength(2);
    expect(rows[1]['نام پرسنل']).toBe('جمع');
    expect(rows[0]['حق عیدی (ریال)']).toBe(3_000_000);
    expect(eidiReportFileName(1405)).toBe('عیدی-سال-۱۴۰۵.xlsx');
  });
});

describe('eidi screens (TD-1089)', () => {
  it('prints the payslip share and the year accrual, and the eidi of an eidi payslip', () => {
    const base = { id: 1, payrollNumber: 'PAY-1', personnelId: 1, totalBonuses: 0, totalDeductions: 0, netPayable: 0 } as unknown as PieceworkPayroll;
    render(<PayslipEidiRows payroll={{ ...base, eidiAmount: '3000000', eidiYear: 1405, isEidi: 0, eidiYearAccrued: '5000000' }} />);
    expect(screen.getByText('سهم عیدی این فیش (از خالص کم نمی‌شود):')).toBeTruthy();
    expect(screen.getByText('عیدی انباشته سال ۱۴۰۵ (فیش‌های تأییدشده):')).toBeTruthy();
    cleanup();
    render(<PayslipEidiRows payroll={{ ...base, eidiAmount: '3000000', eidiYear: 1405, isEidi: 1 }} />);
    expect(screen.getByText('عیدی و پاداش سال ۱۴۰۵:')).toBeTruthy();
    cleanup();
    const { container } = render(<PayslipEidiRows payroll={{ ...base, eidiAmount: '0', isEidi: 0 }} />);
    expect(container.textContent).toBe('');
  });

  it('saves the labor-law fields of the selected year', async () => {
    answers.current = () => ({ data: [] });
    render(<PayrollEidiRatesSection />);
    await waitFor(() => expect(calls.some(c => c.url === '/piecework/eidi-rates')).toBe(true));
    fireEvent.change(screen.getByLabelText('روش'), { target: { value: 'labor_law' } });
    fireEvent.change(screen.getByLabelText('روزهای مزد عیدی'), { target: { value: '۶۰' } });
    fireEvent.change(screen.getByLabelText('روزهای سقف به حداقل مزد'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('حداقل مزد روزانه سال (ریال)'), { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: /ذخیره روش عیدی سال/ }));
    await waitFor(() => expect(calls.some(c => c.options?.method === 'PUT')).toBe(true));
    const put = calls.find(c => c.options?.method === 'PUT');
    expect(put?.url).toMatch(/^\/piecework\/eidi-rates\/\d{4}$/);
    expect(JSON.parse(put?.options?.body ?? '{}')).toMatchObject({ method: 'labor_law', laborDays: '60', laborCapDays: '90', minDailyWage: '1000000' });
  });
});
