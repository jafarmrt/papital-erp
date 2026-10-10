import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TaskExecuteModal } from '../../components/approval/TaskExecuteModal';

// v10.0.150 (TD-1177): the task window names the task's own action; the keeper's receive task was offered the manager's
// «approve the purchase» labels, and it says that rows without a warehouse item are received without a stock document
const RECEIVE_TITLE = 'تحویل و ورود به انبار';
const MANAGER_APPROVE_LABEL = 'تایید درخواست جهت خرید اقلام';
const MANAGER_SUBMIT_LABEL = 'تایید نهایی و صدور مجوز خرید';
const FREE_TEXT_HINT = /بدون کالای انبار/;

afterEach(cleanup);

function renderTask(title: string) {
  render(
    <TaskExecuteModal
      selectedTask={{ id: 61, title, instance: { entityType: 'purchase_requisition', entityId: 6 } }}
      onClose={() => undefined}
      docDetails={null}
      isLoadingDoc={false}
      onPrintDoc={() => undefined}
      taskAction="approve"
      onTaskActionChange={() => undefined}
      comment=""
      onCommentChange={() => undefined}
      onExecute={() => undefined}
      isExecuting={false}
    />,
  );
}

describe('task window action labels (TD-1177)', () => {
  it('the receive task is offered its own action, not the manager approval', () => {
    renderTask(RECEIVE_TITLE);
    expect(screen.queryByText(MANAGER_APPROVE_LABEL)).toBeNull();
    expect(screen.queryByText(MANAGER_SUBMIT_LABEL)).toBeNull();
    expect(screen.getAllByText(new RegExp(RECEIVE_TITLE)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(FREE_TEXT_HINT)).toBeTruthy();
  });
  it('another requisition step shows its own title and no receive hint', () => {
    renderTask('تأیید و صدور دستور خرید');
    expect(screen.getAllByText(/تأیید و صدور دستور خرید/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(FREE_TEXT_HINT)).toBeNull();
  });
});
