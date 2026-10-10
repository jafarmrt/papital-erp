import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TaskExecuteModal } from '../../components/approval/TaskExecuteModal';

// v10.0.148 (TD-1179): the task window's comment field says a reason is required when rejecting, and optional otherwise
const OPTIONAL_LABEL = 'دستور / توضیحات مدیر (اختیاری):';
const REJECT_LABEL = 'دلیل رد (الزامی):';

afterEach(cleanup);

function renderModal(taskAction: 'approve' | 'reject') {
  render(
    <TaskExecuteModal
      selectedTask={{ id: 41, title: 'task', instance: { entityType: 'pending_material', entityId: 3 } }}
      onClose={() => undefined}
      docDetails={null}
      isLoadingDoc={false}
      onPrintDoc={() => undefined}
      taskAction={taskAction}
      onTaskActionChange={() => undefined}
      comment=""
      onCommentChange={() => undefined}
      onExecute={() => undefined}
      isExecuting={false}
    />,
  );
}

describe('reject reason label (TD-1179)', () => {
  it('the comment is optional when approving', () => {
    renderModal('approve');
    expect(screen.getByText(OPTIONAL_LABEL)).toBeTruthy();
  });
  it('the reason is marked required when rejecting', () => {
    renderModal('reject');
    expect(screen.queryByText(OPTIONAL_LABEL)).toBeNull();
    expect(screen.getByText(REJECT_LABEL)).toBeTruthy();
  });
});
