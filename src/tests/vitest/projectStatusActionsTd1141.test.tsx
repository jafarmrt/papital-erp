import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { projectStatusActions } from '../../lib/projects/projectStatusActions';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const baseProject = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه کمبود صفحه', status: 'in_progress', quantity: 5, unit: 'عدد',
  start_date: '2026-08-23', end_date: '2026-09-22', products: [], inventory_control: {},
  stages: [{ id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [], notes: '' }],
};
let project: Record<string, unknown> = { ...baseProject };
const writes: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  const method = opts?.method ?? 'GET';
  if (method !== 'GET') {
    const body = JSON.parse(opts?.body ?? '{}') as Record<string, unknown>;
    writes.push({ url, method, body });
    if (url === '/projects/7') return { ...project, ...body, version: 4 };
    return { success: true, id: 12 };
  }
  if (url === '/projects/7') return project;
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
let canEdit = true;
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectStockEntryTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectProductProgressTab', () => ({ default: () => null }));
vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import ProjectDetailModal from '../../components/ProjectDetailModal';

afterEach(() => { cleanup(); vi.clearAllMocks(); writes.length = 0; project = { ...baseProject }; canEdit = true; });

const renderModal = () => render(<ProjectDetailModal projectId={7} isOpen onClose={vi.fn()} onUpdate={vi.fn()} />);

// v10.0.41 (TD-1141): a project could not be paused, resumed or cancelled from any screen
describe('project pause, resume and cancel (TD-1141)', () => {
  it('pauses with the project version', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('توقف پروژه'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: '/projects/7', method: 'PUT', body: { status: 'paused', version: 3 } });
  });

  it('cancels a project', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('لغو پروژه'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ status: 'cancelled', version: 3 });
  });

  it('resumes a paused project as planned, so the matrix sync sets its status', async () => {
    project = { ...baseProject, status: 'paused' };
    renderModal();
    fireEvent.click(await screen.findByText('ادامه پروژه'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ status: 'planned', version: 3 });
  });

  it('offers no change for a cancelled or completed project, or without projects.edit', () => {
    expect(projectStatusActions('cancelled')).toEqual([]);
    expect(projectStatusActions('completed')).toEqual([]);
    expect(projectStatusActions('planned').map(a => a.target)).toEqual(['paused', 'cancelled']);
  });

  it('hides the buttons without projects.edit', async () => {
    canEdit = false;
    renderModal();
    expect(await screen.findByText('برش')).toBeTruthy();
    expect(screen.queryByText('توقف پروژه')).toBeNull();
    expect(screen.queryByText('لغو پروژه')).toBeNull();
  });
});
