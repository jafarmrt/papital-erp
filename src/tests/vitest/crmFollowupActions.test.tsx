import type { FormEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CRMActivity } from '../../types';

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

interface RequestInitLike { method?: string; body?: string }

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

const writes = () => fetchJson.mock.calls
  .filter(c => (c[1] as RequestInitLike | undefined)?.method === 'PUT')
  .map(c => String(c[0]));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// v9.0.19 (TD-430): «انجام» و «بازگشایی» پیگیری دو عمل صریح‌اند؛ دوبار کلیک «بازگشایی» یک درخواست است
describe('CRM follow-up explicit actions (TD-430)', () => {
  it('reopens a completed follow-up once, even on a double click', async () => {
    let release!: () => void;
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      if (init?.method === 'PUT') return new Promise(resolve => { release = () => resolve({ changed: true }); });
      return Promise.resolve(url.startsWith('/crm/stats') ? {} : []);
    });
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper });
    const done = { id: 5, title: 'تماس', isFollowUpCompleted: 1 } as CRMActivity;

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleToggleFollowup(done);
      await result.current.handleToggleFollowup(done);
    });
    release();
    await act(async () => { await first; });

    expect(writes()).toEqual(['/crm/activities/5/reopen-followup']);
  });

  it('completes an open follow-up with its result through the explicit action', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      if (init?.method === 'PUT') return Promise.resolve({ changed: true });
      return Promise.resolve(url.startsWith('/crm/stats') ? {} : []);
    });
    const { result } = renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper });
    const open = { id: 7, title: 'تماس', isFollowUpCompleted: 0 } as CRMActivity;

    await act(async () => { await result.current.handleToggleFollowup(open); });
    await act(async () => { await result.current.handleConfirmFollowupResult({ preventDefault: () => undefined } as FormEvent); });

    expect(writes()).toEqual(['/crm/activities/7/complete-followup']);
    const body = JSON.parse(String((fetchJson.mock.calls.find(c => (c[1] as RequestInitLike | undefined)?.method === 'PUT')?.[1] as RequestInitLike).body));
    expect(body).toMatchObject({ result: 'پاسخ داد و توافق شد' });
  });
});
