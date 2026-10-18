import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
/** the answer of the next tick save; a test may hold it open to turn the phone meanwhile */
let putAnswer: () => Promise<unknown> = async () => ({ success: true, applied: 1 });
/** every read of the matrix, in order with the saves */
const calls: string[] = [];
async function answerRequest(url: string, opts?: FetchOpts): Promise<unknown> {
  if (url === '/projects/7/product-progress' && opts?.method === 'PUT') {
    puts.push(JSON.parse(opts.body ?? '{}'));
    calls.push('put');
    return putAnswer();
  }
  if (url === '/projects/7/product-progress') {
    calls.push('read');
    return progress;
  }
  if (url === '/projects/7/steps') return steps;
  if (url === '/projects/7') return project;
  return [];
}
const fetchJson = vi.fn(answerRequest);
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
const confirmAction = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: () => confirmAction() }));
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
import { progressTickRequestItems, splitStageColumns, progressPercentOf, toggledTickStatus, type ProgressProduct, type ProgressCellStatus } from '../../lib/projects/progressTicks';
import type { ProjectStep } from '../../lib/projects/projectSteps';

const MATRIX_TABLE_TITLE = 'ماتریس پیشرفت فیزیکی محصولات (مرحله × کالا)';
const PENDING_TITLE = 'کارهای مانده';
const SAVE_REFUSED = 'خطای آزمایشی';
const NETWORK_DOWN = 'network down';

let phoneMatches = false;
const mediaListeners = new Set<() => void>();

