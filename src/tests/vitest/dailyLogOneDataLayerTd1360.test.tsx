import type { FormEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '../../types';

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
import { useDashboardDailyLogs } from '../../hooks/useDashboardDailyLogs';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';

// v10.2 package 11 part 5b (TD-1360, OBS-R2-102): the daily log page reads its list, statistics, summary and pick
// lists through React Query. Each test but the page reset guard is red on the hook that kept them in its own state.

const user = { id: 1, username: 'u' } as unknown as User;

function newClient() {
  // the app's freshness window (src/lib/queryClient.ts), so a test sees what a cached screen would
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}
function wrapperOf(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const urls = () => fetchJson.mock.calls.map(c => String(c[0]));
const callsOf = (url: string) => urls().filter(u => u === url).length;
const listUrls = () => urls().filter(u => u.startsWith('/daily-logs?filter_type=all&page=') && u.includes('limit=30'));

function answer(logs: Array<{ id: number }>) {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method) return Promise.resolve({});
    if (url === '/daily-logs/stats') return Promise.resolve({ todayHours: 1 });
    if (url.startsWith('/daily-logs?')) return Promise.resolve({ data: logs, total: 90 });
    return Promise.resolve([]);
  });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('daily_log_one_data_layer_td_1360', () => {
  it('a log saved on the daily log page shows on the dashboard at once', async () => {
    answer([{ id: 1 }]);
    const client = newClient();
    const dashboard = renderHook(() => useDashboardDailyLogs(true), { wrapper: wrapperOf(client) });
    const page = renderHook(() => useDailyLogs(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(dashboard.result.current.logs).toHaveLength(1));
    await waitFor(() => expect(page.result.current.logs).toHaveLength(1));
    answer([{ id: 1 }, { id: 2 }]);
    act(() => {
      page.result.current.setFormTitle('بسته‌بندی');
      page.result.current.setFormContent('بسته‌بندی سفارش‌ها');
    });
    await act(async () => { await page.result.current.handleSaveLog({ preventDefault: () => undefined } as FormEvent); });
    await waitFor(() => expect(dashboard.result.current.logs).toHaveLength(2));
    await waitFor(() => expect(page.result.current.logs).toHaveLength(2));
  });

  it('turning a page reads that page only, not the statistics again', async () => {
    answer([{ id: 1 }]);
    const { result } = renderHook(() => useDailyLogs(user), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(listUrls().some(u => u.includes('page=2'))).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(callsOf('/daily-logs/stats')).toBe(1);
  });

  it('opening the page again reads its logs again and the user and project pick lists once', async () => {
    answer([]);
    const client = newClient();
    const first = renderHook(() => useDailyLogs(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useDailyLogs(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect([callsOf('/users/list-simple'), callsOf(PICK_LIST_URLS.projects)]).toEqual([1, 1]);
    // the logs and statistics are read again, as every opening of the page did before
    expect([listUrls().length, callsOf('/daily-logs/stats')]).toEqual([2, 2]);
  });

  it('a filter change on a later page asks only for page 1 of the new filter', async () => {
    answer([{ id: 1 }]);
    const { result } = renderHook(() => useDailyLogs(user), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSelectedWorkMode('remote'));
    await waitFor(() => expect(urls().some(u => u.includes('work_mode=remote'))).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(1);
    expect(urls().filter(u => u.includes('work_mode=remote'))).toEqual([
      '/daily-logs?filter_type=all&page=1&limit=30&work_mode=remote',
    ]);
  });
});
