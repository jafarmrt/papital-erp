import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePersonnel } from '../../hooks/usePersonnel';
import { personnelPageUrl } from '../../lib/personnel/personnelList';

// OBS-R2-57 (TD-1321): the personnel page reads one page from the server and every personnel only while the form or the
// Excel window is open; the earlier hook read the whole list on open and searched and paged it in the browser
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

const stats = { total: 40, active: 30, terminated: 6, onLeave: 4, usersCount: 12 };
const row = (id: number) => ({ id, fullName: `پرسنل ${id}`, employmentStatus: 'فعال' });

function answer(url: string) {
  if (url.startsWith('/personnel?') && url.includes('page=')) {
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const page = Number(params.get('page'));
    return Promise.resolve({ data: [row(page * 100 + 1), row(page * 100 + 2)], total: 40, page, limit: Number(params.get('limit')), stats });
  }
  if (url === '/personnel') return Promise.resolve([row(1), row(2), row(3)]);
  return Promise.resolve([]);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => { cleanup(); fetchJson.mockReset(); });

describe('personnel page list (OBS-R2-57)', () => {
  it('builds the page address with search and status, and leaves out an empty search or «all»', () => {
    expect(personnelPageUrl({ page: 2, limit: 15, search: '  علی ', status: 'فعال' }))
      .toBe(`/personnel?page=2&limit=15&search=${encodeURIComponent('علی')}&status=${encodeURIComponent('فعال')}`);
    expect(personnelPageUrl({ page: 1, limit: 15, search: '', status: 'all' })).toBe('/personnel?page=1&limit=15');
  });

  it('reads one page with the cards from the server and every personnel only while the form is open', async () => {
    fetchJson.mockImplementation((url: string) => answer(url));
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    await waitFor(() => expect(result.current.paginatedPersonnel).toHaveLength(2));
    const urls = () => fetchJson.mock.calls.map(c => String(c[0]));
    expect(urls()).toContain('/personnel?page=1&limit=15');
    expect(urls()).not.toContain('/personnel');
    expect(result.current.stats).toEqual(stats);
    expect(result.current.totalFilteredCount).toBe(40);
    expect(result.current.totalAllCount).toBe(40);
    expect(result.current.totalPages).toBe(3);

    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.paginatedPersonnel[0]?.id).toBe(201));
    expect(result.current.startIndex).toBe(15);

    act(() => result.current.handleOpenAddModal());
    await waitFor(() => expect(result.current.personnelList).toHaveLength(3));
    expect(urls()).toContain('/personnel');
  });

  it('sends the search to the server after the typing pause and goes back to page 1', async () => {
    fetchJson.mockImplementation((url: string) => answer(url));
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    await waitFor(() => expect(result.current.paginatedPersonnel).toHaveLength(2));
    act(() => result.current.setCurrentPage(3));
    act(() => result.current.setSearchQuery('رضا'));
    await waitFor(() => expect(fetchJson.mock.calls.map(c => String(c[0])))
      .toContain(`/personnel?page=1&limit=15&search=${encodeURIComponent('رضا')}`));
    expect(result.current.currentPage).toBe(1);
  });
});
