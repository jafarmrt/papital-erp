import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * Package 11 (project control and production), PR «الف»: one progress matrix rule, project status written only by
 * write paths, stage numbering and stage input. Runs on real Express routes and PostgreSQL in an isolated schema and
 * is red on the version before each fix.
 */

type Row = Record<string, unknown>;
type Client = Awaited<ReturnType<typeof sandboxAdminClient>>;
const brief = (body: unknown) => String(JSON.stringify(body)).slice(0, 240);
const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await pool.query(sql, params)).rows;

interface ProjectOptions { products?: Array<{ itemId: number; qty: number }>; itemId?: number; stages?: string[] }

async function newProject(api: Client, opts: ProjectOptions): Promise<{ id: number; stages: Array<{ id: number }> }> {
  const today = await businessTodayIsoDate();
  const body: Row = {
    title: `TD-P11 ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, start_date: today, end_date: today, quantity: 5,
    initial_stages: (opts.stages ?? ['برش', 'مونتاژ', 'کنترل کیفیت']).map(title => ({ title })),
  };
  if (opts.products) body.products = opts.products.map(p => ({ item_id: p.itemId, item_code: `C${p.itemId}`, item_name: `کالا ${p.itemId}`, quantity: p.qty, unit: 'عدد' }));
  if (opts.itemId) { body.item_id = opts.itemId; body.item_name = `کالا ${opts.itemId}`; }
  const res = await api.post('/api/projects', body);
  if (res.status !== 201) throw new Error(`create project answered ${res.status} ${brief(res.body)}`);
  return res.body as { id: number; stages: Array<{ id: number }> };
}

const projectStatus = async (id: number) => String((await q('SELECT status FROM production_projects WHERE id = $1', [id]))[0]?.status);

const tickAll = (api: Client, projectId: number, itemId: number, orders: number[]) =>
  api.put(`/api/projects/${projectId}/product-progress`, { items: orders.map(order => ({ item_id: itemId, stage_order: order, status: 'completed' })) });

const statusAuditRows = async (projectId: number) => q(
  `SELECT details FROM activity_logs WHERE entity = 'پروژه تولید' AND entity_id = $1 AND details->'changes' ? 'status' ORDER BY id`,
  [String(projectId)]
);

export async function runProjectStageIntegrityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const matrixId = 'reg_project_matrix_single_item_td_739';
  if (shouldRun(matrixId, 'td739', 'projects', 'package11')) {
    await runCase(results, matrixId, 'v9.0.333: a project defined by its main item only shows, ticks and completes its progress matrix with the one shared rule; a manual completion with open cells is refused with PROJECT_MATRIX_INCOMPLETE (TD-739)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const single = await newProject(api, { itemId: item.id });

      const view = await api.get(`/api/projects/${single.id}/product-progress`);
      const rows = view.body?.data?.products ?? [];
      if (view.status !== 200 || rows.length !== 1 || rows[0]?.item_id !== item.id || view.body?.data?.summary?.total_matrix_cells !== 3) {
        problems.push(`GET product-progress of a main-item project answered ${view.status} ${brief(view.body?.data?.summary)} with ${rows.length} product rows, expected the main item with 3 cells`);
      }
      const tick = await api.put(`/api/projects/${single.id}/product-progress`, { items: [1, 2, 3].map(order => ({ item_id: item.id, stage_order: order, status: 'completed' })) });
      if (tick.status !== 200 || tick.body?.applied !== 3 || tick.body?.skipped_invalid !== 0) {
        problems.push(`ticking the main item × 3 stages answered ${tick.status} ${brief(tick.body)}, expected 3 applied and none skipped`);
      }
      const status = await projectStatus(single.id);
      if (status !== 'completed') problems.push(`after ticking every cell the project status is ${status}, expected completed`);

      const other = await newProject(api, { products: [{ itemId: item.id, qty: 2 }] });
      await api.put(`/api/projects/${other.id}/product-progress`, { items: [{ item_id: item.id, stage_order: 1, status: 'completed' }] });
      const early = await api.put(`/api/projects/${other.id}`, { status: 'completed' });
      if (early.status !== 422 || early.body?.code !== 'PROJECT_MATRIX_INCOMPLETE' || !String(early.body?.error ?? early.body?.message ?? '').includes('1 از 3')) {
        problems.push(`completing a project with 1 of 3 cells answered ${early.status} ${brief(early.body)}, expected 422 PROJECT_MATRIX_INCOMPLETE naming 1 of 3`);
      }
      if (await projectStatus(other.id) === 'completed') problems.push('the refused completion still stored the completed status');
      assertNoProblems(problems);
      return 'main-item matrix shown, ticked and completed; early completion refused with 422';
    }));
  }

  const writeOnlyId = 'reg_project_status_written_on_write_only_td_738';
  if (shouldRun(writeOnlyId, 'td738', 'projects', 'package11')) {
    await runCase(results, writeOnlyId, 'v9.0.334: reading a project never writes its status; ticks, stage writes and project edits sync it under the project lock with an audit row and never change a cancelled or paused project (TD-738)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const reader = await sandboxClientWith(['warehouse.view', 'projects.view']);
      const item = await createTestItem({ type: 'product' });

      // تیک همه خانه‌ها پروژه را «تکمیل‌شده» می‌کند و ردیف ممیزی تغییر وضعیت می‌نویسد
      const done = await newProject(api, { products: [{ itemId: item.id, qty: 2 }], stages: ['برش', 'مونتاژ'] });
      const tick = await tickAll(api, done.id, item.id, [1, 2]);
      if (tick.status !== 200 || tick.body?.project_status !== 'completed') problems.push(`ticking every cell answered ${tick.status} ${brief(tick.body)}, expected project_status completed`);
      const audit = await statusAuditRows(done.id);
      const lastAfter = (audit.at(-1)?.details as { after?: { status?: string } } | undefined)?.after?.status;
      if (lastAfter !== 'تکمیل‌شده') problems.push(`the matrix status change left audit rows ${brief(audit)}, expected one ending «تکمیل‌شده»`);

      // پروژه لغوشده با ماتریس کامل: خواندن و تیک دوباره وضعیت را تغییر نمی‌دهند و تحویل همچنان رد می‌شود
      const cancel = await api.put(`/api/projects/${done.id}`, { status: 'cancelled' });
      if (cancel.status !== 200) problems.push(`cancelling the project answered ${cancel.status} ${brief(cancel.body)}`);
      const readProject = await reader.get(`/api/projects/${done.id}`);
      const readMatrix = await reader.get(`/api/projects/${done.id}/product-progress`);
      if (readProject.status !== 200 || readMatrix.status !== 200) problems.push(`the reader got ${readProject.status} / ${readMatrix.status}, expected 200 / 200`);
      if (await projectStatus(done.id) !== 'cancelled') problems.push(`after two reads the cancelled project is ${await projectStatus(done.id)}`);
      await tickAll(api, done.id, item.id, [1]);
      if (await projectStatus(done.id) !== 'cancelled') problems.push(`a tick changed the cancelled project to ${await projectStatus(done.id)}`);
      const deliver = await api.post(`/api/projects/${done.id}/add-to-inventory`, { itemsToAdd: [{ itemId: item.id, quantity: 1 }] });
      if (deliver.status !== 422) problems.push(`delivering from the cancelled project answered ${deliver.status} ${brief(deliver.body)}, expected 422`);

      // پروژه متوقف‌شده با تیک کامل متوقف می‌ماند
      const paused = await newProject(api, { products: [{ itemId: item.id, qty: 1 }], stages: ['برش'] });
      await api.put(`/api/projects/${paused.id}`, { status: 'paused' });
      await tickAll(api, paused.id, item.id, [1]);
      if (await projectStatus(paused.id) !== 'paused') problems.push(`ticking a paused project changed it to ${await projectStatus(paused.id)}`);

      // حذف مرحله وضعیت را در همان تراکنش همگام می‌کند (بی نیاز به خواندن)
      const partial = await newProject(api, { products: [{ itemId: item.id, qty: 1 }] });
      await tickAll(api, partial.id, item.id, [1, 2]);
      if (await projectStatus(partial.id) !== 'in_progress') problems.push(`two of three cells left the project ${await projectStatus(partial.id)}, expected in_progress`);
      const removed = await api.del(`/api/projects/${partial.id}/stages/${partial.stages[2].id}`);
      if (removed.status !== 200) problems.push(`deleting the open stage answered ${removed.status} ${brief(removed.body)}`);
      if (await projectStatus(partial.id) !== 'completed') problems.push(`after deleting the only open stage the project is ${await projectStatus(partial.id)}, expected completed`);
      assertNoProblems(problems);
      return 'reads write nothing; writes sync with an audit row; cancelled and paused stay';
    }));
  }

  return results;
}
