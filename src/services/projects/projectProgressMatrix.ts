import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { productionProjects, projectProductStageProgress, projectStages } from '../../db/schema.js';
import { computeProgressMatrix, matrixProducts, type ProgressMatrix } from '../../lib/projects/progressMatrix.js';

type ProjectRow = typeof productionProjects.$inferSelect;
type StageRow = typeof projectStages.$inferSelect;

export interface LoadedProgressMatrix {
  stages: StageRow[];
  matrix: ProgressMatrix;
}

/**
 * v9.0.333 (TD-739): مراحل زنده و ماتریس پیشرفت یک پروژه با قاعده مشترک `computeProgressMatrix`؛ نمایش، تیک،
 * بررسی تکمیل و همگام‌ساز وضعیت همه همین را می‌خوانند.
 */
export async function loadProjectProgressMatrix(executor: DbExecutor, project: ProjectRow): Promise<LoadedProgressMatrix> {
  const stages = await executor.select().from(projectStages)
    .where(and(eq(projectStages.projectId, project.id), eq(projectStages.isDeleted, 0)))
    .orderBy(asc(projectStages.stageOrder), asc(projectStages.id));
  const rows = await executor.select().from(projectProductStageProgress)
    .where(and(eq(projectProductStageProgress.projectId, project.id), eq(projectProductStageProgress.isDeleted, 0)));
  const matrix = computeProgressMatrix(
    matrixProducts(project),
    stages.map(s => ({ stageOrder: s.stageOrder, title: s.title })),
    rows.map(r => ({ itemId: r.itemId, stageOrder: r.stageOrder, status: r.status, stageTitle: r.stageTitle, updatedAt: r.updatedAt, updatedByName: r.updatedByName }))
  );
  return { stages, matrix };
}

export interface ProgressMatrixStatus {
  allMatrixCompleted: boolean;
  totalMatrixCells: number;
  completedMatrixCells: number;
  missingMatrixCells: number;
  reason?: string;
}

export function progressMatrixStatus(loaded: LoadedProgressMatrix): ProgressMatrixStatus {
  const { stages, matrix } = loaded;
  const base = {
    allMatrixCompleted: matrix.allCompleted,
    totalMatrixCells: matrix.totalCells,
    completedMatrixCells: matrix.completedCells,
    missingMatrixCells: Math.max(0, matrix.totalCells - matrix.completedCells),
  };
  if (stages.length === 0) return { ...base, allMatrixCompleted: false, reason: 'هیچ مرحله‌ای برای پروژه تعریف نشده است' };
  if (!matrix.products.some(p => p.itemId !== null)) return { ...base, allMatrixCompleted: false, reason: 'هیچ کد کالایی برای پروژه تعریف نشده است' };
  return base;
}

/** پاسخ `GET /projects/:id/product-progress` (همان قرارداد پیشین با کلیدهای snake_case) */
export function productProgressView(loaded: LoadedProgressMatrix) {
  const { stages, matrix } = loaded;
  const totalQuantity = matrix.products.reduce((acc, p) => acc + p.quantity, 0);
  return {
    stages: stages.map(s => ({ stage_order: s.stageOrder, title: s.title, status: s.status })),
    products: matrix.products.map(p => ({
      item_id: p.itemId,
      item_code: p.itemCode,
      item_name: p.itemName,
      quantity: p.quantity,
      unit: p.unit,
      applicable_stage_orders: p.applicableOrders,
      excluded_stage_orders: p.excludedOrders,
      progress: p.cells.map(c => ({
        stage_order: c.stageOrder,
        stage_title: c.stageTitle,
        status: c.status,
        updated_at: c.updatedAt,
        updated_by_name: c.updatedByName,
      })),
      completed_count: p.completedCount,
      applicable_count: p.applicableOrders.length,
      progress_percent: p.percent,
    })),
    summary: {
      total_skus: matrix.products.length,
      total_quantity: totalQuantity,
      weighted_progress_percent: matrix.weightedProgress,
      fully_completed_skus: matrix.fullyCompletedProducts,
      per_stage_counts: matrix.stageCounts.map(c => ({
        stage_order: c.stageOrder,
        title: c.title,
        completed_count: c.completedCount,
        applicable_skus: c.applicableCount,
      })),
      total_matrix_cells: matrix.totalCells,
      completed_matrix_cells: matrix.completedCells,
      all_matrix_completed: matrix.allCompleted,
      missing_matrix_cells: Math.max(0, matrix.totalCells - matrix.completedCells),
    },
  };
}
