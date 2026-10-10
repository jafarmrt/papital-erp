import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useExecuteTaskMutation } from '../../hooks/queries/useWorkflowQueries';

// v10.0.133 (TD-1224): a task someone else already decided is not reported as done by this user
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: toastFn, default: toastFn }));
afterEach(() => { cleanup(); fetchJson.mockReset(); toastFn.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('stale inbox task (TD-1224)', () => {
  it('says the task was already done by someone else, never a green success', async () => {
    fetchJson.mockResolvedValue({
      success: true,
      message: 'این کار پیش‌تر انجام شده است؛ کارتابل را تازه کنید.',
      data: { idempotent: true, code: 'WF_TASK_ALREADY_COMPLETED', task: { id: 3, status: 'approved' } },
    });
    const { result } = renderHook(() => useExecuteTaskMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ taskId: 3, action: 'approve' }); });
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(String(toastFn.mock.calls[0]?.[0])).toContain('کاربر دیگری');
  });

  it('a decided task still shows success', async () => {
    fetchJson.mockResolvedValue({ success: true, message: 'کار انجام شد.', data: { task: { status: 'approved' } } });
    const { result } = renderHook(() => useExecuteTaskMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ taskId: 4, action: 'approve' }); });
    await waitFor(() => expect(toastFn.success).toHaveBeenCalledWith('کار انجام شد.'));
  });
});
