import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSaveCustomerMutation } from '../../hooks/queries/useCustomerQueries';

// v10.0.135 (TD-1226): saving a customer shows one success message, the page's; the hook adds none
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: toastFn, default: toastFn }));
afterEach(() => { cleanup(); fetchJson.mockReset(); toastFn.success.mockReset(); });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('customer save toast (TD-1226)', () => {
  it('the caller decides the one success message', async () => {
    fetchJson.mockResolvedValue({ id: 5 });
    const { result } = renderHook(() => useSaveCustomerMutation(), { wrapper });
    const pageToast = () => toastFn.success('طرف حساب جدید با موفقیت ثبت شد.');
    await act(async () => { await result.current.mutateAsync({ payload: { name: 'الف' } }).then(pageToast); });
    expect(toastFn.success).toHaveBeenCalledTimes(1);
  });
});
