import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalInboxPage } from '../../pages/ApprovalInboxPage';

// Approval inbox page against the row shapes /workflow/tasks/* return (package 14, PR د)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const instance = (id: number, entityId: string, entityType = 'document') => ({
  id, workflowDefinitionId: 1, entityType, entityId, currentStateId: 11, status: 'IN_PROGRESS',
  createdAt: '2026-10-05 08:00:00', updatedAt: '2026-10-05 08:00:00',
});

// row of WorkflowTaskService.getMyTasks
const taskRow = (id: number, entityId: string, extra: Record<string, unknown> = {}) => ({
  id, instanceId: id, transitionId: 21, assignedUserId: null, assignedRole: 'manager', candidateUsers: [], candidateRoles: ['manager'],
  delegatedToUserId: null, status: 'pending', title: `تأیید سند ${entityId}`, description: '', dueAt: '2099-01-01 00:00:00',
  completedAt: null, slaRemindedAt: null, createdAt: '2026-10-05 08:00:00', isOverdue: false,
  entityType: 'document', entityId, instance: instance(id, entityId),
  refNumber: `INV-${entityId}`, buyerName: `خریدار ${entityId}`, amount: 1_250_000,
  delegationInfo: null,
  ...extra,
});

type Route = (url: string, init?: RequestInit) => unknown;
function routeFetch(route: Route) {
  fetchJson.mockImplementation((url: string, init?: RequestInit) => Promise.resolve(route(url, init)));
}

const inboxRoutes = (rows: unknown[], extra: Route = () => ({})): Route => (url, init) => {
  if (url.startsWith('/workflow/tasks/stats')) return { pendingCount: rows.length, overdueCount: 0, delegatedCount: 0, completedCount: 0 };
  if (url.startsWith('/workflow/tasks/my-tasks')) return { data: rows, total: rows.length, page: 1, limit: 50 };
  if (url.startsWith('/documents/')) return { id: Number(url.split('/').pop()), refNumber: url, items: [] };
  if (url.includes('/execute')) return { success: true, data: { task: { status: 'approved' } } };
  return extra(url, init);
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApprovalInboxPage />
    </QueryClientProvider>,
  );
}

const openButtons = () => screen.getAllByText('بررسی و تعیین تکلیف وظیفه');
const executeBody = (taskId: number) => {
  const call = fetchJson.mock.calls.find((c) => c[0] === `/workflow/tasks/${taskId}/execute`);
  return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
};

describe('TD-462 a cancelled decision does not carry over to the next task', () => {
  it('reject and a comment typed for task 1 and then cancelled are cleared when task 2 opens', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1'), taskRow(2, '2')]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    fireEvent.click(openButtons()[0]);
    fireEvent.click(await screen.findByText('رد و مخالفت با درخواست'));
    fireEvent.change(screen.getByPlaceholderText(/دلیل رد/), { target: { value: 'مبلغ سند ۱ اشتباه است' } });
    fireEvent.click(screen.getByText('انصراف'));

    fireEvent.click(openButtons()[1]);
    expect(await screen.findByText(/«تأیید سند 2»/)).toBeTruthy();
    expect(screen.queryByDisplayValue('مبلغ سند ۱ اشتباه است')).toBeNull();
    fireEvent.click(screen.getByText('تایید و ثبت نهایی وظیفه'));
    await waitFor(() => expect(executeBody(2)).toBeDefined());
    expect(executeBody(2)).toMatchObject({ taskId: 2, action: 'approve', comment: '' });
  });

  it('closing with the X button clears the decision too', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1'), taskRow(2, '2')]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    fireEvent.click(openButtons()[0]);
    fireEvent.click(await screen.findByText('رد و مخالفت با درخواست'));
    fireEvent.change(screen.getByPlaceholderText(/دلیل رد/), { target: { value: 'دلیل کار اول' } });
    fireEvent.click(screen.getByLabelText('بستن'));

    fireEvent.click(openButtons()[1]);
    await screen.findByText(/«تأیید سند 2»/);
    expect(screen.queryByDisplayValue('دلیل کار اول')).toBeNull();
    expect(screen.getByText('تایید و ثبت نهایی وظیفه')).toBeTruthy();
  });
});
