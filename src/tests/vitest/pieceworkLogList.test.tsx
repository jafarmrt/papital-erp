import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const requested: string[] = [];
vi.mock('../../api', () => ({
  fetchJson: async (url: string) => {
    requested.push(url);
    if (url.startsWith('/piecework/logs/summary')) {
      return { totalAmount: 900, pendingAmount: 400, logCount: 3, projects: [{ projectId: 4, title: 'سفارش مهر', totalCost: 900, logCount: 3, personnelCount: 2 }] };
    }
    if (url.startsWith('/piecework/logs')) return { data: [], total: 250, page: 1, limit: 100, totalAmount: 5000 };
    return [];
  },
}));
vi.mock('../../utils', async () => ({
  ...await vi.importActual<typeof import('../../utils')>('../../utils'),
  getTodayJalaliDate: () => '1405/07/15',
}));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userPermissions: { isAdmin: true, permissions: [] } }) }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { usePiecework } from '../../hooks/usePiecework';
import { PieceworkLogsPagination } from '../../components/piecework/PieceworkLogsPagination';
import { PieceworkProjectCostsTab } from '../../components/piecework/PieceworkProjectCostsTab';

afterEach(() => {
  cleanup();
  requested.length = 0;
});

let hook: ReturnType<typeof usePiecework>;
function HookProbe() {
  hook = usePiecework();
  return null;
}
const logRequests = () => requested.filter(u => u.startsWith('/piecework/logs') && !u.startsWith('/piecework/logs/summary'));

// v9.0.325 (TD-811, B12P-08): the piecework page reads one page of work logs for the current Jalali month from the server
describe('piecework work log list is paged on the server (TD-811)', () => {
  it('asks for the current Jalali month, one page at a time, and never the whole ledger', async () => {
    render(<HookProbe />);
    await waitFor(() => expect(logRequests().length).toBeGreaterThan(0));
    expect(requested).not.toContain('/piecework/logs');
    const first = new URLSearchParams(logRequests()[0].split('?')[1]);
    expect(first.get('startDate')).toBe('1405/07/01');
    expect(first.get('endDate')).toBe('1405/07/30');
    expect(first.get('page')).toBe('1');
    expect(first.get('limit')).toBe('100');
    await waitFor(() => expect(hook.logSummary.logCount).toBe(3));
    expect(hook.logsPageCount).toBe(3);

    act(() => hook.setLogsPage(2));
    await waitFor(() => expect(new URLSearchParams(logRequests().at(-1)?.split('?')[1]).get('page')).toBe('2'));
    // a new filter starts again from page one and goes to the server
    act(() => hook.setStatusFilter('processed'));
    await waitFor(() => {
      const last = new URLSearchParams(logRequests().at(-1)?.split('?')[1]);
      expect(last.get('status')).toBe('processed');
      expect(last.get('page')).toBe('1');
    });
  });

  it('the payslip preview asks the server for the pending logs of the person and period', async () => {
    render(<HookProbe />);
    act(() => {
      hook.setIsPayrollModalOpen(true);
      hook.setPayrollPersonnelId(5);
      hook.setPayrollStartDate('1405/06/01');
      hook.setPayrollEndDate('1405/06/31');
    });
    await waitFor(() => expect(logRequests().some(u => u.includes('personnelId=5') && u.includes('status=pending'))).toBe(true));
    const preview = new URLSearchParams(logRequests().find(u => u.includes('personnelId=5'))?.split('?')[1]);
    expect(preview.get('startDate')).toBe('1405/06/01');
    expect(preview.get('endDate')).toBe('1405/06/31');
    expect(preview.get('page')).toBeNull();
  });

  it('the pagination bar shows the count and sum of every match and moves between pages', () => {
    const onPageChange = vi.fn();
    render(<PieceworkLogsPagination state={{ page: 1, pageCount: 3, total: 250, totalAmount: 5000, onPageChange }} loading={false} />);
    expect(screen.getByText(/۲۵۰ ردیف کارکرد/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect((screen.getByTitle('صفحه قبلی') as HTMLButtonElement).disabled).toBe(true);
  });

  it('project labor costs read the personnel count from the server summary', () => {
    render(<PieceworkProjectCostsTab projectCostsSummary={[{ projectId: 4, title: 'سفارش مهر', totalCost: 900, logCount: 3, personnelCount: 2 }]} totalLoggedAmount={900} />);
    expect(screen.getByText('۲ نفر')).toBeTruthy();
    expect(screen.queryByText(/Project Labor Cost/)).toBeNull();
  });
});
