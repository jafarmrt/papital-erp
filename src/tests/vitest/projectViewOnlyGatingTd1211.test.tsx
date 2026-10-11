import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'view only', status: 'in_progress', quantity: 5, unit: 'pcs',
  start_date: '2026-08-23', end_date: '2026-09-22', products: [], stages: [], inventory_control: {},
};
const listRow = { id: 7, project_code: 'PRJ-7', title: 'view only', customer_name: '', item_code: '', item_name: '', quantity: 5, unit: 'pcs',
  start_date: '', end_date: '', status: 'in_progress', priority: 'medium', progress_percent: 0, total_stages: 0, completed_stages: 0, attachments_count: 0, stages: [] };
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7') return project;
  if (url.startsWith('/projects?')) return { data: [listRow], total: 1, page: 1, limit: 50, statusCounts: { in_progress: 1 } };
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
}));
let canEdit = false;
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: false, canEdit, canDelete: false, canAllocate: false, canConsumeAllocation: false, canReleaseAllocation: false, canDeliver: false, canRequestPurchase: false,
  }),
}));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectStockEntryTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectProductProgressTab', () => ({ default: () => null }));
vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => <div data-testid="workflow-widget" /> }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));
vi.mock('../../components/ProjectModal', () => ({ default: () => null }));

import ProjectDetailModal from '../../components/ProjectDetailModal';
import ProjectInventoryTab from '../../components/project/ProjectInventoryTab';
import { SearchProvider } from '../../SearchContext';
import ProjectsPage from '../../pages/ProjectsPage';
import type { ProductionProject, ProjectInventoryControlSectionData } from '../../types';

afterEach(() => { cleanup(); vi.clearAllMocks(); granted.clear(); canEdit = false; });

const ADD_LABELS = ['افزودن ماده اولیه به این مرحله', 'افزودن بخش کنترل کلی جدید', 'افزودن ماده مصرفی عمومی'];
const SECTIONS = [
  { id: 'secA', title: 'per item', checkType: 'per_item', itemsSchema: [{ id: 'm1', name: 'bead', unit: 'pcs' }],
    perItemResults: { p1: { m1: { itemId: 'm1', name: 'bead', unit: 'pcs', requiredQty: 2, status: 'available' } } } },
  { id: 'secB', title: 'global', checkType: 'global', globalItems: [{ itemId: 'g1', name: 'glue', unit: 'pcs', requiredQty: 1, status: 'available' }] },
] as unknown as ProjectInventoryControlSectionData[];
const inventoryProject = {
  id: 7, version: 1, title: 'view only', status: 'planned',
  products: [{ id: 'p1', item_id: 50, item_name: 'necklace', item_code: 'NK-1', quantity: 3, unit: 'pcs' }],
  inventory_control: { sections: SECTIONS },
} as unknown as ProductionProject;

// v10.0.162 (TD-1211): a reader with projects.view only saw buttons whose API refused them with 403
describe('project screens for a projects.view reader (TD-1211)', () => {
  it('shows no workflow widget without a workflow key, and shows it with one', async () => {
    const { unmount } = render(<ProjectDetailModal projectId={7} isOpen onClose={vi.fn()} onUpdate={vi.fn()} />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/projects/7', expect.anything()));
    expect(await screen.findByText(/طرف حساب/)).toBeTruthy();
    expect(screen.queryByTestId('workflow-widget')).toBeNull();
    unmount();
    granted.add('workflow.view');
    render(<ProjectDetailModal projectId={7} isOpen onClose={vi.fn()} onUpdate={vi.fn()} />);
    expect(await screen.findByTestId('workflow-widget')).toBeTruthy();
  });

  it('offers no add button in the inventory control without projects.edit', async () => {
    render(<ProjectInventoryTab project={inventoryProject} />);
    expect(await screen.findByText(/فقط مشاهده/)).toBeTruthy();
    for (const label of ADD_LABELS) expect(screen.queryByText(label)).toBeNull();
  });

  it('offers the add buttons to a holder of projects.edit', async () => {
    canEdit = true;
    render(<ProjectInventoryTab project={inventoryProject} />);
    for (const label of ADD_LABELS) expect(await screen.findByText(label)).toBeTruthy();
  });

  it('reads no full item list on the project list page', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SearchProvider><ProjectsPage /></SearchProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url.startsWith('/projects?'))).toBe(true));
    expect(fetchJson.mock.calls.map(([url]) => url).filter(url => /^\/items(\?|$)/.test(url))).toEqual([]);
  });
});
