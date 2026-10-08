/**
 * v9.0.333 (TD-739): تنها قاعده ماتریس پیشرفت «کد کالا × مرحله» پروژه. پیش‌تر سه نسخه داشت (route نمایش و تیک، بررسی
 * تکمیل و همگام‌ساز وضعیت) که با هم نمی‌خواندند: برای پروژه‌ای که فقط کالای اصلی دارد نمایش صفر ردیف داشت و تیک‌ها رد
 * می‌شدند، ولی بررسی تکمیل «۰ از ۳» می‌گفت و تکمیل را رد می‌کرد.
 *
 * محصولات ماتریس: ردیف‌های `products` پروژه، و اگر خالی باشد کالای اصلی پروژه. مراحل اختیاری: عنوان‌هایی که در
 * `selected_optional_stages` (یا `selectedOptionalStages`) دست‌کم یک محصول آمده‌اند؛ هر محصول فقط مرحله‌های اختیاری
 * انتخاب خودش را دارد. کلید هر خانه «شناسه کالا | شماره مرحله» است.
 */

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
 * v9.0.335 (TD-758، تصمیم ت۱ الف): پروژه‌ای که ماتریس پیشرفت دارد؛ وضعیت و درصد مراحلش را فقط ماتریس تعیین می‌کند و
 * وضعیت دستی مرحله فقط برای پروژه بی محصول است.
 */
export const hasMatrixProducts = (project: MatrixProjectSource): boolean =>
  matrixProducts(project).some(p => p.itemId !== null);

export const matrixCellKey = (itemId: number, stageOrder: number): string => `${itemId}|${stageOrder}`;

export function computeProgressMatrix(products: MatrixProduct[], stages: MatrixStage[], rows: MatrixProgressRow[]): ProgressMatrix {
  const progress = new Map<string, MatrixProgressRow>();
  for (const r of rows) progress.set(matrixCellKey(Number(r.itemId), Number(r.stageOrder)), r);

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
      percent: applicableOrders.length > 0 ? Math.round((completedCount / applicableOrders.length) * 100) : 0,
    };
  });

  const counted = productRows.filter(p => p.itemId !== null);
  const totalCells = counted.reduce((acc, p) => acc + p.applicableOrders.length, 0);
  const completedCells = counted.reduce((acc, p) => acc + p.completedCount, 0);
  const totalQty = productRows.reduce((acc, p) => acc + p.quantity, 0);
  const weightedProgress = totalQty > 0
    ? Math.round(productRows.reduce((acc, p) => acc + p.percent * p.quantity, 0) / totalQty)
    : 0;
  const isDone = (p: MatrixProductProgress) => p.applicableOrders.length > 0 && p.completedCount === p.applicableOrders.length;

  return {
    products: productRows,
    totalCells,
    completedCells,
    allCompleted: totalCells > 0 && completedCells === totalCells,
    weightedProgress,
    fullyCompletedProducts: productRows.filter(isDone).length,
    allProductsDone: counted.length > 0 && counted.every(isDone),
    stageCounts: stages.map(s => ({
      stageOrder: s.stageOrder,
      title: s.title,
      applicableCount: counted.filter(p => p.applicableOrders.includes(s.stageOrder)).length,
      completedCount: counted.filter(p => p.cells.some(c => c.stageOrder === s.stageOrder && c.status === 'completed')).length,
    })),
  };
}
