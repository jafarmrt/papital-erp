import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalInboxPage } from '../../pages/ApprovalInboxPage';
import { formatPersianPrice } from '../../utils';

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

describe('TD-463 a step with several reject actions asks which one', () => {
  const rejectTransitions = [{ id: 31, title: 'رد و بازگشت به انبار' }, { id: 32, title: 'رد نهایی' }];

  it('the chosen reject action goes out as transitionId and reject waits for the choice', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1', { rejectTransitions })]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    fireEvent.click(openButtons()[0]);
    fireEvent.click(await screen.findByText('رد و مخالفت با درخواست'));
    fireEvent.change(screen.getByPlaceholderText(/دلیل رد/), { target: { value: 'کالا ناقص است' } });
    const submit = screen.getByText('رد و عودت وظیفه').closest('button')!;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('رد نهایی'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(executeBody(1)).toBeDefined());
    expect(executeBody(1)).toMatchObject({ taskId: 1, action: 'reject', comment: 'کالا ناقص است', transitionId: 32 });
  });

  it('a step with one reject action needs no choice and sends no transitionId', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1', { rejectTransitions: [rejectTransitions[0]] })]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    fireEvent.click(openButtons()[0]);
    fireEvent.click(await screen.findByText('رد و مخالفت با درخواست'));
    expect(screen.queryByLabelText('رد نهایی')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/دلیل رد/), { target: { value: 'کالا ناقص است' } });
    fireEvent.click(screen.getByText('رد و عودت وظیفه'));
    await waitFor(() => expect(executeBody(1)).toBeDefined());
    expect(executeBody(1).transitionId).toBeUndefined();
  });
});

describe('TD-464 the task modal shows only the opened task entity', () => {
  it('a late document response of a closed task is ignored and its request is aborted', async () => {
    let resolveDoc1: (v: unknown) => void = () => {};
    let doc1Signal: AbortSignal | undefined;
    fetchJson.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/documents/1') {
        doc1Signal = init?.signal ?? undefined;
        return new Promise((r) => { resolveDoc1 = r; });
      }
      if (url === '/documents/2') return Promise.resolve({ id: 2, refNumber: 'INV-2', buyerName: 'خریدار دوم', items: [] });
      return Promise.resolve(inboxRoutes([taskRow(1, '1'), taskRow(2, '2')])(url, init));
    });
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    fireEvent.click(openButtons()[0]);
    fireEvent.click(screen.getByText('انصراف'));
    expect(doc1Signal?.aborted).toBe(true);
    fireEvent.click(openButtons()[1]);
    expect(await screen.findByText('خریدار دوم')).toBeTruthy();
    await act(async () => { resolveDoc1({ id: 1, refNumber: 'INV-1', buyerName: 'خریدار اول', items: [] }); });
    expect(screen.getByText(/«تأیید سند 2»/)).toBeTruthy();
    expect(screen.queryByText('خریدار اول')).toBeNull();
    expect(screen.getByText('خریدار دوم')).toBeTruthy();
  });

  it('a requisition task reads the requisition once', async () => {
    const row = taskRow(1, '7', { entityType: 'purchase_requisition', instance: instance(1, '7', 'purchase_requisition') });
    routeFetch(inboxRoutes([row], (url) => (url === '/procurement/requisitions/7'
      ? { success: true, data: { id: 7, code: 'PR-7', title: 'خرید', items: [] } }
      : {})));
    renderPage();
    await screen.findAllByText('تأیید سند 7');
    fireEvent.click(openButtons()[0]);
    await screen.findByText('PR-7');
    expect(fetchJson.mock.calls.filter((c) => c[0] === '/procurement/requisitions/7')).toHaveLength(1);
  });
});

describe('TD-465 the task card shows the fields the inbox row carries', () => {
  it('amount in rials, the delegation badge, the current step and the starter', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1', {
      delegationInfo: { delegatedFromUserId: 4, delegationScope: 'ALL' },
      currentStepTitle: 'بررسی مالی',
      instance: { ...instance(1, '1'), startedBy: 3, startedByName: 'مریم احمدی' },
    })]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    expect(screen.getByText(formatPersianPrice(1_250_000, 'IRR'))).toBeTruthy();
    expect(screen.getByText('از تفویض')).toBeTruthy();
    expect(screen.getByText('بررسی مالی')).toBeTruthy();
    expect(screen.getByText('مریم احمدی')).toBeTruthy();
    expect(screen.queryByText('ثبت‌کننده سیستم')).toBeNull();
  });

  it('a task without delegation has no delegation badge', async () => {
    routeFetch(inboxRoutes([taskRow(1, '1', { currentStepTitle: 'بررسی مالی' })]));
    renderPage();
    await screen.findAllByText('تأیید سند 1');
    expect(screen.queryByText('از تفویض')).toBeNull();
  });
});
