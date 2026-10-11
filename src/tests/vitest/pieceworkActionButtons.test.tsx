import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const keys = { canManageTasks: false, canLog: false, canIssuePayroll: false, canApprovePayroll: false, canPay: false };
vi.mock('../../hooks/usePieceworkPermissions', () => ({ usePieceworkPermissions: () => keys }));
vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => []) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});

import { PieceworkLogsTab } from '../../components/piecework/PieceworkLogsTab';
import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import { PieceworkRatesTab } from '../../components/piecework/PieceworkRatesTab';
import type { PieceworkLog, PieceworkPayroll, PieceworkTask } from '../../types';

const grant = (granted: Partial<typeof keys>) => Object.assign(keys, { canManageTasks: false, canLog: false, canIssuePayroll: false, canApprovePayroll: false, canPay: false }, granted);
afterEach(() => cleanup());

const noop = () => undefined;
const LOG = { id: 1, personnelId: 7, personnelName: 'پرسنل آزمون', taskId: 3, taskTitle: 'برش', date: '2026-10-01', quantity: 2, unitRate: 1000, totalAmount: 2000, status: 'pending' } as unknown as PieceworkLog;
const renderLogs = () => render(
  <PieceworkLogsTab
    logsList={[LOG]} loading={false} searchQuery="" onSearchChange={noop} selectedPersonnelFilter="all" onPersonnelFilterChange={noop}
    selectedProjectFilter="all" onProjectFilterChange={noop} statusFilter="all" onStatusFilterChange={noop} startDateFilter="" onStartDateChange={noop}
    endDateFilter="" onEndDateChange={noop} personnelSelectOptions={[]} projectSelectOptions={[]} onOpenAddModal={noop} onEditLog={noop} onDeleteLog={noop}
  />,
);

const payroll = (id: number, status: string, voucherNumber: number | null) => ({
  id, payrollNumber: `PR-${id}`, personnelName: 'پرسنل آزمون', startDate: '2026-09-23', endDate: '2026-10-07', status, voucherNumber,
  totalPieceworkAmount: 1000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000, paidAmount: 0, notes: '',
}) as unknown as PieceworkPayroll;
const renderPayrolls = () => render(
  <PieceworkPayrollsTab
    payrollsList={[payroll(1, 'draft', null), payroll(2, 'approved', 12)]} onOpenPayrollModal={noop} onViewPayslip={noop} onUpdateStatus={noop} onDeletePayroll={noop}
  />,
);

const TASK = { id: 3, title: 'برش', category: 'عمومی', unit: 'عدد', defaultRate: 1000 } as unknown as PieceworkTask;
const renderRates = () => render(
  <PieceworkRatesTab personnelSelectOptions={[]} selectedPersonnelForRates={7} onSelectPersonnel={noop} tasksList={[TASK]} customRatesMap={{}} onSaveCustomRate={noop} />,
);

// v9.0.320 (TD-805, B12P-02, decision t2 «الف»): a payroll button shows only for the key its API asks
describe('payroll buttons follow their API keys (TD-805)', () => {
  it('work log add, edit and delete need piecework.log', () => {
    grant({ canManageTasks: true, canIssuePayroll: true, canPay: true });
    renderLogs();
    expect(screen.queryByText('ثبت کارکرد پرسنل')).toBeNull();
    expect(screen.queryByTitle('ویرایش کارکرد')).toBeNull();
    expect(screen.queryByTitle('حذف کارکرد')).toBeNull();
    cleanup();
    grant({ canLog: true });
    renderLogs();
    expect(screen.getByText('ثبت کارکرد پرسنل')).toBeTruthy();
    expect(screen.getByTitle('ویرایش کارکرد')).toBeTruthy();
    expect(screen.getByTitle('حذف کارکرد')).toBeTruthy();
  });

  // v10.0.193 (TD-1083): approving moved to its own key, piecework.payroll_approve
  it('issue, voucher and void need piecework.payroll; approve piecework.payroll_approve; payment piecework.pay', () => {
    grant({ canPay: true });
    renderPayrolls();
    expect(screen.queryByText('صدور فیش حقوقی جدید')).toBeNull();
    expect(screen.queryByText('تأیید فیش')).toBeNull();
    expect(screen.queryByText('ثبت سند حسابداری')).toBeNull();
    expect(screen.queryByTitle('ابطال فیش')).toBeNull();
    expect(screen.getByText('ثبت پرداخت')).toBeTruthy();
    cleanup();
    grant({ canIssuePayroll: true });
    renderPayrolls();
    expect(screen.getByText('صدور فیش حقوقی جدید')).toBeTruthy();
    expect(screen.queryByText('تأیید فیش')).toBeNull();
    expect(screen.getByText('پیش‌نویس')).toBeTruthy();
    expect(screen.getByText('ثبت سند حسابداری')).toBeTruthy();
    expect(screen.getAllByTitle('ابطال فیش').length).toBe(2);
    expect(screen.queryByText('ثبت پرداخت')).toBeNull();
    expect(screen.getByText('تأییدشده')).toBeTruthy();
    cleanup();
    grant({ canApprovePayroll: true });
    renderPayrolls();
    expect(screen.getByText('تأیید فیش')).toBeTruthy();
    expect(screen.queryByText('صدور فیش حقوقی جدید')).toBeNull();
    expect(screen.queryByTitle('ابطال فیش')).toBeNull();
  });

  it('a custom rate is saved only with piecework.manage_tasks', () => {
    grant({ canLog: true, canIssuePayroll: true });
    renderRates();
    expect(screen.queryByText('ثبت نرخ')).toBeNull();
    expect((document.getElementById('custom-rate-3') as HTMLInputElement).readOnly).toBe(true);
    cleanup();
    grant({ canManageTasks: true });
    renderRates();
    expect(screen.getByText('ثبت نرخ')).toBeTruthy();
    expect((document.getElementById('custom-rate-3') as HTMLInputElement).readOnly).toBe(false);
  });
});
