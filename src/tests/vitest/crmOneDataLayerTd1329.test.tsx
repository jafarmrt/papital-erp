import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { useCRMData } from '../../hooks/useCRMData';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { cappedPickListUrl } from '../../lib/permissions/pickListCap';
import { PERSONNEL_ACTIVE_PICK_URL } from '../../lib/personnel/personnelList';

// v10.2 package 11 part 5a (TD-1329, OBS-R2-102): the sales page reads its statistics, board and pick lists through
// React Query. Each test is red on the hook that kept them in its own state.

const user = { id: 1, username: 'u' };
const PICK_URLS = [cappedPickListUrl(PICK_LIST_URLS.customers), PERSONNEL_ACTIVE_PICK_URL, '/users/list-simple'];

function newClient() {
  // the app's freshness window (src/lib/queryClient.ts), so a test sees what a cached screen would
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}
function wrapperOf(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const callsOf = (url: string) => fetchJson.mock.calls.filter(c => String(c[0]) === url).length;
const leadCalls = () => fetchJson.mock.calls.filter(c => String(c[0]).startsWith('/crm/leads?')).length;

function answer(parties: Array<{ id: number; name: string }>, leads: Array<{ id: number; stage: string }>) {
  fetchJson.mockImplementation((url: string) => {
    if (url === cappedPickListUrl(PICK_LIST_URLS.customers)) return Promise.resolve(parties);
    if (url === '/crm/stats') return Promise.resolve({ totalLeads: leads.length });
    if (url.startsWith('/crm/leads?')) return Promise.resolve({ data: leads });
    return Promise.resolve([]);
  });
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('crm_one_data_layer_td_1329', () => {
  it('the sales page and then the customers page read each pick list once', async () => {
    answer([{ id: 1, name: 'الف' }], []);
    const client = newClient();
    const sales = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(sales.result.current.pickListsReady).toBe(true));
    sales.unmount();
    const customers = renderHook(() => useCRMData(user, { withLists: false }), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(customers.result.current.pickListsReady).toBe(true));
    expect(customers.result.current.customersList).toHaveLength(1);
    expect(PICK_URLS.map(callsOf)).toEqual([1, 1, 1]);
    expect(callsOf('/crm/stats')).toBe(1);
  });

  it('a document change refreshes the board and the statistics of an open sales page', async () => {
    answer([], [{ id: 7, stage: 'won' }]);
    const client = newClient();
    const { result } = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.leads).toHaveLength(1));
    // the proforma of the won file is voided: the server moves the file back to «پیش‌فاکتور» (TD-423)
    answer([], [{ id: 7, stage: 'proposal' }]);
    await act(async () => { await invalidatePreset(client, 'documentChange'); });
    await waitFor(() => expect(result.current.leads[0]?.stage).toBe('proposal'));
    expect(callsOf('/crm/stats')).toBe(2);
  });

  it('a party saved elsewhere appears in the open sales page\'s party picker', async () => {
    answer([{ id: 1, name: 'الف' }], []);
    const client = newClient();
    const { result } = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.customersList).toHaveLength(1));
    answer([{ id: 1, name: 'الف' }, { id: 2, name: 'ب' }], []);
    await act(async () => { await invalidatePreset(client, 'customerChange'); });
    await waitFor(() => expect(result.current.customersList).toHaveLength(2));
  });

  it('a reload after a save reads the board again and resolves once it has arrived', async () => {
    answer([], [{ id: 7, stage: 'lead' }]);
    const client = newClient();
    const { result } = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(result.current.leads).toHaveLength(1));
    answer([], [{ id: 7, stage: 'lead' }, { id: 8, stage: 'lead' }]);
    await act(async () => { await result.current.loadAllData(); });
    // the reload resolves once the new board has been read
    expect(leadCalls()).toBe(2);
    await waitFor(() => expect(result.current.leads).toHaveLength(2));
    expect(result.current.loading).toBe(false);
  });

  it('opening the sales page again reads the board and statistics again, not the pick lists', async () => {
    answer([{ id: 1, name: 'الف' }], [{ id: 7, stage: 'lead' }]);
    const client = newClient();
    const first = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(first.result.current.leads).toHaveLength(1));
    first.unmount();
    const second = renderHook(() => useCRMData(user), { wrapper: wrapperOf(client) });
    await waitFor(() => expect(leadCalls()).toBe(2));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(callsOf('/crm/stats')).toBe(2);
    expect(PICK_URLS.map(callsOf)).toEqual([1, 1, 1]);
  });

  it('closing the page cancels the requests it still waits for', async () => {
    const signals: AbortSignal[] = [];
    fetchJson.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise(() => undefined);
    });
    const { unmount } = renderHook(() => useCRMData(user), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(signals.length).toBe(5));
    unmount();
    await waitFor(() => expect(signals.every(s => s.aborted)).toBe(true));
  });
});
