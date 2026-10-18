/**
 * v9.0.364 (TD-739): تنها قاعده ماتریس پیشرفت «کد کالا × مرحله» پروژه. پیش‌تر سه نسخه داشت (route نمایش و تیک، بررسی
 * تکمیل و همگام‌ساز وضعیت) که با هم نمی‌خواندند: برای پروژه‌ای که فقط کالای اصلی دارد نمایش صفر ردیف داشت و تیک‌ها رد
 * می‌شدند، ولی بررسی تکمیل «۰ از ۳» می‌گفت و تکمیل را رد می‌کرد.
 *
 * محصولات ماتریس: ردیف‌های `products` پروژه، و اگر خالی باشد کالای اصلی پروژه. مراحل اختیاری: عنوان‌هایی که در
 * `selected_optional_stages` (یا `selectedOptionalStages`) دست‌کم یک محصول آمده‌اند؛ هر محصول فقط مرحله‌های اختیاری
 * انتخاب خودش را دارد. کلید هر خانه «شناسه کالا | شماره مرحله» است.
 */

import { workPercent, workProgressOf, type WorkProgress } from '../workshop/scheduleWorkProgress';

export const PRODUCT_PROGRESS_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export type ProductProgressStatus = typeof PRODUCT_PROGRESS_STATUSES[number];

export interface MatrixProjectSource {
  products?: unknown;
  itemId?: number | null;
  itemCode?: string | null;
  itemName?: string | null;
  quantity?: unknown;
  unit?: string | null;
}

export interface MatrixStage {
  stageOrder: number;
  title: string;
}

export interface MatrixProgressRow {
  itemId: number;
  stageOrder: number;
  status: string;
  stageTitle?: string | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
}

/**
 * 10.2 package 12, item 3 (D6, owner decision ت۴۲ الف): one workshop schedule row of a matrix cell, with its planned and
 * done quantity (`scheduleWorkProgress.ts`); the loader maps the row's stage and product keys to the cell.
 */
export interface MatrixWorkRow {
  itemId: number;
  stageOrder: number;
  unit: string;
  planned: number;
  done: number;
}

export interface MatrixProduct {
  /** شناسه کالای انبار؛ ردیف بی شناسه معتبر در ماتریس خانه‌ای ندارد */
  itemId: number | null;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  selectedOptionalStages: string[];
}

export interface MatrixCell {
  stageOrder: number;
  stageTitle: string;
  status: string;
  updatedAt: string;
  updatedByName: string;
  /** the cell's schedule work, or null when the cell has no schedule row with a planned quantity */
  work: WorkProgress | null;
}

export interface MatrixProductProgress extends MatrixProduct {
  applicableOrders: number[];
  excludedOrders: number[];
  cells: MatrixCell[];
  completedCount: number;
  percent: number;
}

export interface MatrixStageCount {
  stageOrder: number;
  title: string;
  completedCount: number;
  applicableCount: number;
  /** the stage's progress over its products: ticked cells count whole, the others their schedule work */
  percent: number;
}

export interface ProgressMatrix {
  products: MatrixProductProgress[];
  totalCells: number;
  completedCells: number;
  allCompleted: boolean;
  weightedProgress: number;
  fullyCompletedProducts: number;
  /** همه محصولات دارای شناسه همه خانه‌های خود را تکمیل کرده‌اند (و دست‌کم یکی هست) */
  allProductsDone: boolean;
  stageCounts: MatrixStageCount[];
}

type Row = Record<string, unknown>;
const asRow = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const positiveItemId = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const optionalStagesOf = (p: Row): string[] => {
  const sel = p.selected_optional_stages ?? p.selectedOptionalStages;
  return Array.isArray(sel) ? sel.map(t => String(t).trim()).filter(Boolean) : [];
};

/** محصولات ماتریس پروژه: ردیف‌های products، وگرنه کالای اصلی */
export function matrixProducts(project: MatrixProjectSource): MatrixProduct[] {
  const rows = Array.isArray(project.products) ? project.products.map(asRow).filter((r): r is Row => r !== null) : [];
  if (rows.length > 0) {
    return rows.map(p => ({
      itemId: positiveItemId(p.item_id ?? p.itemId ?? p.item_id_raw),
      itemCode: text(p.item_code ?? p.itemCode),
      itemName: text(p.item_name ?? p.itemName),
      quantity: Number(p.quantity) || 0,
      unit: text(p.unit) || 'عدد',
      selectedOptionalStages: optionalStagesOf(p),
    }));
  }
  const mainItemId = positiveItemId(project.itemId);
  if (mainItemId === null) return [];
  return [{
    itemId: mainItemId,
    itemCode: project.itemCode || '',
    itemName: project.itemName || '',
    quantity: Number(project.quantity) || 1,
    unit: project.unit || 'عدد',
    selectedOptionalStages: [],
  }];
}

