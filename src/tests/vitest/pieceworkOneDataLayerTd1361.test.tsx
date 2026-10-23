import { useState, type FormEvent } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../utils', async () => ({
  ...await vi.importActual<typeof import('../../utils')>('../../utils'),
  getTodayJalaliDate: () => '1405/07/15',
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userPermissions: { isAdmin: true, permissions: [] } }) }));
vi.mock('../../hooks/usePieceworkPermissions', () => ({
  usePieceworkPermissions: () => ({ canManageTasks: true, canLog: true, canIssuePayroll: true, canPay: true }),
}));

import { usePiecework } from '../../hooks/usePiecework';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { QUERY_KEYS } from '../../lib/queryKeys';

// v10.2 package 11 part 5c (TD-1361, OBS-R2-102): the payroll page reads its lists through React Query. Each test is red
// on the hook that kept them in its own state.

let hook: ReturnType<typeof usePiecework>;
function Probe() {
  hook = usePiecework();
  return null;
}
function newClient() {
  // the app's freshness window (src/lib/queryClient.ts), so a test sees what a cached screen would
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}
function Page({ client }: { client: QueryClient }) {
  const [c] = useState(client);
  return <QueryClientProvider client={c}><Probe /></QueryClientProvider>;
}

const urls = () => fetchJson.mock.calls.filter(c => !(c[1] as { method?: string } | undefined)?.method).map(c => String(c[0]));
const callsOf = (url: string) => urls().filter(u => u === url).length;
const logPageCalls = () => urls().filter(u => u.startsWith('/piecework/logs?') && u.includes('limit=')).length;
const fakeEvent = { preventDefault: () => undefined } as FormEvent;

const TASKS = {
  active: [{ id: 1, title: 'برش', category: 'تولید', defaultRate: 100 }],
  archived: [{ id: 2, title: 'پرداخت قدیمی', category: 'تولید', defaultRate: 50 }],
  all: [{ id: 1, title: 'برش', category: 'تولید', defaultRate: 100 }, { id: 2, title: 'پرداخت قدیمی', category: 'تولید', defaultRate: 50 }],
};

