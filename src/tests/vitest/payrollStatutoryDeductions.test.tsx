import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const calls: Array<{ url: string; options?: { method?: string; body?: string } }> = [];
const answers: { current: (url: string) => unknown } = { current: () => ({}) };
vi.mock('../../api', () => ({ fetchJson: async (url: string, options?: { method?: string; body?: string }) => { calls.push({ url, options }); return answers.current(url); } }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { periodMonthFraction, statutoryRatesError, suggestStatutoryDeductions, type StatutoryRates } from '../../lib/payroll/statutoryDeductions';
import { EMPTY_STATUTORY_ENTRY, statutoryEntryError, statutoryNeedsReason, statutoryPayloadOf } from '../../lib/payroll/statutoryForm';
import { statutoryReportFileName, statutoryReportSheetRows, type StatutoryReport } from '../../lib/payroll/statutoryReport';
import { PayrollStatutoryFields } from '../../components/piecework/PayrollStatutoryFields';
import { PayslipStatutoryRows } from '../../components/piecework/PayslipStatutoryRows';
import { PayrollStatutoryRatesTab } from '../../components/settings/PayrollStatutoryRatesTab';
import type { PieceworkPayroll } from '../../types';

afterEach(() => { cleanup(); calls.length = 0; answers.current = () => ({}); });

const RATES: StatutoryRates = {
  jalaliYear: 1405, employeeInsurancePercent: '7', employerInsurancePercent: '23', insuranceWageCap: '0',
  taxBrackets: [{ from: '0', to: '10000000', rate: '0' }, { from: '10000000', to: null, rate: '10' }], deductInsuranceFromTax: true,
};
// Farvardin 1405 = 2026-03-21 .. 2026-04-20 (31 days)
const FARVARDIN = { startIso: '2026-03-21', endIso: '2026-04-20' };
const BOTH = { insurance: true, tax: true };

// v10.0.210 (TD-1087, payroll duties plan §3.3): statutory deductions from the year's rates
describe('statutory deduction rule (TD-1087)', () => {
  it('computes employee and employer insurance and bracket tax for a whole month', () => {
    const s = suggestStatutoryDeductions({ gross: 20_000_000, ...FARVARDIN, rates: RATES, coverage: BOTH });
    expect([s.employeeInsurance, s.employerInsurance, s.incomeTax]).toEqual(['1400000', '4600000', '860000']);
  });

  it('caps the insurance base and scales the cap and brackets by the month fraction', () => {
    const capped = suggestStatutoryDeductions({ gross: 200_000_000, ...FARVARDIN, rates: { ...RATES, insuranceWageCap: '100000000' }, coverage: BOTH });
    expect(capped.employeeInsurance).toBe('7000000');
    expect(periodMonthFraction('2026-03-21', '2026-04-05').toNumber()).toBeCloseTo(16 / 31, 6);
    const half = suggestStatutoryDeductions({ gross: 10_000_000, startIso: '2026-03-21', endIso: '2026-04-05', rates: RATES, coverage: { insurance: false, tax: true } });
    // bracket top scaled to 10,000,000 × 16/31; tax on the rest at 10 %
    expect(Number(half.incomeTax)).toBe(Math.round((10_000_000 - 10_000_000 * 16 / 31) * 0.1));
    expect(half.employeeInsurance).toBe('0');
  });

  it('gives zero without rates or without coverage', () => {
    expect(suggestStatutoryDeductions({ gross: 20_000_000, ...FARVARDIN, rates: null, coverage: BOTH }).incomeTax).toBe('0');
    const none = suggestStatutoryDeductions({ gross: 20_000_000, ...FARVARDIN, rates: RATES, coverage: { insurance: false, tax: false } });
    expect([none.employeeInsurance, none.employerInsurance, none.incomeTax]).toEqual(['0', '0', '0']);
  });

  it('refuses brackets with a gap, an open bracket before the last and a percent above 100', () => {
    expect(statutoryRatesError(RATES)).toBeNull();
    expect(statutoryRatesError({ ...RATES, taxBrackets: [{ from: '0', to: '10', rate: '0' }, { from: '12', to: null, rate: '10' }] })).toBeTruthy();
    expect(statutoryRatesError({ ...RATES, taxBrackets: [{ from: '0', to: null, rate: '0' }, { from: '10', to: null, rate: '10' }] })).toBeTruthy();
    expect(statutoryRatesError({ ...RATES, employerInsurancePercent: '120' })).toBeTruthy();
  });
});

describe('statutory form entry (TD-1087)', () => {
  const suggestion = { employeeInsurance: '1400000', employerInsurance: '4600000', incomeTax: '860000' };

  it('sends only entered amounts, reads Persian digits and asks a reason only when an amount differs', () => {
    expect(statutoryPayloadOf(EMPTY_STATUTORY_ENTRY)).toEqual({});
    const entry = { ...EMPTY_STATUTORY_ENTRY, incomeTax: '۵۰۰٬۰۰۰' };
    expect(statutoryPayloadOf(entry)).toEqual({ incomeTax: '500000' });
    expect(statutoryNeedsReason(entry, suggestion)).toBe(true);
    expect(statutoryNeedsReason({ ...entry, reason: 'معافیت' }, suggestion)).toBe(false);
    expect(statutoryPayloadOf({ ...entry, reason: ' معافیت ' })).toEqual({ incomeTax: '500000', statutoryOverrideReason: 'معافیت' });
    expect(statutoryNeedsReason({ ...EMPTY_STATUTORY_ENTRY, incomeTax: '860000' }, suggestion)).toBe(false);
  });

  it('never reads text as zero', () => {
    expect(statutoryEntryError({ ...EMPTY_STATUTORY_ENTRY, employeeInsurance: 'abc' })).toContain('بیمه سهم کارگر');
    expect(statutoryEntryError({ ...EMPTY_STATUTORY_ENTRY, incomeTax: '-5' })).toContain('مالیات حقوق');
  });

  it('shows the server suggestion and asks for a reason after a change', async () => {
    answers.current = () => ({ suggestion: { ...suggestion, insuranceBase: '20000000', taxBase: '18600000', monthFraction: '1' }, warning: null, covered: BOTH });
    let entry = EMPTY_STATUTORY_ENTRY;
    const onChange = (next: typeof entry) => { entry = next; };
    const { rerender } = render(<PayrollStatutoryFields personnelId={5} startDate="2026-03-21" endDate="2026-04-20" gross={20_000_000} entry={entry} onChange={onChange} />);
    await waitFor(() => expect(calls[0]?.url).toContain('/piecework/statutory-preview?personnelId=5'));
    expect(calls[0].url).toContain('gross=20000000');
    expect(await screen.findByPlaceholderText('۸۶۰٬۰۰۰')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('مالیات حقوق (ریال)'), { target: { value: '500000' } });
    rerender(<PayrollStatutoryFields personnelId={5} startDate="2026-03-21" endDate="2026-04-20" gross={20_000_000} entry={entry} onChange={onChange} />);
    expect(screen.getByText('مبلغ با محاسبه فرق دارد؛ فیش بی شرح تغییر صادر نمی‌شود.')).toBeTruthy();
  });

  it('shows the missing-rates warning and says when the worker is not covered', async () => {
    answers.current = () => ({ suggestion: { ...suggestion, employeeInsurance: '0', employerInsurance: '0', incomeTax: '0' }, warning: 'نرخ‌های سال ۱۴۰۵ ثبت نشده است', covered: BOTH });
    render(<PayrollStatutoryFields personnelId={5} startDate="2026-03-21" endDate="2026-04-20" gross={1} entry={EMPTY_STATUTORY_ENTRY} onChange={() => undefined} />);
    expect(await screen.findByText('نرخ‌های سال ۱۴۰۵ ثبت نشده است')).toBeTruthy();
    cleanup();
    answers.current = () => ({ suggestion, warning: null, covered: { insurance: false, tax: false } });
    render(<PayrollStatutoryFields personnelId={6} startDate="2026-03-21" endDate="2026-04-20" gross={1} entry={EMPTY_STATUTORY_ENTRY} onChange={() => undefined} />);
    expect(await screen.findByText('این پرسنل مشمول بیمه و مالیات حقوق نیست؛ فیش کسور قانونی ندارد.')).toBeTruthy();
  });
});

describe('payslip print rows (TD-1087)', () => {
  const base = { id: 1, payrollNumber: 'PAY-1', personnelId: 5, startDate: '', endDate: '', title: '', totalPieceworkAmount: 0, totalBonuses: 0, totalDeductions: 0, netPayable: 0, status: 'approved' } as PieceworkPayroll;

  it('prints each statutory deduction and marks the employer share as not deducted', () => {
    render(<PayslipStatutoryRows payroll={{ ...base, employeeInsurance: '1400000', employerInsurance: '4600000', incomeTax: '860000' }} />);
    expect(screen.getByText('بیمه سهم کارگر:')).toBeTruthy();
    expect(screen.getByText('مالیات حقوق:')).toBeTruthy();
    expect(screen.getByText('بیمه سهم کارفرما (از خالص کم نمی‌شود):')).toBeTruthy();
  });

  it('prints nothing for a payslip without them', () => {
    const { container } = render(<PayslipStatutoryRows payroll={base} />);
    expect(container.textContent).toBe('');
  });
});

describe('rates settings tab (TD-1087)', () => {
  it('saves the year with its brackets and blocks an invalid form', async () => {
    answers.current = () => ({ data: [] });
    render(<PayrollStatutoryRatesTab />);
    await waitFor(() => expect(calls.some(c => c.url === '/piecework/statutory-rates')).toBe(true));
    fireEvent.change(screen.getByLabelText('آغاز پله ۱'), { target: { value: '5' } });
    const save = screen.getByText(/^ذخیره نرخ‌های سال/).closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('آغاز پله ۱'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('نرخ پله ۱'), { target: { value: '۱۰' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.some(c => c.options?.method === 'PUT')).toBe(true));
    const put = calls.find(c => c.options?.method === 'PUT');
    expect(put?.url).toMatch(/^\/piecework\/statutory-rates\/\d{4}$/);
    expect(JSON.parse(put?.options?.body ?? '{}').taxBrackets).toEqual([{ from: '0', to: null, rate: '10' }]);
  });
});

// v10.0.211 (TD-1088): the monthly insurance and tax list
describe('monthly statutory report (TD-1088)', () => {
  it('builds Excel rows with a total row and a Persian file name', () => {
    const report: StatutoryReport = {
      jalaliYear: 1405, jalaliMonth: 7, from: '', to: '', draftPayslips: 0, withoutStatutory: { personnel: 0, payslips: 0 },
      rows: [{ personnelId: 1, fullName: 'الف', personnelCode: 'P1', nationalId: '0012345678', payslips: 2, gross: '1000', employeeInsurance: '70', employerInsurance: '230', incomeTax: '10' }],
      totals: { gross: '1000', employeeInsurance: '70', employerInsurance: '230', incomeTax: '10' },
    };
    const rows = statutoryReportSheetRows(report);
    expect(rows).toHaveLength(2);
    expect(rows[1]['نام پرسنل']).toBe('جمع');
    expect(rows[1]['بیمه سهم کارفرما (ریال)']).toBe(230);
    expect(statutoryReportFileName(1405, 7)).toBe('فهرست-بیمه-و-مالیات-۱۴۰۵-۰۷.xlsx');
  });
});
