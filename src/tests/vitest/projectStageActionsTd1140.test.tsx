import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

// v10.0.67 (TD-1140): after a project was created no screen added or deleted a stage, although both routes exist
describe('project stages after creation (TD-1140)', () => {
  it('adds a stage through POST /projects/:id/stages', async () => {
    renderModal();
    fireEvent.change(await screen.findByLabelText('عنوان مرحله تازه'), { target: { value: ' بسته‌بندی ' } });
    fireEvent.click(screen.getByText('افزودن مرحله'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: '/projects/7/stages', method: 'POST', body: { title: 'بسته‌بندی' } });
  });

  it('deletes a stage through DELETE /projects/:id/stages/:stageId', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText('حذف مرحله «برش»'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].url).toBe('/projects/7/stages/11');
    expect(writes[0].method).toBe('DELETE');
  });

  it('offers neither without projects.edit', async () => {
    canEdit = false;
    renderModal();
    expect(await screen.findByText('برش')).toBeTruthy();
    expect(screen.queryByText('افزودن مرحله')).toBeNull();
    expect(screen.queryByLabelText('حذف مرحله «برش»')).toBeNull();
  });
});
