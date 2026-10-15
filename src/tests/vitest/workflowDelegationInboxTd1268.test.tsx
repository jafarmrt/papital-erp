import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * v10.1.16 (D-06 part C, TD-1268 / TD-1265): «تفویض کارهایم» in the approval inbox for the holders of the delegation keys,
 * reading the simple user list and the scope endpoint, with «تفویض‌های من» (revoke only what the user gave); and the
 * system admin's «بستن فرایند» of a running record with a required reason, never offered for a purchase requisition.
 * Red on v10.1.11, where neither component existed.
 */

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

let held = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'approver' }, userPermissions: { permissions: [...held], isAdmin: false } }),
  useHasPermission: (key: string) => held.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => held.has(key)),
}));

const { MyDelegationsButton } = await import('../../components/workflow/MyDelegationsWindow');
const { WorkflowInstanceTerminate } = await import('../../components/workflow/WorkflowInstanceTerminate');

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  held = new Set();
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const mine = [
  { id: 11, fromUserId: 1, toUserId: 2, fromUserName: 'من', toUserName: 'جانشین اول', scope: 'ALL', scopeTitle: null, status: 'active', startDate: '2026-10-20T00:00:00Z', endDate: '2026-10-25T00:00:00Z' },
  { id: 12, fromUserId: 3, toUserId: 1, fromUserName: 'همکار', toUserName: 'من', scope: 'JV', scopeTitle: 'تأیید سند حسابداری', status: 'scheduled', startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-02T00:00:00Z' },
];

function routeInbox() {
  fetchJson.mockImplementation((url: string) => {
    if (url === '/workflow/delegations?mine=1') return Promise.resolve({ success: true, data: mine });
    if (url === '/workflow/delegation-scopes') return Promise.resolve({ success: true, data: [{ code: 'JV', title: 'تأیید سند حسابداری' }] });
    if (url === '/users/list-simple') return Promise.resolve([{ id: 1, username: 'approver', full_name: 'من' }, { id: 2, username: 'deputy', full_name: 'جانشین اول' }]);
    return Promise.resolve({ success: true });
  });
}

describe('TD-1268 the inbox delegation window', () => {
  it('is hidden without a delegation key', () => {
    held = new Set(['workflow.view']);
    routeInbox();
    wrap(<MyDelegationsButton />);
    expect(screen.queryByText('تفویض کارهایم')).toBeNull();
  });

  it('opens the form with the simple user list (never the user directory) and lists my delegations', async () => {
    held = new Set(['workflow.view', 'workflow.approve']);
    routeInbox();
    wrap(<MyDelegationsButton />);
    fireEvent.click(screen.getByText('تفویض کارهایم'));
    expect(await screen.findByText('به «جانشین اول»')).toBeTruthy();
    expect(screen.getByText('از «همکار»')).toBeTruthy();
    expect(screen.getByText('گردش کار: تأیید سند حسابداری', { selector: 'div' })).toBeTruthy();
    await screen.findByRole('option', { name: 'جانشین اول' });
    const userOptions = screen.getAllByRole('option').map(o => o.textContent);
    expect(userOptions).not.toContain('من');
    const urls = fetchJson.mock.calls.map(c => c[0]);
    expect(urls).not.toContain('/users');
    expect(urls).not.toContain('/workflow/definitions');
    // only the delegation the user gave has «لغو تفویض»
    expect(screen.getAllByText('لغو تفویض')).toHaveLength(1);
  });

  it('shows the server refusal of an overlapping delegation', async () => {
    held = new Set(['workflow.approve']);
    routeInbox();
    const refusal = 'در این بازه تفویض شماره ۱۱ به «جانشین اول» برای همین گردش کار هست؛ یک نفر در یک بازه یک جانشین دارد.';
    const base = fetchJson.getMockImplementation()!;
    fetchJson.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/workflow/delegations' && init?.method === 'POST') return Promise.reject(new Error(refusal));
      return base(url, init);
    });
    const toast = await import('react-hot-toast');
    const errorSpy = vi.spyOn(toast.toast, 'error');
    wrap(<MyDelegationsButton />);
    fireEvent.click(screen.getByText('تفویض کارهایم'));
    await screen.findByRole('option', { name: 'جانشین اول' });
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.submit(select.closest('form')!);
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith(refusal));
  });
});

describe('TD-1265 closing a running record by hand', () => {
  const history = [{ id: 1, instanceId: 5, actionKey: 'terminate', comment: 'گام امضاکننده ندارد', createdAt: '2026-10-15T10:00:00Z' }];

  it('is offered only to the workflow switch key and not for a purchase requisition', () => {
    held = new Set(['workflow.manage']);
    const { unmount } = wrap(<WorkflowInstanceTerminate instance={{ id: 5, status: 'IN_PROGRESS' }} entityType="journal_voucher" entityId={9} history={[]} />);
    expect(screen.queryByText('بستن فرایند')).toBeNull();
    unmount();
    held = new Set(['workflow.admin']);
    const second = wrap(<WorkflowInstanceTerminate instance={{ id: 5, status: 'IN_PROGRESS' }} entityType="purchase_requisition" entityId={9} history={[]} />);
    expect(screen.queryByText('بستن فرایند')).toBeNull();
    second.unmount();
    wrap(<WorkflowInstanceTerminate instance={{ id: 5, status: 'IN_PROGRESS' }} entityType="journal_voucher" entityId={9} history={[]} />);
    expect(screen.getByText('بستن فرایند')).toBeTruthy();
  });

  it('needs a reason and posts it to the instance', async () => {
    held = new Set(['workflow.admin']);
    fetchJson.mockResolvedValue({ success: true });
    wrap(<WorkflowInstanceTerminate instance={{ id: 5, status: 'IN_PROGRESS' }} entityType="journal_voucher" entityId={9} history={[]} />);
    fireEvent.click(screen.getByText('بستن فرایند'));
    const submit = screen.getAllByText('بستن فرایند').find(el => el.tagName === 'BUTTON') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('دلیل بستن (الزامی)'), { target: { value: 'گام بررسی امضاکننده ندارد' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workflow/instances/5/terminate', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse((fetchJson.mock.calls.find(c => c[0] === '/workflow/instances/5/terminate')![1] as RequestInit).body as string);
    expect(body).toEqual({ reason: 'گام بررسی امضاکننده ندارد' });
  });

  it('a closed record says so with its reason', () => {
    wrap(<WorkflowInstanceTerminate instance={{ id: 5, status: 'TERMINATED' }} entityType="journal_voucher" entityId={9} history={history} />);
    expect(screen.getByRole('status').textContent).toContain('گام امضاکننده ندارد');
  });
});
