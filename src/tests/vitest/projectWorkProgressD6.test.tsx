import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { PHONE_WIDTH_QUERY } from '../../lib/pwa/usePhoneWidth';

/**
 * 10.2 package 12, item 3 (D6, TD-1340, owner decision ت۴۲ الف): a progress matrix cell carries the done work of its
 * workshop schedule rows, the percents count it (100 only when ticked) on the desktop table and the phone list alike,
 * and the desktop matrix takes no tick while a save is under way (backlog of package 10).
 */

type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه کار کارگاه', status: 'in_progress', quantity: 5, unit: 'عدد',
  customer_name: 'گالری نمونه', progress_percent: 30, start_date: '1999-12-01', end_date: '2000-01-01',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد' }],
  stages: [
    { id: 11, project_id: 7, stage_order: 1, title: 'برش', status: 'in_progress', progress_percent: 60, assigned_personnel: [], required_resources: [] },
    { id: 12, project_id: 7, stage_order: 2, title: 'مونتاژ', status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] },
  ],
  inventory_control: {},
};
const work = { planned_quantity: 100, done_quantity: 60, unit: 'عدد', share: 0.6 };
const progress = {
  stages: [{ stage_order: 1, title: 'برش' }, { stage_order: 2, title: 'مونتاژ' }],
  products: [{
    item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد', applicable_stage_orders: [1, 2], excluded_stage_orders: [],
    progress: [{ stage_order: 1, stage_title: 'برش', status: 'pending', updated_at: '', updated_by_name: '', work }],
    completed_count: 0, applicable_count: 2, progress_percent: 30,
  }],
  summary: {
    total_skus: 1, total_quantity: 5, weighted_progress_percent: 30, fully_completed_skus: 0, total_matrix_cells: 2, completed_matrix_cells: 0,
    per_stage_counts: [
      { stage_order: 1, title: 'برش', completed_count: 0, applicable_skus: 1, progress_percent: 60 },
      { stage_order: 2, title: 'مونتاژ', completed_count: 0, applicable_skus: 1, progress_percent: 0 },
    ],
  },
};
const steps = { requisitions: { open: 0, ordered: 0, received: 0 }, allocations: { open: 0, consumed: 0, issueDocuments: 0 }, delivery: { products: 1, completeProducts: 0, delivered: 0, planned: 5, unit: 'عدد' } };
const puts: unknown[] = [];
let putAnswer: () => Promise<unknown> = async () => ({ success: true, applied: 1 });
async function answerRequest(url: string, opts?: FetchOpts): Promise<unknown> {
  if (url === '/projects/7/product-progress' && opts?.method === 'PUT') {
    puts.push(JSON.parse(opts.body ?? '{}'));
    return putAnswer();
  }
  if (url === '/projects/7/product-progress') return progress;
  if (url === '/projects/7/steps') return steps;
  if (url === '/projects/7') return project;
  return [];
}
const fetchJson = vi.fn(answerRequest);
vi.mock('../../api', () => ({
  fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({
    canCreate: true, canEdit: true, canDelete: true, canAllocate: true, canConsumeAllocation: true, canReleaseAllocation: true, canDeliver: true, canRequestPurchase: true,
  }),
}));
vi.mock('../../components/project/ProjectInventoryTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectScheduleTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectGanttTab', () => ({ default: () => null }));
vi.mock('../../components/project/ProjectStockEntryTab', () => ({ default: () => null }));
vi.mock('../../components/accounting/FinancialAttachmentUploader', () => ({ FinancialAttachmentUploader: () => null }));

import { renderProjectPage } from './helpers/projectPage';
import { computeProgressMatrix, cellsPercent } from '../../lib/projects/progressMatrix';
import { projectStageProgress } from '../../lib/projects/projectList';
import { cellWorkLabel, progressPercentOf, stageProgressPercent, stageTickCounts, type ProgressCellStatus, type ProgressProduct } from '../../lib/projects/progressTicks';
import { scheduleProductItemId, scheduleRowDoneQuantity, workPercent, workProgressOf } from '../../lib/workshop/scheduleWorkProgress';

