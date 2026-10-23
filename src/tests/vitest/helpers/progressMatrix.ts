/**
 * 10.3 (ARCH review finding 3, part 10): the progress matrix of one product over two stages and the project it belongs
 * to, shared by the progress and delivery data-layer tests.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
export const SHOWN = {
  stageOne: 'برش',
  stageTwo: 'مونتاژ',
  cell: (stage: string, done: boolean) => `${stage} — ${done ? 'تمام' : 'ناتمام'} (کلیک: تغییر تمام/ناتمام)`,
  saveOne: 'ثبت ۱ تغییر در سامانه',
  markCompleted: 'تغییر وضعیت پروژه به تکمیل‌شده',
  deliver: 'ورود به انبار',
} as const;

export type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
export type Done = readonly [boolean, boolean];
export const STAGES = [SHOWN.stageOne, SHOWN.stageTwo];
/** the progress matrix of one product over two stages, each stage ticked or not */
export const matrixOf = (done: Done) => {
  const completed = done.filter(Boolean).length;
  return {
    stages: STAGES.map((title, i) => ({ stage_order: i + 1, title })),
    products: [{
      item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', quantity: 5, unit: 'عدد', applicable_stage_orders: [1, 2], excluded_stage_orders: [],
      progress: STAGES.map((title, i) => ({ stage_order: i + 1, stage_title: title, status: done[i] ? 'completed' : 'pending', updated_at: '', updated_by_name: '' })),
      completed_count: completed, applicable_count: 2, progress_percent: completed * 50,
    }],
    summary: {
      total_skus: 1, total_quantity: 5, weighted_progress_percent: completed * 50, fully_completed_skus: completed === 2 ? 1 : 0,
      total_matrix_cells: 2, completed_matrix_cells: completed, all_matrix_completed: completed === 2,
      per_stage_counts: STAGES.map((title, i) => ({ stage_order: i + 1, title, completed_count: done[i] ? 1 : 0, applicable_skus: 1, progress_percent: done[i] ? 100 : 0 })),
    },
  };
};
export const project = {
  id: 7, version: 3, project_code: 'PRJ-7', title: 'پروژه پیشرفت', status: 'in_progress', quantity: 5, unit: 'عدد', progress_percent: 0,
  start_date: '2026-08-23', end_date: '2026-09-22',
  products: [{ id: 'p1', item_id: 50, item_code: 'NK-1', item_name: 'گردنبند', customer_code: '', quantity: 5, unit: 'عدد', needs_assembly: false }],
  stages: STAGES.map((title, i) => ({ id: 11 + i, project_id: 7, stage_order: i + 1, title, status: 'pending', progress_percent: 0, assigned_personnel: [], required_resources: [] })),
};
