import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryWrapper } from './helpers/queryWrapper';

type FetchOpts = { method?: string };
let serverTotal = 51;
const pagesAsked: number[] = [];
const allocation = (id: number) => ({
  id, projectId: 1, projectCode: `P-${id}`, itemId: 9, itemCode: 'RM-9', itemName: 'glue', unit: 'pcs', quantity: 1,
  status: 'allocated', allocatedAt: '2026-10-01T08:00:00Z', username: 'admin',
});
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/inventory/allocations?')) {
    const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
    pagesAsked.push(page);
    const from = (page - 1) * 50;
    const count = Math.max(0, Math.min(50, serverTotal - from));
    const rows = Array.from({ length: count }, (_, i) => allocation(from + i + 1));
    return { allocations: rows, total: serverTotal, page, limit: 50, statusCounts: { all: serverTotal, allocated: serverTotal, consumed: 0, released: 0 } };
  }
  return [];
});
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => ({ data: [{ id: 3, code: 'WH-A', name: 'warehouse' }] }) }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true, useHasAnyPermission: () => true }));

import { ProjectBomAllocationsTab } from '../../components/inventory/ProjectBomAllocationsTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); serverTotal = 51; pagesAsked.length = 0; });

// the pager line the tab shows (Persian UI text kept in constants: terminal output stays English)
const PAST_THE_END = 'نمایش ۵۱ تا ۵۰ از ۵۰ مورد';
const FIRST_OF_FIFTY = 'نمایش ۱ تا ۵۰ از ۵۰ مورد';

// TD-1322 review N3: after a consume or release the tab could stay on a page past the end
describe('bom_allocation_page_clamp_td_1322', () => {
  it('goes back to the last page when the page it asked for is now past the end', async () => {
    render(<ProjectBomAllocationsTab />, { wrapper: QueryWrapper });
    await screen.findByText('صفحه ۱ از ۲');
    // one allocation is released elsewhere before the second page is read
    serverTotal = 50;
    fireEvent.click(screen.getByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(pagesAsked.slice(-2)).toEqual([2, 1]));
    expect(screen.queryByText(PAST_THE_END)).toBeNull();
    expect(screen.queryByText(FIRST_OF_FIFTY)).toBeNull();
    expect((await screen.findAllByText('P-50')).length).toBeGreaterThan(0);
  });
});
