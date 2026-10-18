import { formatPersianNumber } from '../../utils/persianNumber';
import { workPercent } from '../workshop/scheduleWorkProgress';
import { cellsPercent } from './progressMatrix';

/**
 * v10.2.9 (10.2 package 10): the tick rules of a project's progress matrix (item × stage), shared by the desktop table
 * («۳. پیشرفت هر کالا») and the phone list, so both read the same answer of `GET /projects/:id/product-progress`,
 * flip a cell the same way and send the same `PUT` body. The server alone decides what a tick means
 * (`computeProgressMatrix` and the status sync in the tick's transaction, TD-738 / TD-739).
 * 10.2 package 12 (D6, owner decision ت۴۲ الف): a cell also carries the done work of its workshop schedule rows, and a
 * percent counts it (`cellsPercent`, the server's own rule), while «تمام» stays the manager's tick.
 */

export type ProgressCellStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/** a cell's workshop work (`scheduleWorkProgress.ts`): quantities only when `unit` is set, `share` from 0 to 1 */
export interface ProgressCellWork {
  planned_quantity: number;
  done_quantity: number;
  unit: string | null;
  share: number;
}

export interface ProgressStageMeta { stage_order: number; title: string; status?: string }

export interface ProgressCell {
  stage_order: number;
  stage_title: string;
  status: ProgressCellStatus;
  updated_at: string;
  updated_by_name: string;
  /** absent from an answer before 10.2 package 12, null when the cell has no schedule row */
  work?: ProgressCellWork | null;
}

export interface ProgressProduct {
  item_id: number | null;
  item_code: string;
  item_name: string;
  customer_code?: string;
  quantity: number;
  unit: string;
  applicable_stage_orders: number[];
  excluded_stage_orders: number[];
  progress: ProgressCell[];
  completed_count: number;
  applicable_count: number;
  progress_percent: number;
}

export interface ProductProgressResponse {
  stages: ProgressStageMeta[];
  products: ProgressProduct[];
  summary: {
    total_skus: number;
    total_quantity: number;
    weighted_progress_percent: number;
    fully_completed_skus: number;
    per_stage_counts: Array<{ stage_order: number; title: string; completed_count: number; applicable_skus: number; progress_percent?: number }>;
    total_matrix_cells?: number;
    completed_matrix_cells?: number;
    all_matrix_completed?: boolean;
    missing_matrix_cells?: number;
  };
}

/** the cell labels of the matrix (a cell is ticked or not; older rows may still be «در جریان» or «متوقف») */
export const PROGRESS_CELL_LABELS: Record<ProgressCellStatus, string> = {
  pending: 'ناتمام',
  in_progress: 'در جریان',
  completed: 'تمام',
  blocked: 'متوقف',
};

/** cells changed on screen and not yet sent, keyed by `progressTickKey` */
export type ProgressTickEdits = ReadonlyMap<string, ProgressCellStatus>;

export const progressTickKey = (itemId: number | null, stageOrder: number): string => `${itemId}|${stageOrder}`;

/** a cell's status on screen: the unsent change, else the stored one, else «ناتمام» */
export function resolveTickStatus(product: ProgressProduct, stageOrder: number, edits: ProgressTickEdits): ProgressCellStatus {
  const edited = edits.get(progressTickKey(product.item_id, stageOrder));
  if (edited) return edited;
  return product.progress.find(cell => cell.stage_order === stageOrder)?.status || 'pending';
}

/** a tap flips a cell between «تمام» and «ناتمام»; any other status becomes «تمام» */
export const toggledTickStatus = (current: ProgressCellStatus): ProgressCellStatus => (current === 'completed' ? 'pending' : 'completed');

/** a cell's workshop work, when it has any */
export const cellWorkOf = (product: ProgressProduct, stageOrder: number): ProgressCellWork | null =>
  product.progress.find(cell => cell.stage_order === stageOrder)?.work ?? null;

const cellOnScreen = (product: ProgressProduct, order: number, edits: ProgressTickEdits) => ({
  status: resolveTickStatus(product, order, edits),
  work: cellWorkOf(product, order),
});

/**
 * a product's percent on screen: its stages' average, a ticked stage whole and any other its workshop work; 100 only
 * when every stage is ticked (`cellsPercent`, the server's rule, so an unsent tick reads as it will after «ثبت»)
 */
export function progressPercentOf(product: ProgressProduct, edits: ProgressTickEdits): number {
  return cellsPercent(product.applicable_stage_orders.map(order => cellOnScreen(product, order, edits)));
}

/** a stage's percent on screen over the products it applies to, by the same rule */
export function stageProgressPercent(products: readonly ProgressProduct[], stageOrder: number, edits: ProgressTickEdits): number {
  return cellsPercent(products
    .filter(p => p.item_id !== null && p.applicable_stage_orders.includes(stageOrder))
    .map(p => cellOnScreen(p, stageOrder, edits)));
}

/** «۶۰ از ۱۰۰ عدد» for a cell of one unit, else its percent; `short` drops the unit for a narrow table cell */
export function cellWorkLabel(work: ProgressCellWork, short = false): string {
  if (!work.unit) return `${formatPersianNumber(workPercent(work.share), 0)}٪`;
  const counts = `${formatPersianNumber(work.done_quantity, 4)} از ${formatPersianNumber(work.planned_quantity, 4)}`;
  return short ? counts : `${counts} ${work.unit}`;
}

/** the body rows of `PUT /projects/:id/product-progress` for the unsent changes */
export function progressTickRequestItems(edits: ProgressTickEdits): Array<{ item_id: number; stage_order: number; status: ProgressCellStatus }> {
  return Array.from(edits.entries()).map(([key, status]) => {
    const [itemId, order] = key.split('|');
    return { item_id: Number(itemId), stage_order: Number(order), status };
  });
}

/** the stages every product has first, then the optional stages only some products have */
export function splitStageColumns(stages: readonly ProgressStageMeta[], products: readonly ProgressProduct[]): { baseStages: ProgressStageMeta[]; optionalStages: ProgressStageMeta[] } {
  const baseStages = stages.filter(s => products.length > 0 && products.every(p => p.applicable_stage_orders.includes(s.stage_order)));
  const optionalStages = stages.filter(s => !baseStages.includes(s));
  return { baseStages, optionalStages };
}