function answer(overrides: (url: string) => unknown = () => undefined) {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
    const special = overrides(url);
    if (special !== undefined) return special as Promise<unknown>;
    if (init?.method) return Promise.resolve({ payrollNumber: 'P-1' });
    if (url === '/personnel') return Promise.resolve([{ id: 5, fullName: 'رضا', salaryType: 'piecework' }]);
    if (url.startsWith('/piecework/tasks?status=')) return Promise.resolve(TASKS[url.split('=')[1] as keyof typeof TASKS]);
    if (url === '/piecework/payrolls') return Promise.resolve([{ id: 9, personnelId: 5, status: 'draft' }]);
    if (url.startsWith('/piecework/logs/summary')) return Promise.resolve({ totalAmount: 0, pendingAmount: 0, logCount: 0, projects: [] });
    if (url.startsWith('/piecework/logs?')) return Promise.resolve(url.includes('limit=') ? { data: [], total: 0, page: 1, limit: 100, totalAmount: 0 } : []);
    return Promise.resolve([]);
  });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('piecework_one_data_layer_td_1361', () => {
  it('saving a work log reads the piecework lists again, not the personnel and project lists', async () => {
    answer();
    render(<Page client={newClient()} />);
    await waitFor(() => expect(hook.loading).toBe(false));
    await waitFor(() => expect(logPageCalls()).toBe(1));
    act(() => {
      hook.handleOpenAddLogModal();
      hook.setSelectedPersonnelForLog(5);
      hook.setLogDate('1405/07/10');
      hook.setBatchLogRows([{ rowKey: 'r1', taskId: 1, projectId: '', quantity: '3', unitRate: 100 }]);
    });
    await act(async () => { await hook.handleSaveLogs(fakeEvent); });
    await waitFor(() => expect(logPageCalls()).toBe(2));
    await waitFor(() => expect(callsOf('/piecework/payrolls')).toBe(2));
    expect([callsOf('/personnel'), callsOf(PICK_LIST_URLS.projects)]).toEqual([1, 1]);
  });

  it('switching the title status quickly never shows the titles of another status', async () => {
    let releaseArchived: (rows: unknown) => void = () => undefined;
    answer((url) => (url === '/piecework/tasks?status=archived'
      ? new Promise((resolve) => { releaseArchived = resolve; })
      : undefined));
    render(<Page client={newClient()} />);
    await waitFor(() => expect(hook.tasksList.map(t => t.id)).toEqual([1]));
    act(() => hook.handleTaskStatusFilterChange('archived'));
    act(() => hook.handleTaskStatusFilterChange('all'));
    await waitFor(() => expect(hook.tasksList.map(t => t.id)).toEqual([1, 2]));
    // the archived titles answer last
    await act(async () => { releaseArchived(TASKS.archived); await Promise.resolve(); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hook.tasksList.map(t => t.id)).toEqual([1, 2]);
    expect(hook.taskStatusFilter).toBe('all');
  });

  it('approving a payslip refreshes the treasury and voucher screens with the page', async () => {
    answer();
    const client = newClient();
    client.setQueryData(QUERY_KEYS.accounting.treasury(), { balances: [] });
    client.setQueryData(QUERY_KEYS.accounting.vouchers({ page: 1 }), { data: [] });
    render(<Page client={client} />);
    await waitFor(() => expect(hook.loading).toBe(false));
    await act(async () => { await hook.handleUpdatePayrollStatus(9, 'approved'); });
    await waitFor(() => expect(callsOf('/piecework/payrolls')).toBe(2));
    expect(client.getQueryState(QUERY_KEYS.accounting.treasury())?.isInvalidated).toBe(true);
    expect(client.getQueryState(QUERY_KEYS.accounting.vouchers({ page: 1 }))?.isInvalidated).toBe(true);
  });

  it('a payment from the payslip window or the payslip list refreshes the treasury and voucher screens', () => {
    const page = readFileSync('src/pages/PieceworkPayrollPage.tsx', 'utf8');
    expect(page.match(/onReload=\{reloadAfterPayrollChange\}/g)?.length).toBe(2);
    expect(readFileSync('src/hooks/usePiecework.ts', 'utf8')).toContain('invalidateAfterTreasuryChange(queryClient)');
  });

  it('opening the page again reads the payslips, work logs and personnel again and the project list once', async () => {
    answer();
    const client = newClient();
    const first = render(<Page client={client} />);
    await waitFor(() => expect(hook.loading).toBe(false));
    await waitFor(() => expect(logPageCalls()).toBe(1));
    first.unmount();
    render(<Page client={client} />);
    await waitFor(() => expect(logPageCalls()).toBe(2));
    await waitFor(() => expect(callsOf('/piecework/payrolls')).toBe(2));
    await waitFor(() => expect(callsOf('/personnel')).toBe(2));
    expect(callsOf(PICK_LIST_URLS.projects)).toBe(1);
  });

  it('the payslip form reads the pending logs again each time it opens', async () => {
    answer();
    render(<Page client={newClient()} />);
    await waitFor(() => expect(hook.loading).toBe(false));
    const previewCalls = () => urls().filter(u => u.startsWith('/piecework/logs?') && u.includes('status=pending') && !u.includes('limit=')).length;
    const open = () => act(() => {
      hook.setIsPayrollModalOpen(true);
      hook.setPayrollPersonnelId(5);
      hook.setPayrollStartDate('1405/06/01');
      hook.setPayrollEndDate('1405/06/31');
    });
    open();
    await waitFor(() => expect(previewCalls()).toBe(1));
    act(() => hook.setIsPayrollModalOpen(false));
    expect(hook.payrollPreviewLogs).toEqual([]);
    open();
    await waitFor(() => expect(previewCalls()).toBe(2));
  });
});
