import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DailyWorkLog, User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { useDailyLogs } from '../../hooks/useDailyLogs';

// v11 phase 6.1a (C10, reviews of #403): a review refused as stale (409) reads the list again and closes; reopening the
// log gives its stored version and keeps the notes the manager typed.

const user = { id: 1, username: 'manager' } as unknown as User;
const TYPED_NOTES = 'typed review notes';

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('daily log review after a stale version', () => {
  it('reloads the list, closes the form and keeps the typed notes for the same log', async () => {
    let version = 1;
    fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return Promise.reject(Object.assign(new Error('stale'), { status: 409 }));
      if (url === '/daily-logs/stats') return Promise.resolve({ todayHours: 0 });
      if (url.startsWith('/daily-logs?')) return Promise.resolve({ data: [{ id: 7, title: 'log', version, managerNotes: '' }], total: 1 });
      return Promise.resolve([]);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDailyLogs(user), { wrapper });
    await waitFor(() => expect(result.current.logs).toHaveLength(1));

    act(() => result.current.handleOpenReviewModal(result.current.logs[0] as DailyWorkLog));
    act(() => result.current.setReviewNotes(TYPED_NOTES));
    version = 2;
    await act(async () => { await result.current.handleSaveReview(); });

    expect(result.current.reviewModalLog).toBeNull();
    expect((result.current.logs[0] as DailyWorkLog).version).toBe(2);
    act(() => result.current.handleOpenReviewModal(result.current.logs[0] as DailyWorkLog));
    expect(result.current.reviewModalLog?.version).toBe(2);
    expect(result.current.reviewNotes).toBe(TYPED_NOTES);
  });
});
