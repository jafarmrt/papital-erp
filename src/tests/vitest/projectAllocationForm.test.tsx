import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FetchOpts = { method?: string; body?: string };
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/inventory/allocations?')) return { allocations: [] };
  if (url.startsWith('/projects/options')) {
    return [
      { id: 1, projectCode: 'PRJ-OPEN', title: 'در جریان', status: 'in_progress' },
      { id: 2, projectCode: 'PRJ-CANCELLED', title: 'لغوشده', status: 'cancelled' },
      { id: 3, projectCode: 'PRJ-DONE', title: 'تکمیل‌شده', status: 'completed' },
      { id: 4, projectCode: 'PRJ-PAUSED', title: 'متوقف', status: 'paused' },
    ];
  }
  if (url.startsWith('/items/options')) return [{ id: 9, name: 'مهره', code: 'R-1', unit: 'عدد', currentStock: 20 }];
  if (url === '/inventory/allocations/allocate') return { success: true };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// v9.0.393 (TD-752): buttons follow the project API keys; these tests act as a user who holds them
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({
  useWarehousesQuery: () => ({ data: [{ id: 3, code: 'WH-A', name: 'انبار نخست' }, { id: 8, code: 'WH-B', name: 'انبار دوم' }] }),
}));

import { ProjectBomAllocationsTab } from '../../components/inventory/ProjectBomAllocationsTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openForm = async () => {
  render(<QueryClientProvider client={new QueryClient()}><ProjectBomAllocationsTab /></QueryClientProvider>);
  await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url.startsWith('/projects/options'))).toBe(true));
  fireEvent.click(screen.getByText('تخصیص مواد به پروژه'));
  return screen.getByText('پروژه تولید مقصد:').parentElement as HTMLElement;
};

// v9.0.386 (TD-759, owner decision t9 A): a cancelled or completed project takes no new material
describe('material allocation form (TD-759)', () => {
  it('offers only projects that may take material', async () => {
    const field = await openForm();
    await waitFor(() => expect(within(field).getAllByRole('option').length).toBeGreaterThan(1));
    const offered = within(field).getAllByRole('option').map(o => o.textContent ?? '');
    expect(offered.some(t => t.includes('PRJ-OPEN'))).toBe(true);
    expect(offered.some(t => t.includes('PRJ-PAUSED'))).toBe(true);
    expect(offered.some(t => t.includes('PRJ-CANCELLED') || t.includes('PRJ-DONE'))).toBe(false);
  });
});

// v9.0.387 (TD-751): the form draws from the warehouse it shows, the default (active, lowest id), never «main»
describe('material allocation warehouse (TD-751)', () => {
  it('allocates from the warehouse shown first', async () => {
    const field = await openForm();
    await waitFor(() => expect(within(field).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(within(field).getByRole('combobox'), { target: { value: '1' } });
    const material = screen.getByText('ماده اولیه / قطعه مصرفی:').parentElement as HTMLElement;
    fireEvent.change(within(material).getByRole('combobox'), { target: { value: '9' } });
    const warehouse = screen.getByText('انبار مبداء کسر موجودی:').parentElement as HTMLElement;
    expect((within(warehouse).getByRole('combobox') as HTMLSelectElement).value).toBe('WH-A');
    fireEvent.click(screen.getByText('تأیید و ثبت تخصیص'));
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url === '/inventory/allocations/allocate')).toBe(true));
    const [, opts] = fetchJson.mock.calls.find(([url]) => url === '/inventory/allocations/allocate') ?? [];
    expect(JSON.parse(opts?.body ?? '{}').allocations[0].location).toBe('WH-A');
  });
});
