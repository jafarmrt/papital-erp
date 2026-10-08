import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

let minePayslips: unknown[] = [];
vi.mock('../../api', () => ({ fetchJson: async (url: string) => (url.startsWith('/piecework/payrolls/mine') ? minePayslips : []) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => 'کارگاه آزمون سفال' }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { PieceworkPayslipModal } from '../../components/piecework/PieceworkPayslipModal';
import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import MyPayslipsPage from '../../pages/MyPayslipsPage';
import type { PieceworkPayroll } from '../../types';

afterEach(cleanup);

const noop = () => undefined;
const payslip = (over: Partial<PieceworkPayroll>): PieceworkPayroll => ({
  id: 7, payrollNumber: 'PAY-7', personnelId: 5, personnelName: 'کارگر', startDate: '2026-09-08', endDate: '2026-10-22', title: 'فیش مهر',
  totalPieceworkAmount: 0, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 0, status: 'approved', items: [], ...over,
});
const viewPayslip = (p: PieceworkPayroll) =>
  render(<PieceworkPayslipModal viewingPayroll={p} onClose={noop} onUpdateStatus={noop} onDeletePayroll={noop} />);

// v9.0.328 (TD-815, B12P-12): the payslip and «فیش‌های حقوقی من» show the real state, the fixed salary per month and the company name
describe('payslip view and my payslips (TD-815)', () => {
  it('lists the fixed salary month by month instead of one monthly period row', () => {
    viewPayslip(payslip({
      totalFixedAmount: 44516129,
      fixedSalaryMonths: [
        { month: '1405/06', days: 15, monthDays: 31, amount: '14516129' },
        { month: '1405/07', days: 30, monthDays: 30, amount: '30000000' },
      ],
    }));
    expect(screen.queryByText('۱ دوره ماهانه')).toBeNull();
    const shahrivar = screen.getByText('شهریور ۱۴۰۵').closest('tr');
    const mehr = screen.getByText('مهر ۱۴۰۵').closest('tr');
    expect(shahrivar?.textContent).toContain('۱۵ روز از ۳۱ روز');
    expect(shahrivar?.textContent).toContain('۱۴٬۵۱۶٬۱۲۹');
    expect(mehr?.textContent).toContain('۳۰ روز از ۳۰ روز');
    expect(mehr?.textContent).toContain('۳۰٬۰۰۰٬۰۰۰');
  });

  it('a payslip from before monthly shares shows one full month', () => {
    viewPayslip(payslip({ totalFixedAmount: 30000000, fixedSalaryMonths: [] }));
    expect(screen.getByText('۱ ماه کامل')).toBeTruthy();
  });

  it('labels a draft and an approved payslip differently and prints the company name from the settings', () => {
    viewPayslip(payslip({ status: 'draft' }));
    expect(screen.getByText(/وضعیت: پیش‌نویس/)).toBeTruthy();
    expect(screen.getByText('کارگاه آزمون سفال')).toBeTruthy();
    expect(screen.queryByText(/مجموعه پاپیتال/)).toBeNull();
    expect(screen.queryByText('آماده پرداخت')).toBeNull();
    cleanup();
    viewPayslip(payslip({ status: 'approved' }));
    expect(screen.getByText(/وضعیت: تأییدشده/)).toBeTruthy();
    expect(screen.getByText('چاپ فیش')).toBeTruthy();
  });

  it('the payslip list has an advance deduction column', () => {
    render(<PieceworkPayrollsTab payrollsList={[payslip({ advanceDeduction: 250000, netPayable: 750000 })]} onOpenPayrollModal={noop}
      onViewPayslip={noop} onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(screen.getByText('کسر مساعده (ریال)')).toBeTruthy();
    expect(screen.getByText('-۲۵۰٬۰۰۰')).toBeTruthy();
  });

  it('my payslips labels a partly paid payslip, counts it as waiting and shows the currency once', async () => {
    minePayslips = [payslip({ id: 8, payrollNumber: 'PAY-8', status: 'partially_paid', paidAmount: 600000 })];
    render(<MyPayslipsPage />);
    await waitFor(() => expect(screen.getByText('فیش مهر')).toBeTruthy());
    const row = screen.getByText('فیش مهر').closest('tr') as HTMLElement;
    expect(within(row).getByText('نیمه‌پرداخت')).toBeTruthy();
    expect(row.textContent?.match(/ریال/g)).toHaveLength(1);
    expect(screen.getByText('در انتظار پرداخت').parentElement?.textContent).toContain('۱');
  });
});
