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

// v11 phase 6.1a (C10, reviews of #403): a review refused as stale (409) closes and reads the list again; reopening the
// log gives its stored version and keeps the notes the manager typed, also after another log was opened in between. The
// review sends the review state the form opened, so the server refuses one made over another manager's review.

const user = { id: 1, username: 'manager' } as unknown as User;
const TYPED_NOTES = 'typed review notes';
const OTHER_NOTES = 'notes of another manager';

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
    await waitFor(() => expect((result.current.logs[0] as DailyWorkLog).version).toBe(2));
    act(() => result.current.handleOpenReviewModal(result.current.logs[0] as DailyWorkLog));
    expect(result.current.reviewModalLog?.version).toBe(2);
    expect(result.current.reviewNotes).toBe(TYPED_NOTES);
  });

  it('closes the form at once on a 409, without waiting for the list to be read again', async () => {
    let listReads = 0;
    fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return Promise.reject(Object.assign(new Error('stale'), { status: 409 }));
      if (url === '/daily-logs/stats') return Promise.resolve({ todayHours: 0 });
      if (url.startsWith('/daily-logs?')) {
        listReads += 1;
        // the reload after the 409 never answers here
        return listReads === 1 ? Promise.resolve({ data: [{ id: 7, title: 'log', version: 1, managerNotes: '' }], total: 1 }) : new Promise(() => undefined);
      }
      return Promise.resolve([]);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDailyLogs(user), { wrapper });
    await waitFor(() => expect(result.current.logs).toHaveLength(1));

    act(() => result.current.handleOpenReviewModal(result.current.logs[0] as DailyWorkLog));
    await act(async () => {
      await Promise.race([result.current.handleSaveReview(), new Promise(resolve => setTimeout(resolve, 300))]);
    });
    expect(result.current.reviewModalLog).toBeNull();
  });

  it('sends the review state the form opened and keeps the draft while another log is opened', async () => {
    const puts: Record<string, unknown>[] = [];
    fetchJson.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(init.body ?? '{}'));
        return Promise.reject(Object.assign(new Error('stale'), { status: 409 }));
      }
      if (url === '/daily-logs/stats') return Promise.resolve({ todayHours: 0 });
      if (url.startsWith('/daily-logs?')) {
        return Promise.resolve({ data: [
          { id: 7, title: 'log', version: 1, status: 'reviewed', managerNotes: OTHER_NOTES },
          { id: 8, title: 'other', version: 1, status: 'submitted', managerNotes: '' },
        ], total: 2 });
      }
      return Promise.resolve([]);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDailyLogs(user), { wrapper });
    await waitFor(() => expect(result.current.logs).toHaveLength(2));
    const logById = (id: number) => result.current.logs.find(l => l.id === id) as DailyWorkLog;

    act(() => result.current.handleOpenReviewModal(logById(7)));
    expect(result.current.reviewNotes).toBe(OTHER_NOTES);
    act(() => result.current.setReviewNotes(TYPED_NOTES));
    await act(async () => { await result.current.handleSaveReview(); });
    expect(puts[0]).toMatchObject({ manager_notes: TYPED_NOTES, version: 1, opened_status: 'reviewed', opened_manager_notes: OTHER_NOTES });

    act(() => result.current.handleOpenReviewModal(logById(8)));
    expect(result.current.reviewNotes).toBe('');
    act(() => result.current.setReviewModalLog(null));
    act(() => result.current.handleOpenReviewModal(logById(7)));
    expect(result.current.reviewNotes).toBe(TYPED_NOTES);
  });
});
