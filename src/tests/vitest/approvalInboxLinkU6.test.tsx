import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalInboxPage } from '../../pages/ApprovalInboxPage';

// v11 phase 6.3p (U6, review): a task notice's link reads its task from the server, not from the cached inbox page; the
// page may have been read before the task arrived (five minutes stale, no refetch on mount) or may not hold it (page 1 of 50)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const task = {
  id: 51, instanceId: 9, transitionId: 21, status: 'pending', title: 'approve invoice INV-9', description: '', dueAt: '2099-01-01 00:00:00',
  createdAt: '2026-10-27 08:00:00', isOverdue: false, entityType: 'document', entityId: '9', refNumber: 'INV-9', delegationInfo: null,
  instance: { id: 9, workflowDefinitionId: 1, entityType: 'document', entityId: '9', currentStateId: 11, status: 'IN_PROGRESS' },
};
const GONE = /این کار دیگر در کارتابل شما نیست/;

/** the inbox page (without instanceId) never holds the task; the instance read holds it when the server still has it */
function serve(serverHasTask: boolean) {
  fetchJson.mockImplementation((url: string) => {
    if (url.startsWith('/workflow/tasks/stats')) return Promise.resolve({ pendingCount: 0 });
    if (url.startsWith('/workflow/tasks/my-tasks')) {
      const rows = url.includes('instanceId=9') && serverHasTask ? [task] : [];
      return Promise.resolve({ data: rows, total: rows.length, page: 1, limit: 50 });
    }
    if (url.startsWith('/documents/')) return Promise.resolve({ id: 9, refNumber: 'INV-9', items: [] });
    return Promise.resolve({});
  });
}

function renderLinked(instance: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
  // the inbox page read before the task arrived, still fresh
  client.setQueryData(['workflow', 'tasks', 'my-tasks', 'pending', 1, 50], { data: [], total: 0, page: 1, limit: 50 });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/approval-inbox?instance=${instance}`]}><ApprovalInboxPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('inbox link to one task reads it from the server (U6)', () => {
  it('opens a task the cached inbox page does not hold', async () => {
    serve(true);
    renderLinked(9);
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-label')).toContain('approve invoice INV-9'));
    expect(screen.queryByText(GONE)).toBeNull();
    expect(fetchJson.mock.calls.some(([url]) => String(url).includes('/workflow/tasks/my-tasks?') && String(url).includes('instanceId=9'))).toBe(true);
  });

  it('says the task is gone only after the server says so', async () => {
    serve(false);
    renderLinked(9);
    await waitFor(() => expect(screen.getByText(GONE)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
