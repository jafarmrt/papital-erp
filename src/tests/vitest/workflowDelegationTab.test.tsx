import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WorkflowDelegationTab } from '../../components/workflow/WorkflowDelegationTab';

// Workflow delegation tab (package 14, PR د)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'admin' }, userPermissions: { permissions: [], isAdmin: true } }),
}));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const definitions = [
  { id: 1, code: 'DOC_APPROVAL_WORKFLOW', title: 'تأیید فاکتور' },
  { id: 2, code: 'JOURNAL_VOUCHER_WORKFLOW', title: 'تأیید سند حسابداری' },
];

function routeDelegations(delegations: unknown[] = []) {
  fetchJson.mockImplementation((url: string) => {
    if (url === '/workflow/delegations') return Promise.resolve({ success: true, data: delegations });
    if (url === '/workflow/definitions') return Promise.resolve(definitions);
    if (url === '/users') return Promise.resolve([{ id: 2, username: 'deputy', full_name: 'جانشین' }]);
    return Promise.resolve({});
  });
}

describe('TD-467 delegation scope options are ALL and the defined workflows only', () => {
  it('offers no scope that matches no workflow', async () => {
    routeDelegations();
    wrap(<WorkflowDelegationTab />);
    fireEvent.click(await screen.findByText('ایجاد تفویض اختیار جدید'));
    await screen.findByText(/تأیید سند حسابداری/);
    const scopeSelect = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'ALL'))!;
    expect(Array.from(scopeSelect.options).map((o) => o.value)).toEqual(['ALL', 'DOC_APPROVAL_WORKFLOW', 'JOURNAL_VOUCHER_WORKFLOW']);
  });
});

describe('TD-468 delegation dates are business days', () => {
  it('the form sends the chosen days, not UTC midnight timestamps', async () => {
    routeDelegations();
    wrap(<WorkflowDelegationTab />);
    fireEvent.click(await screen.findByText('ایجاد تفویض اختیار جدید'));
    await screen.findByText(/تأیید سند حسابداری/);
    const userSelect = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === '2'))!;
    fireEvent.change(userSelect, { target: { value: '2' } });
    fireEvent.submit(userSelect.closest('form')!);
    await waitFor(() => expect(fetchJson.mock.calls.some((c) => c[0] === '/workflow/delegations' && (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const call = fetchJson.mock.calls.find((c) => c[0] === '/workflow/delegations' && (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the list shows a UTC timestamp on its Tehran day', async () => {
    routeDelegations([{
      id: 5, fromUserId: 1, toUserId: 2, fromUserName: 'مدیر', toUserName: 'جانشین', scope: 'ALL', status: 'active', reason: '',
      startDate: '2026-10-05T21:00:00Z', endDate: '2026-10-07T20:29:59.999Z', createdAt: '2026-10-05T21:00:00Z',
    }]);
    wrap(<WorkflowDelegationTab />);
    expect(await screen.findByText('از: ۱۴۰۵/۰۷/۱۴')).toBeTruthy();
    expect(screen.getByText('تا: ۱۴۰۵/۰۷/۱۵')).toBeTruthy();
  });
});
