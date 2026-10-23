import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './helpers/queryWrapper';

const calls: Array<{ url: string; options?: { method?: string; body?: string } }> = [];
vi.mock('../../api', () => ({ fetchJson: async (url: string, options?: { method?: string; body?: string }) => { calls.push({ url, options }); return {}; } }));
vi.mock('../../contexts/AuthContext', async () => ({
  ...(await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext')),
  useViewerIdentity: () => ({ id: 3, isAdmin: false }),
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
const permissions = { current: { canManageTasks: false, canLog: false, canIssuePayroll: true, canApprovePayroll: false, canPay: false } };
vi.mock('../../hooks/usePieceworkPermissions', () => ({ usePieceworkPermissions: () => permissions.current }));

import { PieceworkPayrollsTab } from '../../components/piecework/PieceworkPayrollsTab';
import type { PieceworkPayroll } from '../../types';

afterEach(() => { cleanup(); calls.length = 0; });

const noop = () => undefined;
const payslip = (id: number, status: PieceworkPayroll['status']): PieceworkPayroll => ({
  id, payrollNumber: `PAY-${id}`, personnelId: 5, personnelName: 'کارگر', startDate: '2026-08-23', endDate: '2026-09-22', title: 'فیش',
  totalPieceworkAmount: 1000000, totalBonuses: 0, totalDeductions: 0, netPayable: 1000000, paidAmount: 0, status, createdById: 9,
});

// v10.0.200 (TD-1242, payroll duties plan §3.1 item 3): a draft payslip is edited from the list with the issue key
describe('editing a draft payslip (TD-1242)', () => {
  it('offers the edit only on a draft, only to the issue key holder, and sends the amounts', async () => {
    const onReload = vi.fn();
    renderWithQuery(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft'), payslip(2, 'approved')]} onOpenPayrollModal={noop} onViewPayslip={noop}
      onUpdateStatus={noop} onDeletePayroll={noop} onReload={onReload} />);
    const edits = screen.getAllByLabelText('ویرایش فیش پیش‌نویس');
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]);
    fireEvent.change(screen.getByLabelText('پاداش / مزایا (ریال)'), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText('سایر کسورات (ریال)'), { target: { value: '40000' } });
    const save = screen.getByText('ذخیره فیش پیش‌نویس').closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('شرح سایر کسورات'), { target: { value: 'قسط وام' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    const put = calls.find(c => c.options?.method === 'PUT');
    expect(put?.url).toBe('/piecework/payrolls/1');
    expect(JSON.parse(put?.options?.body ?? '{}')).toEqual({ title: 'فیش', bonuses: 250000, deductions: 40000, deductionsDescription: 'قسط وام', advanceDeduction: 0 });
  });

  it('hides the edit without the issue key', () => {
    permissions.current = { ...permissions.current, canIssuePayroll: false };
    renderWithQuery(<PieceworkPayrollsTab payrollsList={[payslip(1, 'draft')]} onOpenPayrollModal={noop} onViewPayslip={noop} onUpdateStatus={noop} onDeletePayroll={noop} />);
    expect(screen.queryByLabelText('ویرایش فیش پیش‌نویس')).toBeNull();
  });
});
