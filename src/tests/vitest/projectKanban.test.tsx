import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FetchOpts = { method?: string; signal?: AbortSignal };
const row = (id: number, status: string) => ({
  id, project_code: `PRJ-${id}`, title: `پروژه ${id}`, customer_name: 'مشتری', item_code: '', item_name: '', quantity: 5, unit: 'عدد',
  start_date: '', end_date: '', status, priority: 'medium', progress_percent: 0, total_stages: 0, completed_stages: 0, attachments_count: 0, stages: [],
});
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/projects?')) {
    return { data: [row(5, 'planned'), row(7, 'paused'), row(8, 'cancelled')], total: 3, page: 1, limit: 50, statusCounts: { planned: 1, paused: 1, cancelled: 1 } };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ProjectModal', () => ({ default: () => null }));
vi.mock('../../components/ProjectDetailModal', () => ({ default: () => null }));

import { SearchProvider } from '../../SearchContext';
import ProjectsPage from '../../pages/ProjectsPage';
import { groupProjectsForKanban } from '../../lib/projects/projectStatus';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SearchProvider><ProjectsPage /></SearchProvider>
  </QueryClientProvider>,
);

// v9.0.394 (TD-761): the kanban had three columns, so paused and cancelled projects were hidden, and the filter had no cancelled
describe('project kanban (TD-761)', () => {
  it('shows paused and cancelled projects in their own column', async () => {
    renderPage();
    expect(await screen.findByText('پروژه 5')).toBeTruthy();
    expect(screen.getByText('پروژه 7')).toBeTruthy();
    expect(screen.getByText('پروژه 8')).toBeTruthy();
    expect(screen.getByText('متوقف / لغوشده')).toBeTruthy();
  });

  it('filters by the cancelled status on the server', async () => {
    renderPage();
    const select = await screen.findByDisplayValue('همه وضعیت‌ها');
    expect([...select.querySelectorAll('option')].map(o => o.textContent)).toContain('لغوشده');
    fireEvent.change(select, { target: { value: 'cancelled' } });
    await waitFor(() => expect(fetchJson.mock.calls.map(([url]) => url)).toContain('/projects?status=cancelled&page=1&limit=50'));
  });

  it('groups every status into one column', () => {
    const groups = groupProjectsForKanban([{ status: 'planned' }, { status: 'paused' }, { status: 'cancelled' }, { status: 'completed' }, { status: '' }]);
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))).toEqual({ planned: 2, in_progress: 0, completed: 1, stopped: 2 });
  });
});
