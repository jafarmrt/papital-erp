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
    return { data: [row(5, 'in_progress'), row(6, 'planned')], total: 120, page: 1, limit: 50, statusCounts: { in_progress: 70, planned: 30, completed: 20 } };
  }
  const record = /^\/projects\/(\d+)$/.exec(url);
  if (record) return { ...row(Number(record[1]), 'in_progress'), version: 4, description: `شرح کامل پروژه ${record[1]}`, products: [], inventory_control: {} };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ProjectModal', () => ({
  default: ({ isOpen, projectToEdit }: { isOpen: boolean; projectToEdit: { description?: string } | null }) =>
    (isOpen ? <div data-testid="project-form">{projectToEdit?.description ?? 'new'}</div> : null),
}));
vi.mock('../../components/ProjectDetailModal', () => ({ default: () => null }));

import { SearchProvider } from '../../SearchContext';
import ProjectsPage from '../../pages/ProjectsPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SearchProvider><ProjectsPage /></SearchProvider>
  </QueryClientProvider>,
);
const listUrls = () => fetchJson.mock.calls.map(([url]) => url).filter(url => url.startsWith('/projects?'));

// v9.0.388 (TD-743): the page reads one summary page with server filters and opens the edit form with the full record
describe('project list page (TD-743)', () => {
  it('reads one page and shows the counts and range the server gives', async () => {
    renderPage();
    await waitFor(() => expect(listUrls()).toContain('/projects?page=1&limit=50'));
    expect((await screen.findByTestId('project-list-range')).textContent).toContain('۱ تا ۵۰ از ۱۲۰ پروژه');
    expect(screen.getByText('کل پروژه‌ها').nextElementSibling?.textContent).toBe('۱۲۰');
    expect(screen.getByText('در حال اجرای تولید').nextElementSibling?.textContent).toBe('۷۰');
  });

  it('sends the next page and the status filter to the server', async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle('صفحه بعد'));
    await waitFor(() => expect(listUrls()).toContain('/projects?page=2&limit=50'));
    fireEvent.change(screen.getByDisplayValue('همه وضعیت‌ها'), { target: { value: 'in_progress' } });
    await waitFor(() => expect(listUrls()).toContain('/projects?status=in_progress&page=1&limit=50'));
  });

  it('opens the edit form with the project record, not the list row', async () => {
    renderPage();
    const [edit] = await screen.findAllByTitle('ویرایش');
    fireEvent.click(edit);
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => /^\/projects\/\d+$/.test(url))).toBe(true));
    expect((await screen.findByTestId('project-form')).textContent).toMatch(/^شرح کامل پروژه \d+$/);
  });
});
