import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

type FetchOpts = { method?: string; signal?: AbortSignal };
const listRow = (id: number) => ({
  id, project_code: `PRJ-${id}`, title: `پروژه ${id}`, customer_name: 'مشتری', item_code: '', item_name: '', quantity: 5, unit: 'عدد',
  start_date: '', end_date: '', status: 'in_progress', priority: 'medium', progress_percent: 0, total_stages: 0, completed_stages: 0, attachments_count: 0, stages: [],
});
const progress = {
  stages: [{ stage_order: 1, title: 'برش' }],
  products: [{
    item_id: 9, item_code: 'NK-1', item_name: 'گردنبند', quantity: 3, unit: 'عدد', applicable_stage_orders: [1], excluded_stage_orders: [],
    progress: [], completed_count: 0, applicable_count: 1, progress_percent: 0,
  }],
  summary: {
    total_skus: 1, total_quantity: 3, weighted_progress_percent: 0, fully_completed_skus: 0,
    per_stage_counts: [{ stage_order: 1, title: 'برش', completed_count: 0, applicable_skus: 1 }],
  },
};
const allocation = {
  id: 31, status: 'allocated', projectCode: 'PRJ-5', itemCode: 'RM-1', itemName: 'سنگ', quantity: 2, unit: 'عدد',
  sourceLocation: 'WH-A', allocatedAt: '2026-10-01T08:00:00Z', username: 'انباردار',
};
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/projects?')) return { data: [listRow(5)], total: 1, page: 1, limit: 50, statusCounts: { in_progress: 1 } };
  if (/^\/projects\/\d+\/product-progress$/.test(url)) return progress;
  if (url.startsWith('/inventory/allocations?')) return { allocations: [allocation] };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => ({ data: [{ id: 3, code: 'WH-A', name: 'انبار نخست' }] }) }));
vi.mock('../../components/ProjectModal', () => ({ default: () => null }));
vi.mock('../../components/ProjectDetailModal', () => ({ default: () => null }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
}));

import { SearchProvider } from '../../SearchContext';
import ProjectsPage from '../../pages/ProjectsPage';
import ProjectProductProgressTab from '../../components/project/ProjectProductProgressTab';
import { ProjectBomAllocationsTab } from '../../components/inventory/ProjectBomAllocationsTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); granted.clear(); });

const withQuery = (node: ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const grant = (...keys: string[]) => keys.forEach(k => granted.add(k));

// v9.0.393 (TD-752): no project button asked a permission, so a user holding only projects.view filled forms and got 403
describe('project buttons follow the project API keys (TD-752)', () => {
  it('shows create, edit and delete on the project list only with their keys', async () => {
    grant('projects.view');
    render(withQuery(<SearchProvider><ProjectsPage /></SearchProvider>));
    expect(await screen.findByText('پروژه 5')).toBeTruthy();
    expect(screen.queryByText('تعریف پروژه جدید')).toBeNull();
    expect(screen.queryAllByTitle('ویرایش')).toHaveLength(0);
    expect(screen.queryAllByTitle('حذف')).toHaveLength(0);
    cleanup();

    grant('projects.create', 'projects.edit', 'projects.delete');
    render(withQuery(<SearchProvider><ProjectsPage /></SearchProvider>));
    expect(await screen.findByText('پروژه 5')).toBeTruthy();
    expect(screen.getByText('تعریف پروژه جدید')).toBeTruthy();
    expect(screen.queryAllByTitle('ویرایش').length).toBeGreaterThan(0);
    expect(screen.queryAllByTitle('حذف').length).toBeGreaterThan(0);
  });

  it('keeps the progress matrix read-only without projects.edit', async () => {
    grant('projects.view');
    render(<ProjectProductProgressTab projectId={5} />);
    expect(await screen.findByText(/فقط مشاهده: تیک‌زدن مراحل/)).toBeTruthy();
    const tick = screen.getByTitle(/برش — ناتمام/);
    expect((tick as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tick);
    expect(screen.queryByText(/تغییر در سامانه/)).toBeNull();
    expect(screen.queryByText('✓ همه')).toBeNull();
    cleanup();

    grant('projects.edit');
    render(<ProjectProductProgressTab projectId={5} />);
    fireEvent.click(await screen.findByTitle(/برش — ناتمام/));
    expect(screen.getByText(/ثبت ۱ تغییر در سامانه/)).toBeTruthy();
  });

  it('offers allocate, consume and release only to holders of their route keys', async () => {
    grant('warehouse.view');
    render(withQuery(<ProjectBomAllocationsTab />));
    expect(await screen.findByText('سنگ')).toBeTruthy();
    expect(screen.queryByText('تخصیص مواد به پروژه')).toBeNull();
    expect(screen.queryByText('مصرف شد')).toBeNull();
    expect(screen.queryByText('آزادسازی')).toBeNull();
    cleanup();

    grant('warehouse.out');
    render(withQuery(<ProjectBomAllocationsTab />));
    expect(await screen.findByText('سنگ')).toBeTruthy();
    expect(screen.getByText('تخصیص مواد به پروژه')).toBeTruthy();
    expect(screen.queryByText('مصرف شد')).toBeNull();
    expect(screen.getByText('آزادسازی')).toBeTruthy();
    cleanup();

    grant('inventory.reconcile');
    render(withQuery(<ProjectBomAllocationsTab />));
    await waitFor(() => expect(screen.getByText('مصرف شد')).toBeTruthy());
  });
});
