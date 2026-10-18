import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه گوشی', status: 'in_progress', quantity: 5, unit: 'عدد',
  customer_name: 'گالری نمونه', progress_percent: 40, start_date: '1999-12-01', end_date: '2000-01-01',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد' }],
  stages: [
    { id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'completed', progress_percent: 100, assigned_personnel: [], required_resources: [] },
    { id: 12, project_id: 7, stage_order: 2, title: 'مونتاژ', status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] },
  ],
  inventory_control: {},
};
const progress = {
  stages: [{ stage_order: 1, title: 'برش' }, { stage_order: 2, title: 'مونتاژ' }],
  products: [{
    item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد', applicable_stage_orders: [1, 2], excluded_stage_orders: [],
    progress: [{ stage_order: 1, stage_title: 'برش', status: 'completed', updated_at: '', updated_by_name: '' }],
    completed_count: 1, applicable_count: 2, progress_percent: 50,
  }],
  summary: { total_skus: 1, total_quantity: 5, weighted_progress_percent: 50, fully_completed_skus: 0, per_stage_counts: [], total_matrix_cells: 2, completed_matrix_cells: 1 },
};
const steps = { requisitions: { open: 0, ordered: 0, received: 0 }, allocations: { open: 0, consumed: 0, issueDocuments: 0 }, delivery: { products: 1, completeProducts: 0, delivered: 0, planned: 5, unit: 'عدد' } };
const puts: unknown[] = [];
const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (url === '/projects/7/product-progress' && opts?.method === 'PUT') {
    puts.push(JSON.parse(opts.body ?? '{}'));
    return { success: true, applied: 1 };
  }
  if (url === '/projects/7/product-progress') return progress;
  if (url === '/projects/7/steps') return steps;
  if (url === '/projects/7') return project;
  return [];
});
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
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
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import { renderProjectPage } from './helpers/projectPage';
import { pendingProjectSteps, projectDueNote } from '../../lib/projects/projectPhoneSummary';
import { progressTickRequestItems, splitStageColumns, tickedProgressPercent, toggledTickStatus, type ProgressProduct, type ProgressCellStatus } from '../../lib/projects/progressTicks';
import type { ProjectStep } from '../../lib/projects/projectSteps';

const MATRIX_TABLE_TITLE = 'ماتریس پیشرفت فیزیکی محصولات (مرحله × کالا)';
const PENDING_TITLE = 'کارهای مانده';

/** a phone-width screen: matchMedia answers the phone query */
function setPhoneScreen(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_WIDTH_QUERY, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  puts.length = 0;
  canEdit = true;
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('phone summary and tick rules (10.2 package 10)', () => {
  it('says how far the delivery date is, and nothing for a closed project', () => {
    expect(projectDueNote('2026-10-25', '2026-10-18', 'in_progress')).toEqual({ text: '۷ روز مانده', late: false });
    expect(projectDueNote('2026-10-18', '2026-10-18', 'planned')).toEqual({ text: 'موعد تحویل امروز است', late: false });
    expect(projectDueNote('2026-10-15', '2026-10-18', 'in_progress')).toEqual({ text: '۳ روز از موعد گذشته', late: true });
    expect(projectDueNote('2026-10-15', '2026-10-18', 'completed')).toBeNull();
    expect(projectDueNote('', '2026-10-18', 'in_progress')).toBeNull();
  });

  it('lists the open steps with those needing attention first', () => {
    const step = (key: ProjectStep['key'], state: ProjectStep['state']): ProjectStep => ({ key, state, label: key, note: '', tab: 'materials' });
    const keys = pendingProjectSteps([step('materials', 'done'), step('reservation', 'active'), step('purchase', 'attention'), step('allocation', 'todo')]).map(s => s.key);
    expect(keys).toEqual(['purchase', 'reservation', 'allocation']);
  });

  it('flips, counts and sends a tick the same way for both screens', () => {
    const product = progress.products[0] as unknown as ProgressProduct;
    const edits = new Map<string, ProgressCellStatus>([['50|2', toggledTickStatus('pending')]]);
    expect(toggledTickStatus('completed')).toBe('pending');
    expect(toggledTickStatus('blocked')).toBe('completed');
    expect(tickedProgressPercent(product, new Map())).toBe(50);
    expect(tickedProgressPercent(product, edits)).toBe(100);
    expect(progressTickRequestItems(edits)).toEqual([{ item_id: 50, stage_order: 2, status: 'completed' }]);
    const split = splitStageColumns([{ stage_order: 1, title: 'a' }, { stage_order: 3, title: 'b' }], [product]);
    expect(split.baseStages.map(s => s.stage_order)).toEqual([1]);
    expect(split.optionalStages.map(s => s.stage_order)).toEqual([3]);
  });
});

describe('project page on a phone (10.2 package 10)', () => {
  it('shows the summary instead of the desktop first tab', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7');
    expect(await screen.findByText(PENDING_TITLE)).toBeTruthy();
    expect(screen.getByText('گالری نمونه')).toBeTruthy();
    expect(screen.getByText(/روز از موعد گذشته/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'گام‌های پروژه' })).toBeNull();
    expect(screen.queryByText('محصولات این پروژه')).toBeNull();
  });

  it('keeps the desktop page on a wide screen', async () => {
    setPhoneScreen(false);
    renderProjectPage('/projects/7');
    expect(await screen.findByText('محصولات این پروژه')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'گام‌های پروژه' })).toBeTruthy();
    expect(screen.queryByText(PENDING_TITLE)).toBeNull();
  });

  it('ticks the desktop matrix as before, through the shared hook', async () => {
    setPhoneScreen(false);
    renderProjectPage('/projects/7/progress');
    expect(await screen.findByText(MATRIX_TABLE_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByTitle('مونتاژ — ناتمام (کلیک: تغییر تمام/ناتمام)'));
    fireEvent.click(screen.getByText('ثبت ۱ تغییر در سامانه'));
    await waitFor(() => expect(puts).toEqual([{ items: [{ item_id: 50, stage_order: 2, status: 'completed' }] }]));
  });

  it('ticks a stage from the phone list through the desktop route', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7');
    fireEvent.click(await screen.findByText('تیک جدول پیشرفت'));
    const stage = await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' });
    expect(stage.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(MATRIX_TABLE_TITLE)).toBeNull();
    fireEvent.click(stage);
    expect(stage.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /ثبت ۱ تغییر/ }));
    await waitFor(() => expect(puts).toEqual([{ items: [{ item_id: 50, stage_order: 2, status: 'completed' }] }]));
  });

  it('only shows the ticks to a reader without projects.edit', async () => {
    canEdit = false;
    setPhoneScreen(true);
    renderProjectPage('/projects/7/progress');
    const stage = await screen.findByRole('checkbox', { name: 'برش برای گردنبند' });
    expect((stage as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/فقط دیدن/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ویرایش مشخصات/ })).toBeNull();
  });

  it('opens the full desktop page and comes back', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7');
    fireEvent.click(await screen.findByText('نمای کامل مشخصات و مراحل'));
    expect(await screen.findByText('محصولات این پروژه')).toBeTruthy();
    const header = screen.getByRole('navigation', { name: 'گام‌های پروژه' });
    expect(within(header).getByText('پیشرفت')).toBeTruthy();
    fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
    expect(await screen.findByText(PENDING_TITLE)).toBeTruthy();
  });
});
