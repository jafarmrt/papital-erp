/**
 * v10.2.7 (10.2 package 10): the tick rules of a project's progress matrix (item × stage), shared by the desktop table
 * («۳. پیشرفت هر کالا») and the phone list, so both read the same answer of `GET /projects/:id/product-progress`,
 * flip a cell the same way and send the same `PUT` body. The server alone decides what a tick means
 * (`computeProgressMatrix` and the status sync in the tick's transaction, TD-738 / TD-739); a later rule for the
 * progress (approved workshop counts) changes these functions once for both screens.
 */

export type ProgressCellStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface ProgressStageMeta { stage_order: number; title: string; status?: string }

export interface ProgressCell {
  stage_order: number;
  stage_title: string;
  status: ProgressCellStatus;
  updated_at: string;
  updated_by_name: string;
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
    per_stage_counts: Array<{ stage_order: number; title: string; completed_count: number; applicable_skus: number }>;
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

/** a product's percent on screen: its ticked stages among the stages that apply to it */
export function tickedProgressPercent(product: ProgressProduct, edits: ProgressTickEdits): number {
  const applicable = product.applicable_stage_orders;
  if (applicable.length === 0) return 0;
  const done = applicable.filter(order => resolveTickStatus(product, order, edits) === 'completed').length;
  return Math.round((done / applicable.length) * 100);
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
