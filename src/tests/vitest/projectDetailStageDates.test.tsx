import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه تاریخ', status: 'in_progress', quantity: 5, unit: 'عدد',
  start_date: '2026-08-23', end_date: '2026-09-22', products: [], stages: [{
    id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'pending', progress_percent: 0,
    start_date: '2026-08-23', end_date: '2026-08-28', assigned_personnel: [], required_resources: [], notes: '',
  }],
  inventory_control: {
    isFinalized: true,
    reservedItems: [],
    reservationShortages: [{ itemId: 9, itemCode: 'RM-1', itemName: 'سنگ', unit: 'عدد', required: 4, available: 1, reserved: 1, shortage: 3 }],
  },
};
const puts: Array<Record<string, unknown>> = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7/stages/11' && opts?.method === 'PUT') {
    const body = JSON.parse(opts.body ?? '{}') as Record<string, unknown>;
    puts.push(body);
    return { ...project.stages[0], ...body };
  }
  if (url === '/projects/7') return project;
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canRequestPurchase: true,
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

afterEach(() => { cleanup(); vi.clearAllMocks(); puts.length = 0; });

const renderModal = () => render(<ProjectDetailModal projectId={7} isOpen onClose={vi.fn()} onUpdate={vi.fn()} />);

// v9.0.395 (TD-763): stage dates were free text with a 1403 sample; the shortage badge read a field nobody writes
describe('project detail stage dates and shortage badge (TD-763)', () => {
  it('counts the reservation shortages the server wrote at finalize', async () => {
    renderModal();
    expect(await screen.findByText('۱ قلم کسری')).toBeTruthy();
  });

  it('edits stage dates with the Jalali picker and sends ISO dates', async () => {
    renderModal();
    fireEvent.click(await screen.findByText('ویرایش زمان‌بندی و پرسنل'));
    expect(screen.queryByPlaceholderText('۱۴۰۳/۰۶/۱۵')).toBeNull();
    expect(screen.queryByPlaceholderText('۱۴۰۳/۰۶/۲۰')).toBeNull();
    expect(screen.getAllByPlaceholderText('انتخاب تاریخ')).toHaveLength(2);
    fireEvent.click(screen.getByText('ذخیره تغییرات مرحله'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].start_date).toBe('2026-08-23');
    expect(puts[0].end_date).toBe('2026-08-28');
  });

  // TD-762: the price list and work log fetches were removed in v9.0.141 (TD-891) and v9.0.142 (TD-892); this guards it
  it('reads neither every item price nor the project work logs it never shows (TD-762)', async () => {
    renderModal();
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => url === '/piecework/tasks')).toBe(true));
    const urls = fetchJson.mock.calls.map(([url]) => url);
    expect(urls.some(url => url.startsWith('/items/prices'))).toBe(false);
    expect(urls.some(url => url.startsWith('/piecework/logs'))).toBe(false);
  });
});
