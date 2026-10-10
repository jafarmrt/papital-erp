import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// v10.0.90 (TD-1178): an inbox card names its entity by the entity's own number and shows the requisition priority
const task = {
  id: 51, title: 'requisition approval', status: 'pending', createdAt: '2026-10-01T08:00:00Z', priority: 'normal', refNumber: 'PR-1405-0006',
  instance: { id: 9, entityType: 'purchase_requisition', entityId: 6, startedByName: 'Buyer Full Name' },
};
const NORMAL_PRIORITY = 'اولویت عادی';
const MEDIUM_PRIORITY = 'اولویت متوسط';
const ROW_ID_LABEL = '#۶';

vi.mock('../../hooks/queries', () => ({
  useMyTasksQuery: () => ({ data: [task], isLoading: false, isFetching: false, refetch: () => Promise.resolve() }),
  useTaskStatsQuery: () => ({ data: { pendingCount: 1 }, refetch: () => Promise.resolve() }),
  useExecuteTaskMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('../../hooks/useApprovalTaskEntity', () => ({
  useApprovalTaskEntity: () => ({ docDetails: null, isLoadingDoc: false, requisitionDetails: null, isLoadingRequisition: false }),
}));

const { ApprovalInboxPage } = await import('../../pages/ApprovalInboxPage');

afterEach(cleanup);

describe('inbox requisition card (TD-1178)', () => {
  it('shows the requisition code, not its row id', () => {
    render(<ApprovalInboxPage />);
    expect(screen.getByText(/PR-1405-0006/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(ROW_ID_LABEL))).toBeNull();
  });
  it('shows a normal priority as normal, not medium', () => {
    render(<ApprovalInboxPage />);
    expect(screen.getByText(NORMAL_PRIORITY)).toBeTruthy();
    expect(screen.queryByText(MEDIUM_PRIORITY)).toBeNull();
  });
});