/** a phone-width screen: matchMedia answers the phone query, and `turnScreen` fires its change like a rotation */
function setPhoneScreen(phone: boolean) {
  phoneMatches = phone;
  window.matchMedia = ((query: string) => ({
    get matches() { return phoneMatches && query === PHONE_WIDTH_QUERY; },
    media: query, onchange: null,
    addEventListener: (_type: string, fn: () => void) => { mediaListeners.add(fn); },
    removeEventListener: (_type: string, fn: () => void) => { mediaListeners.delete(fn); },
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function turnScreen(phone: boolean) {
  phoneMatches = phone;
  act(() => { for (const fn of [...mediaListeners]) fn(); });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  puts.length = 0;
  calls.length = 0;
  mediaListeners.clear();
  putAnswer = async () => ({ success: true, applied: 1 });
  confirmAction.mockImplementation(async () => true);
  fetchJson.mockImplementation(answerRequest);
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

  it('reads a Jalali delivery date and Persian digits like the workshop deadline (review M2)', () => {
    expect(projectDueNote('1405/08/03', '2026-10-18', 'in_progress')).toEqual({ text: '۷ روز مانده', late: false });
    expect(projectDueNote('۱۴۰۵/۰۷/۲۳', '2026-10-18', 'planned')).toEqual({ text: '۳ روز از موعد گذشته', late: true });
    expect(projectDueNote('۲۰۲۶-۱۰-۲۵', '2026-10-18', 'planned')).toEqual({ text: '۷ روز مانده', late: false });
    expect(projectDueNote('not a date', '2026-10-18', 'planned')).toBeNull();
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
    expect(progressPercentOf(product, new Map())).toBe(50);
    expect(progressPercentOf(product, edits)).toBe(100);
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
    expect(screen.getByText(/فقط مشاهده/)).toBeTruthy();
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
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('keeps the phone list while a save runs across a rotation, and keeps the ticks when it fails (review M1)', async () => {
    setPhoneScreen(true);
    let answer: (value: unknown) => void = () => undefined;
    putAnswer = () => new Promise(resolve => { answer = resolve; });
    renderProjectPage('/projects/7/progress');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' }));
    turnScreen(false);
    expect(screen.queryByText(MATRIX_TABLE_TITLE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ثبت ۱ تغییر/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.queryByText(MATRIX_TABLE_TITLE)).toBeNull();
    await act(async () => { answer({ success: false, error: SAVE_REFUSED }); });
    expect(screen.queryByText(MATRIX_TABLE_TITLE)).toBeNull();
    const stage = screen.getByRole('checkbox', { name: 'مونتاژ برای گردنبند' });
    expect(stage.getAttribute('aria-checked')).toBe('true');

    putAnswer = async () => ({ success: true, applied: 1 });
    fireEvent.click(screen.getByRole('button', { name: /ثبت ۱ تغییر/ }));
    expect(await screen.findByText(MATRIX_TABLE_TITLE)).toBeTruthy();
    // the desktop table mounted after the save and read the matrix again
    expect(calls.lastIndexOf('read')).toBeGreaterThan(calls.lastIndexOf('put'));
  });

  it('keeps the layout of unsaved ticks across a rotation and follows the screen once they are dropped', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7/progress');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' }));
    turnScreen(false);
    expect(screen.getByRole('checkbox', { name: 'مونتاژ برای گردنبند' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'انصراف' }));
    expect(await screen.findByText(MATRIX_TABLE_TITLE)).toBeTruthy();
  });

  it('asks before the phone layout drops unsaved desktop ticks, and stays when told to', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7');
    fireEvent.click(await screen.findByText('نمای کامل مشخصات و مراحل'));
    fireEvent.click(await screen.findByRole('tab', { name: /پیشرفت/ }));
    fireEvent.click(await screen.findByTitle('مونتاژ — ناتمام (کلیک: تغییر تمام/ناتمام)'));
    confirmAction.mockImplementation(async () => false);
    fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText(MATRIX_TABLE_TITLE)).toBeTruthy();
    confirmAction.mockImplementation(async () => true);
    fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
    expect(await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' })).toBeTruthy();
    expect(screen.queryByText(MATRIX_TABLE_TITLE)).toBeNull();
  });

  it('says the matrix was not read and offers another try (review nit)', async () => {
    setPhoneScreen(true);
    let fail = true;
    fetchJson.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === '/projects/7/product-progress') {
        if (fail) throw new Error(NETWORK_DOWN);
        return progress;
      }
      if (url === '/projects/7/steps') return steps;
      if (url === '/projects/7') return project;
      return [];
    });
    renderProjectPage('/projects/7/progress');
    expect(await screen.findByText(/جدول پیشرفت خوانده نشد/)).toBeTruthy();
    expect(screen.queryByText(/هیچ کد کالایی/)).toBeNull();
    let answer: () => void = () => undefined;
    fail = false;
    const held = new Promise<void>(resolve => { answer = resolve; });
    const read = fetchJson.getMockImplementation();
    fetchJson.mockImplementation(async (url: string, opts?: FetchOpts): Promise<unknown> => {
      if (url === '/projects/7/product-progress') await held;
      return read?.(url, opts);
    });
    const retry = screen.getByRole('button', { name: /تلاش دوباره/ });
    fireEvent.click(retry);
    // delta D3: while it reads again the button stays on screen, waits and turns its icon
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(true));
    expect(retry.querySelector('.animate-spin')).toBeTruthy();
    await act(async () => { answer(); });
    expect(await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' })).toBeTruthy();
  });

  it('scrolls the tab row so the active tab is on screen', async () => {
    setPhoneScreen(true);
    const scrollBy = vi.fn();
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) });
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'tablist') return rect(0, 375);
      if (this.id === 'project-tab-progress') return rect(-120, -20);
      return rect(0, 100);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', { value: scrollBy, configurable: true });
    try {
      renderProjectPage('/projects/7/progress');
      await screen.findByRole('checkbox', { name: 'مونتاژ برای گردنبند' });
      expect(scrollBy).toHaveBeenCalledWith({ left: -120 });
      cleanup();
      scrollBy.mockClear();
      // delta D4: a wider screen shows every tab, and its row never moves
      setPhoneScreen(false);
      renderProjectPage('/projects/7/progress');
      expect(await screen.findByText(MATRIX_TABLE_TITLE)).toBeTruthy();
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      rects.mockRestore();
      delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
    }
  });

  it('asks before the phone summary would drop a stage being edited in the full view (delta D1)', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7');
    fireEvent.click(await screen.findByText('نمای کامل مشخصات و مراحل'));
    fireEvent.click((await screen.findAllByText('ویرایش زمان‌بندی و پرسنل'))[0]);
    expect(await screen.findByText(/ویرایش مرحله: برش/)).toBeTruthy();
    confirmAction.mockImplementation(async () => false);
    fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/ویرایش مرحله: برش/)).toBeTruthy();
    expect(screen.queryByText(PENDING_TITLE)).toBeNull();
    confirmAction.mockImplementation(async () => true);
    fireEvent.click(screen.getByText('بازگشت به نمای گوشی'));
    expect(await screen.findByText(PENDING_TITLE)).toBeTruthy();
  });
});