/**
 * v9.0.366 (TD-758، تصمیم ت۱ الف): پروژه‌ای که ماتریس پیشرفت دارد؛ وضعیت و درصد مراحلش را فقط ماتریس تعیین می‌کند و
 * وضعیت دستی مرحله فقط برای پروژه بی محصول است.
 */
export const hasMatrixProducts = (project: MatrixProjectSource): boolean =>
  matrixProducts(project).some(p => p.itemId !== null);

export const matrixCellKey = (itemId: number, stageOrder: number): string => `${itemId}|${stageOrder}`;

/** A cell's share of done work: a ticked cell is whole, any other its schedule work (none = 0). */
export function cellShare(status: string, work: Pick<WorkProgress, 'share'> | null | undefined): number {
  if (status === 'completed') return 1;
  return work ? Math.min(1, Math.max(0, work.share)) : 0;
}

/**
 * The percent of a set of cells (a product's stages, or a stage's products): the average share, 100 only when every
 * cell is ticked, so «۱۰۰٪» always means «تمام» and the completion rules (ticks only) read the same.
 */
export function cellsPercent(cells: ReadonlyArray<{ status: string; work?: Pick<WorkProgress, 'share'> | null }>): number {
  if (cells.length === 0) return 0;
  if (cells.every(c => c.status === 'completed')) return 100;
  const share = cells.reduce((acc, c) => acc + cellShare(c.status, c.work), 0) / cells.length;
  return Math.min(99, workPercent(share));
}

export function computeProgressMatrix(products: MatrixProduct[], stages: MatrixStage[], rows: MatrixProgressRow[], workRows: readonly MatrixWorkRow[] = []): ProgressMatrix {
  const progress = new Map<string, MatrixProgressRow>();
  for (const r of rows) progress.set(matrixCellKey(Number(r.itemId), Number(r.stageOrder)), r);
  const workOfCell = new Map<string, MatrixWorkRow[]>();
  for (const w of workRows) {
    const key = matrixCellKey(w.itemId, w.stageOrder);
    workOfCell.set(key, [...(workOfCell.get(key) ?? []), w]);
  }

  const optionalTitles = new Set(products.flatMap(p => p.selectedOptionalStages));
  const allOrders = stages.map(s => s.stageOrder);

  const productRows: MatrixProductProgress[] = products.map(p => {
    const selected = new Set(p.selectedOptionalStages);
    const applicable = p.itemId === null
      ? []
      : stages.filter(s => !optionalTitles.has(s.title.trim()) || selected.has(s.title.trim()));
    const cells = applicable.map(s => {
      const row = progress.get(matrixCellKey(p.itemId as number, s.stageOrder));
      return {
        stageOrder: s.stageOrder,
        stageTitle: s.title || row?.stageTitle || '',
        status: row?.status || 'pending',
        updatedAt: row?.updatedAt || '',
        updatedByName: row?.updatedByName || '',
        work: workProgressOf(workOfCell.get(matrixCellKey(p.itemId as number, s.stageOrder)) ?? []),
      };
    });
    const applicableOrders = applicable.map(s => s.stageOrder);
    const completedCount = cells.filter(c => c.status === 'completed').length;
    return {
      ...p,
      applicableOrders,
      excludedOrders: allOrders.filter(o => !applicableOrders.includes(o)),
      cells,
      completedCount,
      percent: cellsPercent(cells),
    };
  });

  const counted = productRows.filter(p => p.itemId !== null);
  const totalCells = counted.reduce((acc, p) => acc + p.applicableOrders.length, 0);
  const completedCells = counted.reduce((acc, p) => acc + p.completedCount, 0);
  const totalQty = productRows.reduce((acc, p) => acc + p.quantity, 0);
  const weighted = totalQty > 0
    ? Math.round(productRows.reduce((acc, p) => acc + p.percent * p.quantity, 0) / totalQty)
    : 0;
  // 10.2 package 12 (D6): 100 only when every product reads 100 (every cell ticked), never by rounding 99.5
  const weightedProgress = weighted >= 100 && productRows.some(p => p.percent < 100) ? 99 : weighted;
  const isDone = (p: MatrixProductProgress) => p.applicableOrders.length > 0 && p.completedCount === p.applicableOrders.length;

  return {
    products: productRows,
    totalCells,
    completedCells,
    allCompleted: totalCells > 0 && completedCells === totalCells,
    weightedProgress,
    fullyCompletedProducts: productRows.filter(isDone).length,
    allProductsDone: counted.length > 0 && counted.every(isDone),
    stageCounts: stages.map(s => {
      const stageCells = counted.flatMap(p => p.cells.filter(c => c.stageOrder === s.stageOrder));
      return {
        stageOrder: s.stageOrder,
        title: s.title,
        applicableCount: counted.filter(p => p.applicableOrders.includes(s.stageOrder)).length,
        completedCount: counted.filter(p => p.cells.some(c => c.stageOrder === s.stageOrder && c.status === 'completed')).length,
        percent: cellsPercent(stageCells),
      };
    }),
  };
}
