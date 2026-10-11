import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTransfersQuery } from '../../hooks/queries/useTransferQueries';

// Package 6: on v9.0.94 the page called /transfers without a limit and saw only the first 50 codes (TD-493); from
// v9.0.95 it read every code with all=true. v10.0.182 (OBS-R1-82): it asks the server for one page with its filters.
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

describe('useTransfersQuery (OBS-R1-82)', () => {
  it('requests one page with its search and image filter, never every code', async () => {
    const page = { data: [{ code: '013' }], total: 55, page: 2, limit: 12, totalPages: 5, summary: { totalCodes: 55, withImage: 3, linkedProducts: 80 } };
    fetchJson.mockResolvedValue(page);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTransfersQuery({ page: 2, limit: 12, search: 'گل', image: 'with_image' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchJson.mock.calls[0][0]);
    expect(url).not.toContain('all=true');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('12');
    expect(params.get('search')).toBe('گل');
    expect(params.get('image')).toBe('with_image');
    expect(result.current.data?.summary.totalCodes).toBe(55);
  });
});
