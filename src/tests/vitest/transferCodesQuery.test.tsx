import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTransfersQuery } from '../../hooks/queries/useTransferQueries';

// Package 6 (TD-493 / B06-14): the transfer designs page asks for every code; on v9.0.94 it called /transfers without
// a limit and saw only the server's default page of 50.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: t, default: t };
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('useTransfersQuery (TD-493)', () => {
  it('requests every transfer code, not the first page', async () => {
    const codes = Array.from({ length: 55 }, (_, i) => ({ code: String(i + 1).padStart(3, '0') }));
    fetchJson.mockResolvedValue({ data: codes, total: 55 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTransfersQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchJson).toHaveBeenCalledWith('/transfers?all=true');
    expect(result.current.data).toHaveLength(55);
  });
});
