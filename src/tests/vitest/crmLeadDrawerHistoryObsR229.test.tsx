// v10.0.178 (OBS-R2-29, TD-991): the sales lead drawer never shows another lead's history: opening lead B clears lead A's
// history at once, and a late answer for A does not land on B. 10.3 (part 12): the detail is a shared query per lead.
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CRMLead } from '../../types';

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

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('sales lead drawer history (OBS-R2-29)', () => {
  it('clears the previous lead history on open and ignores a late answer of the previous lead', async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    fetchJson.mockImplementation((url: string) => {
      if (/^\/crm\/leads\/\d+$/.test(url)) return new Promise(resolve => { pending[url] = resolve; });
      return Promise.resolve(url.startsWith('/crm/stats') ? {} : []);
    });
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper });
    const leadA = { id: 1, title: 'الف' } as CRMLead;
    const leadB = { id: 2, title: 'ب' } as CRMLead;

    act(() => { result.current.openLeadDrawer(leadA); });
    await act(async () => { pending['/crm/leads/1']({ activities: [{ id: 11, title: 'تماس الف' }] }); });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([11]));

    // A is read again (a change elsewhere) while B opens: B shows nothing of A's history until its own answer
    act(() => { void result.current.loadAllData(); });
    act(() => { result.current.openLeadDrawer(leadB); });
    expect(result.current.drawerActivities).toEqual([]);

    await act(async () => { pending['/crm/leads/2']({ activities: [{ id: 22, title: 'تماس ب' }] }); });
    await waitFor(() => expect(result.current.drawerActivities.map(a => a.id)).toEqual([22]));
    await act(async () => { pending['/crm/leads/1']({ activities: [{ id: 11, title: 'تماس الف' }] }); });
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(result.current.selectedLeadDrawer?.id).toBe(2);
    expect(result.current.drawerActivities.map(a => a.id)).toEqual([22]);
  });
});