const CELL_ONE_TITLE = 'برش — ناتمام، کار ثبت‌شدهٔ کارگاه: ۶۰ از ۱۰۰ عدد (کلیک: تغییر تمام/ناتمام)';
const CELL_TWO_TITLE = 'مونتاژ — ناتمام (کلیک: تغییر تمام/ناتمام)';
const MATRIX_TABLE_TITLE = 'ماتریس پیشرفت فیزیکی محصولات (مرحله × کالا)';

function setPhoneScreen(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_WIDTH_QUERY,
    media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  puts.length = 0;
  putAnswer = async () => ({ success: true, applied: 1 });
  fetchJson.mockImplementation(answerRequest);
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('schedule work rules (10.2 package 12, D6)', () => {
  it('adds rows of one unit, caps each at its plan and skips rows without a plan', () => {
    expect(workProgressOf([])).toBeNull();
    expect(workProgressOf([{ unit: 'عدد', planned: 0, done: 5 }])).toBeNull();
    expect(workProgressOf([{ unit: 'عدد', planned: 60, done: 30 }, { unit: ' عدد ', planned: 40, done: 90 }, { unit: 'عدد', planned: 0, done: 9 }]))
      .toEqual({ planned: 100, done: 70, unit: 'عدد', share: 0.7 });
  });

  it('averages the shares of different units instead of adding hours to pieces', () => {
    const mixed = workProgressOf([{ unit: 'عدد', planned: 10, done: 5 }, { unit: 'ساعت', planned: 4, done: 4 }]);
    expect(mixed?.unit).toBeNull();
    expect(mixed?.share).toBeCloseTo(0.75);
    // review N4: no quantity that adds hours to pieces
    expect([mixed?.planned, mixed?.done]).toEqual([null, null]);
  });

  it('reads 100 percent only for work done in full, and at least 1 percent for any work', () => {
    expect([workPercent(0), workPercent(0.004), workPercent(0.6), workPercent(0.996), workPercent(1)]).toEqual([0, 1, 60, 99, 100]);
    const products = [{ itemId: 50, itemCode: '', itemName: '', quantity: 1, unit: 'عدد', selectedOptionalStages: [] }];
    const tiny = computeProgressMatrix(products, [{ stageOrder: 1, title: 'برش' }], [], [{ itemId: 50, stageOrder: 1, unit: 'عدد', planned: 1000, done: 4 }]);
    expect([tiny.stageCounts[0].percent, tiny.products[0].percent]).toEqual([1, 1]);
  });

  it('takes a row\'s done quantity from its live work log, else its legacy flag', () => {
    const live = new Map([[9, 25]]);
    expect(scheduleRowDoneQuantity({ quantity: 40, pieceworkLogId: 9, legacyLogged: false }, live)).toBe(25);
    expect(scheduleRowDoneQuantity({ quantity: 40, pieceworkLogId: 8, legacyLogged: false }, live)).toBe(0);
    expect(scheduleRowDoneQuantity({ quantity: 40, pieceworkLogId: null, legacyLogged: true }, live)).toBe(40);
  });

  it('finds the warehouse item of a schedule product, the main item for a single-item project', () => {
    expect(scheduleProductItemId([{ id: 'p1', item_id: 50 }, { id: 'p2' }], 9, 'p1')).toBe(50);
    expect(scheduleProductItemId([{ id: 'p1', item_id: 50 }, { id: 'p2' }], 9, 'p2')).toBeNull();
    expect(scheduleProductItemId([], 9, 'prod-main')).toBe(9);
    expect(scheduleProductItemId([], null, 'prod-main')).toBeNull();
    expect(scheduleProductItemId([{ id: 'p1', item_id: 50 }], 9, 'prod-main')).toBeNull();
  });

  it('counts the work in a cell, its product and its stage, while only ticks complete', () => {
    const products = [{ itemId: 50, itemCode: '', itemName: '', quantity: 1, unit: 'عدد', selectedOptionalStages: [] }];
    const stages = [{ stageOrder: 1, title: 'برش' }, { stageOrder: 2, title: 'مونتاژ' }];
    const halfway = computeProgressMatrix(products, stages, [], [{ itemId: 50, stageOrder: 1, unit: 'عدد', planned: 100, done: 60 }]);
    expect(halfway.products[0].cells[0].work).toEqual({ planned: 100, done: 60, unit: 'عدد', share: 0.6 });
    expect(halfway.products[0].percent).toBe(30);
    expect(halfway.stageCounts.map(s => [s.completedCount, s.percent])).toEqual([[0, 60], [0, 0]]);
    expect(halfway.allProductsDone).toBe(false);

    const allWork = computeProgressMatrix(products, stages, [], [
      { itemId: 50, stageOrder: 1, unit: 'عدد', planned: 100, done: 100 },
      { itemId: 50, stageOrder: 2, unit: 'عدد', planned: 10, done: 10 },
    ]);
    expect(allWork.products[0].percent).toBe(99);
    expect(allWork.stageCounts.map(s => s.percent)).toEqual([99, 99]);
    expect(allWork.allProductsDone).toBe(false);

    const ticked = computeProgressMatrix(products, stages, [
      { itemId: 50, stageOrder: 1, status: 'completed' },
      { itemId: 50, stageOrder: 2, status: 'completed' },
    ], [{ itemId: 50, stageOrder: 1, unit: 'عدد', planned: 100, done: 10 }]);
    expect(ticked.products[0].percent).toBe(100);
    expect(ticked.allProductsDone).toBe(true);
    expect(cellsPercent([])).toBe(0);
  });

  it('never rounds a project to 100 before every product and stage is ticked', () => {
    const products = [
      { itemId: 50, itemCode: '', itemName: '', quantity: 1, unit: 'عدد', selectedOptionalStages: [] },
      { itemId: 51, itemCode: '', itemName: '', quantity: 1, unit: 'عدد', selectedOptionalStages: [] },
    ];
    const matrix = computeProgressMatrix(products, [{ stageOrder: 1, title: 'برش' }], [{ itemId: 50, stageOrder: 1, status: 'completed' }],
      [{ itemId: 51, stageOrder: 1, unit: 'عدد', planned: 100, done: 100 }]);
    expect(matrix.products.map(p => p.percent)).toEqual([100, 99]);
    expect(matrix.weightedProgress).toBe(99);
    expect(projectStageProgress([{ status: 'completed', progressPercent: 100 }, { status: 'in_progress', progressPercent: 99 }]).progressPercent).toBe(99);
    expect(projectStageProgress([{ status: 'completed', progressPercent: 100 }, { status: 'completed', progressPercent: 100 }]).progressPercent).toBe(100);
  });

  it('shows a project list row with any stage work at 1% at least (delta review nit)', () => {
    const stages = [{ status: 'in_progress', progressPercent: 1 }, ...Array.from({ length: 9 }, () => ({ status: 'pending', progressPercent: 0 }))];
    expect(projectStageProgress(stages).progressPercent).toBe(1);
    expect(projectStageProgress([{ status: 'pending', progressPercent: 0 }, { status: 'pending', progressPercent: 0 }]).progressPercent).toBe(0);
  });

  it('lets a product row without a warehouse item hold no project below 100 (review N1)', () => {
    const products = [
      { itemId: 50, itemCode: '', itemName: '', quantity: 1000, unit: 'عدد', selectedOptionalStages: [] },
      { itemId: null, itemCode: '', itemName: 'بی کالا', quantity: 1, unit: 'عدد', selectedOptionalStages: [] },
    ];
    const matrix = computeProgressMatrix(products, [{ stageOrder: 1, title: 'برش' }], [{ itemId: 50, stageOrder: 1, status: 'completed' }]);
    expect(matrix.allProductsDone).toBe(true);
    expect(matrix.weightedProgress).toBe(100);
  });

  it('reads the same percent on screen, unsent ticks included, and writes the work as «done of planned»', () => {
    const product = progress.products[0] as unknown as ProgressProduct;
    expect(progressPercentOf(product, new Map())).toBe(30);
    expect(progressPercentOf(product, new Map<string, ProgressCellStatus>([['50|2', 'completed']]))).toBe(80);
    expect(stageProgressPercent([product], 1, new Map())).toBe(60);
    expect(stageProgressPercent([product], 1, new Map<string, ProgressCellStatus>([['50|1', 'completed']]))).toBe(100);
    expect(cellWorkLabel(work)).toBe('۶۰ از ۱۰۰ عدد');
    expect(cellWorkLabel(work, true)).toBe('۶۰ از ۱۰۰');
    expect(cellWorkLabel({ planned_quantity: null, done_quantity: null, unit: null, share: 0.75 })).toBe('۷۵٪');
  });

  it('counts a stage\'s ticked products with the unsent ticks, as its percent does (review N5)', () => {
    const product = progress.products[0] as unknown as ProgressProduct;
    expect(stageTickCounts([product], 2, new Map())).toEqual({ done: 0, applicable: 1 });
    expect(stageTickCounts([product], 2, new Map<string, ProgressCellStatus>([['50|2', 'completed']]))).toEqual({ done: 1, applicable: 1 });
  });
});

describe('work in the project screens (10.2 package 12, D6)', () => {
  it('shows each cell\'s work under its tick and the stage percent that counts it', async () => {
    setPhoneScreen(false);
    renderProjectPage('/projects/7/progress');
    expect(await screen.findByText(MATRIX_TABLE_TITLE)).toBeTruthy();
    expect(screen.getByTitle(CELL_ONE_TITLE)).toBeTruthy();
    expect(screen.getByText('۶۰ از ۱۰۰')).toBeTruthy();
    expect(screen.getByText('۶۰٪')).toBeTruthy();
    expect(screen.getAllByText('۳۰٪').length).toBeGreaterThan(0);
  });

  it('counts an unsent tick in its stage chip beside the percent (review N5)', async () => {
    setPhoneScreen(false);
    renderProjectPage('/projects/7/progress');
    fireEvent.click(await screen.findByTitle(CELL_TWO_TITLE));
    expect(screen.getByText('۱/۱')).toBeTruthy();
    expect(screen.getByText('۱۰۰٪')).toBeTruthy();
  });

  it('takes no tick on the desktop table while a save is under way', async () => {
    setPhoneScreen(false);
    let answer: (value: unknown) => void = () => undefined;
    putAnswer = () => new Promise(resolve => { answer = resolve; });
    renderProjectPage('/projects/7/progress');
    fireEvent.click(await screen.findByTitle(CELL_TWO_TITLE));
    fireEvent.click(screen.getByText('ثبت ۱ تغییر در سامانه'));
    await waitFor(() => expect(puts).toHaveLength(1));
    const cell = screen.getByTitle(CELL_ONE_TITLE) as HTMLButtonElement;
    expect(cell.disabled).toBe(true);
    fireEvent.click(cell);
    expect(screen.getAllByTitle('تمام کردن این مرحله برای همه اقلام اعمال‌شده').every(b => (b as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => { answer({ success: true, applied: 1 }); });
    expect(puts).toEqual([{ items: [{ item_id: 50, stage_order: 2, status: 'completed' }] }]);
  });

  it('shows the work beside each stage of the phone list', async () => {
    setPhoneScreen(true);
    renderProjectPage('/projects/7/progress');
    const stage = await screen.findByRole('checkbox', { name: 'برش برای گردنبند، کار ثبت‌شده ۶۰ از ۱۰۰ عدد' });
    expect(stage.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('کار ثبت‌شده: ۶۰ از ۱۰۰ عدد')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'مونتاژ برای گردنبند' })).toBeTruthy();
  });
});
