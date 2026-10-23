import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownReads } from './helpers/ownReads';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

/**
 * 10.3 (ARCH review finding 3): the money windows (invoice settlement, payslip payment and history, payslip form, eidi,
 * insurance and tax, remittance, rate history, «my payslips») read through the shared cache. A write elsewhere that
 * invalidates the treasury or `piecework` keys refreshes a window that is already open, and every opening reads again.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  history: /سابقه واریزهای قبلی/,
  overAdvance: /فیش با این مبلغ صادر نمی‌شود/,
  bank: 'بانک آزمون',
  worker: 'کارگر',
} as const;

let payments: { id: number; transactionNumber: string; amount: number; status: string; bankAccountTitle: string; date: string }[] = [];
let outstandingAdvance = 0;
const fetchJson = vi.fn(async (url: string) => {
  if (url === '/piecework/payrolls/7/payments') return payments;
  if (url === '/piecework/personnel/5/advance-balance') return { outstandingAdvance, totalAdvances: outstandingAdvance, totalDeducted: 0 };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url) }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') }));

import { rialDisplayOf } from '../../lib/rialDisplay';
import { invalidateAfterTreasuryChange } from '../../hooks/accounting/accountingInvalidation';
import { invalidateDomain } from '../../lib/queryInvalidation';
import { PayrollPaymentModal } from '../../components/piecework/PayrollPaymentModal';
import { PieceworkPayrollModal } from '../../components/piecework/PieceworkPayrollModal';
import { appQueryClient } from './helpers/queryWrapper';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
});

const withClient = (client: QueryClient) => (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
/** the app's read defaults (fresh for five minutes): a screen must read again on its own */
const newClient = appQueryClient;
const payment = (id: number, amount: number) => ({ id, transactionNumber: `PAY-T-${id}`, amount, status: 'completed', bankAccountTitle: SHOWN.bank, date: '2026-05-01' });
const payrollOf = (paidAmount: number) => ({ id: 7, payrollNumber: 'PAY-7', netPayable: 1_000_000, paidAmount, status: 'partially_paid' });
const paymentReads = () => fetchJson.mock.calls.filter(([url]) => url === '/piecework/payrolls/7/payments').length;

describe('payroll windows refresh while open (10.3)', () => {
  it('the payment window shows a payment recorded elsewhere once the treasury keys are invalidated', async () => {
    const client = newClient();
    payments = [payment(11, 400_000)];
    render(withClient(client)(<PayrollPaymentModal payroll={payrollOf(400_000)} onClose={() => undefined} />));
    fireEvent.click(await screen.findByText(SHOWN.history));
    expect(await screen.findByText(/PAY-T-11/)).toBeTruthy();
    expect(screen.queryByText(/PAY-T-12/)).toBeNull();

    payments = [payment(11, 400_000), payment(12, 200_000)];
    await act(() => invalidateAfterTreasuryChange(client));
    expect(await screen.findByText(/PAY-T-12/)).toBeTruthy();
  });

  it('reopening the payment window reads the payments again', async () => {
    const client = newClient();
    payments = [payment(11, 400_000)];
    const view = (payroll: ReturnType<typeof payrollOf> | null) => withClient(client)(<PayrollPaymentModal payroll={payroll} onClose={() => undefined} />);
    const { rerender } = render(view(payrollOf(400_000)));
    await waitFor(() => expect(paymentReads()).toBe(1));
    rerender(view(null));
    rerender(view(payrollOf(400_000)));
    await waitFor(() => expect(paymentReads()).toBe(2));
  });

  it('the payslip form takes a new advance balance without being reopened', async () => {
    const client = newClient();
    outstandingAdvance = 300_000;
    const noop = () => undefined;
    render(withClient(client)(
      <PieceworkPayrollModal
        isOpen onClose={noop} onSubmit={noop} personnelSelectOptions={[{ value: '5', label: SHOWN.worker }]}
        payrollPersonnelId={5} setPayrollPersonnelId={noop} payrollStartDate="1405/01/01" setPayrollStartDate={noop}
        payrollEndDate="1405/01/31" setPayrollEndDate={noop} payrollBonuses={0} setPayrollBonuses={noop}
        payrollDeductions={0} setPayrollDeductions={noop} payrollNotes="" setPayrollNotes={noop}
        payrollPreviewLogs={[]} allowNoLogs advanceDeduction={200_000} setAdvanceDeduction={noop}
      />,
    ));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/piecework/personnel/5/advance-balance'));
    expect(screen.queryByText(SHOWN.overAdvance)).toBeNull();

    // another payslip deducted the advance meanwhile
    outstandingAdvance = 100_000;
    await act(() => invalidateDomain(client, 'piecework'));
    expect(await screen.findByText(SHOWN.overAdvance)).toBeTruthy();
  });
});

const MONEY_WINDOWS = [
  'components/invoices/InvoiceSettlementModal.tsx',
  'components/piecework/PayrollEidiModal.tsx',
  'components/piecework/PayrollEidiReportModal.tsx',
  'components/piecework/PayrollPaymentHistory.tsx',
  'components/piecework/PayrollPaymentModal.tsx',
  'components/piecework/PayrollStatutoryFields.tsx',
  'components/piecework/PayrollStatutoryReportModal.tsx',
  'components/piecework/PieceworkPayrollModal.tsx',
  'components/piecework/PieceworkRateHistoryModal.tsx',
  'components/piecework/PieceworkTaskModal.tsx',
  'components/piecework/StatutoryRemittanceModal.tsx',
  'pages/MyPayslipsPage.tsx',
];

describe('the money windows read only through the shared cache (10.3)', () => {
  it('their own fetch calls are writes', () => {
    expect(MONEY_WINDOWS.flatMap(ownReads)).toEqual([]);
  });
});
