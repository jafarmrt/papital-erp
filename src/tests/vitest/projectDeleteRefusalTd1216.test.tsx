import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

type FetchOpts = { method?: string; signal?: AbortSignal };
const listRow = { id: 5, project_code: 'PRJ-5', title: 'p5', customer_name: '', item_code: '', item_name: '', quantity: 5, unit: 'pcs',
  start_date: '', end_date: '', status: 'in_progress', priority: 'medium', progress_percent: 0, total_stages: 0, completed_stages: 0, attachments_count: 0, stages: [] };
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (opts?.method === 'DELETE') throw Object.assign(new Error('refused delete'), { status: 422 });
  if (url.startsWith('/projects?')) return { data: [listRow], total: 1, page: 1, limit: 50, statusCounts: { in_progress: 1 } };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../components/ProjectModal', () => ({ default: () => null }));
vi.mock('../../components/ProjectDetailModal', () => ({ default: () => null }));

import { SearchProvider } from '../../SearchContext';
import ProjectsPage from '../../pages/ProjectsPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const DELETE_TITLE = 'حذف';

// v10.0.147 (TD-1216): a refused project delete is shown once and leaves no page error
describe('project form fixes (TD-1216)', () => {
  it('TD-1216: a refused project delete shows its error and leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
          <SearchProvider><ProjectsPage /></SearchProvider>
        </QueryClientProvider>,
      );
      const [button] = await screen.findAllByTitle(DELETE_TITLE);
      fireEvent.click(button);
      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
