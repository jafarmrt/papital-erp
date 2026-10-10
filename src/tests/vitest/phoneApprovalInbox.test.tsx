import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { TaskExecuteModal } from '../../components/approval/TaskExecuteModal';
import { OFFLINE_SUBMIT_TITLE, PHONE_SHEET_OVERLAY, PHONE_SHEET_PANEL, PHONE_TAP_TARGET } from '../../lib/pwa/phoneLayout';

// v10.0.18 (D-11, plan MOBILE_WORKSHOP_PLAN.md section 3.2): the approvals inbox on a phone. The task window takes the whole
// screen, the approve and reject buttons are large and stacked, each card opens with a full-width button, and the decision
// is not sent while the phone is offline (decision t10-a: a write is never resent automatically after a network error).

const task = { id: 41, title: 'تأیید پیش‌فاکتور', status: 'pending', createdAt: '2026-10-01T08:00:00Z', instance: { id: 9, entityType: 'document', entityId: 12 } };

vi.mock('../../hooks/queries', () => ({
  useMyTasksQuery: () => ({ data: [task], isLoading: false, isFetching: false, refetch: () => Promise.resolve() }),
  useTaskStatsQuery: () => ({ data: { pendingCount: 1 }, refetch: () => Promise.resolve() }),
  useExecuteTaskMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('../../hooks/useApprovalTaskEntity', () => ({
  useApprovalTaskEntity: () => ({ docDetails: null, isLoadingDoc: false, requisitionDetails: null, isLoadingRequisition: false }),
}));

const { ApprovalInboxPage } = await import('../../pages/ApprovalInboxPage');

afterEach(() => {
  cleanup();
  act(() => { window.dispatchEvent(new Event('online')); });
});

function renderModal(onExecute = vi.fn()) {
  render(
    <TaskExecuteModal
      selectedTask={{ id: 41, title: 'تأیید پیش‌فاکتور', instance: { entityType: 'pending_material', entityId: 3 } }}
      onClose={() => undefined}
      docDetails={null}
      isLoadingDoc={false}
      onPrintDoc={() => undefined}
      taskAction="approve"
      onTaskActionChange={() => undefined}
      comment=""
      onCommentChange={() => undefined}
      onExecute={onExecute}
      isExecuting={false}
    />,
  );
  return onExecute;
}

function classesOf(element: Element | null): string {
  return element?.getAttribute('class') ?? '';
}

describe('approvals inbox on a phone (D-11)', () => {
  it('opens the task window over the whole phone screen', () => {
    renderModal();
    const panel = screen.getByRole('dialog');
    expect(classesOf(panel)).toContain(PHONE_SHEET_PANEL);
    expect(classesOf(panel.parentElement)).toContain(PHONE_SHEET_OVERLAY);
  });

  it('stacks large approve and reject buttons on a phone', () => {
    renderModal();
    const decisions = screen.getByRole('group', { name: 'تصمیم شما' });
    expect(classesOf(decisions)).toContain('grid-cols-1 sm:grid-cols-2');
    for (const button of within(decisions).getAllByRole('button')) expect(classesOf(button)).toContain(PHONE_TAP_TARGET);
  });

  it('does not send the decision while the phone is offline', () => {
    renderModal();
    // v10.0.91 (TD-1177): the submit button names the task's own action
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: /ثبت «تأیید پیش‌فاکتور»/ });
    expect(submit.disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe(OFFLINE_SUBMIT_TITLE);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(submit.disabled).toBe(false);
  });

  it('opens each task card with a full-width tap target', () => {
    render(<ApprovalInboxPage />);
    const open = screen.getByRole('button', { name: /بررسی و تعیین تکلیف وظیفه/ });
    expect(classesOf(open)).toContain('w-full sm:w-auto');
    expect(classesOf(open)).toContain(PHONE_TAP_TARGET);
  });
});
