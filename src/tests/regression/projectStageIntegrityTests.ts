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

export type Row = Record<string, unknown>;
export type Client = Awaited<ReturnType<typeof sandboxAdminClient>>;
export const brief = (body: unknown) => String(JSON.stringify(body)).slice(0, 240);
export const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await pool.query(sql, params)).rows;

export interface ProjectOptions { products?: Array<{ itemId: number; qty: number }>; itemId?: number; stages?: string[] }

export async function newProject(api: Client, opts: ProjectOptions): Promise<{ id: number; stages: Array<{ id: number }> }> {
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

export const projectStatus = async (id: number) => String((await q('SELECT status FROM production_projects WHERE id = $1', [id]))[0]?.status);

/** v9.0.343 (TD-742): a project edit sends the version it was built from; tests edit from the stored version */
export const projectVersion = async (id: number) => Number((await q('SELECT version FROM production_projects WHERE id = $1', [id]))[0]?.version);
export const editProject = async (api: Client, id: number, body: Row) => api.put(`/api/projects/${id}`, { ...body, version: await projectVersion(id) });

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
      const early = await editProject(api, other.id, { status: 'completed' });
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
      if (lastAfter !== 'تکمیل‌شده') problems.push(`the matrix status change left audit rows ${brief(audit)}, expected the last one to end on the completed label`);

      // پروژه لغوشده با ماتریس کامل: خواندن و تیک دوباره وضعیت را تغییر نمی‌دهند و تحویل همچنان رد می‌شود
      const cancel = await editProject(api, done.id, { status: 'cancelled' });
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
      await editProject(api, paused.id, { status: 'paused' });
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

  const manualId = 'reg_project_stage_manual_status_td_758';
  if (shouldRun(manualId, 'td758', 'projects', 'package11')) {
    await runCase(results, manualId, 'v9.0.335: a manual stage status or percent that differs from the matrix is refused with 422 STAGE_STATUS_FROM_MATRIX in a project with products, and stays manual in a project without products (TD-758)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const stageRow = async (id: number) => (await q('SELECT status, progress_percent FROM project_stages WHERE id = $1', [id]))[0] ?? {};

      const withProducts = await newProject(api, { products: [{ itemId: item.id, qty: 1 }] });
      const first = withProducts.stages[0].id;
      const forced = await api.put(`/api/projects/${withProducts.id}/stages/${first}`, { status: 'completed', progress_percent: 100 });
      if (forced.status !== 422 || forced.body?.code !== 'STAGE_STATUS_FROM_MATRIX') problems.push(`a manual completed status in a matrix project answered ${forced.status} ${brief(forced.body)}, expected 422 STAGE_STATUS_FROM_MATRIX`);
      const kept = await stageRow(first);
      if (kept.status !== 'pending' || Number(kept.progress_percent) !== 0) problems.push(`the refused stage is ${brief(kept)}, expected pending 0`);
      const same = await api.put(`/api/projects/${withProducts.id}/stages/${first}`, { title: 'برش لیزری', status: 'pending', progress_percent: 0 });
      if (same.status !== 200 || same.body?.title !== 'برش لیزری') problems.push(`a title edit sending the unchanged status answered ${same.status} ${brief(same.body)}, expected 200`);

      const manual = await newProject(api, { stages: ['طراحی'] });
      const set = await api.put(`/api/projects/${manual.id}/stages/${manual.stages[0].id}`, { status: 'completed', progress_percent: 100 });
      const manualRow = await stageRow(manual.stages[0].id);
      if (set.status !== 200 || manualRow.status !== 'completed') problems.push(`a manual status in a project without products answered ${set.status} ${brief(set.body)} and stored ${brief(manualRow)}, expected completed`);
      assertNoProblems(problems);
      return 'matrix stage refuses a manual status; a project without products keeps it';
    }));
  }

  const orderId = 'reg_project_stage_order_td_737';
  if (shouldRun(orderId, 'td737', 'projects', 'package11')) {
    await runCase(results, orderId, 'v9.0.336: a new stage is numbered after every number the project used, never inherits a deleted stage\'s ticks, concurrent adds get distinct numbers and the database refuses two live stages with one number (TD-737)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const today = await businessTodayIsoDate();
      const addStage = (projectId: number, title: string) => api.post(`/api/projects/${projectId}/stages`, { title, start_date: today, end_date: today });
      const liveOrders = async (projectId: number) => (await q('SELECT stage_order FROM project_stages WHERE project_id = $1 AND is_deleted = 0 ORDER BY stage_order, id', [projectId])).map(r => Number(r.stage_order));

      // سه مرحله تیک خورد، مرحله ۳ حذف شد و مرحله تازه افزوده شد
      const ticked = await newProject(api, { products: [{ itemId: item.id, qty: 1 }] });
      await tickAll(api, ticked.id, item.id, [1, 2, 3]);
      await api.del(`/api/projects/${ticked.id}/stages/${ticked.stages[2].id}`);
      const pack = await addStage(ticked.id, 'بسته‌بندی');
      if (pack.status !== 201 || Number(pack.body?.stage_order ?? pack.body?.stageOrder) !== 4) problems.push(`the stage added after deleting stage 3 answered ${pack.status} ${brief(pack.body)}, expected number 4`);
      const view = await api.get(`/api/projects/${ticked.id}/product-progress`);
      const cell = (view.body?.data?.products?.[0]?.progress ?? []).find((c: Row) => c.stage_title === 'بسته‌بندی');
      if (cell?.status !== 'pending') problems.push(`the new stage's matrix cell is ${brief(cell)}, expected pending`);
      if (await projectStatus(ticked.id) === 'completed') problems.push('the project with a new open stage is still completed');
      const deletedTicks = await q("SELECT count(*)::int AS n FROM project_product_stage_progress WHERE project_id = $1 AND stage_order = 3 AND is_deleted = 0", [ticked.id]);
      if (Number(deletedTicks[0]?.n) !== 0) problems.push(`the deleted stage kept ${deletedTicks[0]?.n} live ticks`);

      // حذف مرحله میانی و افزودن هم‌زمان
      const middle = await newProject(api, { products: [{ itemId: item.id, qty: 1 }] });
      await api.del(`/api/projects/${middle.id}/stages/${middle.stages[1].id}`);
      await addStage(middle.id, 'رنگ‌کاری');
      const after = await liveOrders(middle.id);
      if (after.join(',') !== '1,3,4') problems.push(`after deleting the middle stage and adding one the numbers are ${after.join(',')}, expected 1,3,4`);
      const burst = await Promise.all([1, 2, 3, 4, 5].map(n => addStage(middle.id, `هم‌زمان ${n}`)));
      const orders = await liveOrders(middle.id);
      if (burst.some(r => r.status !== 201) || new Set(orders).size !== orders.length) problems.push(`five concurrent adds answered ${burst.map(r => r.status).join(',')} with numbers ${orders.join(',')}, expected distinct numbers`);

      // پایگاه‌داده دو مرحله زنده با یک شماره را رد می‌کند
      let refused = false;
      try {
        await q("INSERT INTO project_stages (project_id, stage_order, title) VALUES ($1, 1, 'تکراری')", [middle.id]);
      } catch (err) {
        refused = String((err as { code?: string }).code) === '23505';
      }
      if (!refused) problems.push('a second live stage number 1 was stored');
      assertNoProblems(problems);
      return 'numbers never reused; deleted stage ticks dropped; concurrent adds distinct; unique index';
    }));
  }

  const fkId = 'reg_project_stage_project_fk_td_753';
  if (shouldRun(fkId, 'td753', 'projects', 'package11')) {
    await runCase(results, fkId, 'v9.0.336: a stage is added only to a live project (404 otherwise), the database refuses a stage of a missing project and the health check reports the stage constraints (TD-753)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const gone = await newProject(api, { stages: ['طراحی'] });
      await api.del(`/api/projects/${gone.id}`);
      for (const id of [gone.id, 987654321]) {
        const res = await api.post(`/api/projects/${id}/stages`, { title: 'مرحله یتیم', start_date: today, end_date: today });
        if (res.status !== 404) problems.push(`adding a stage to project ${id} answered ${res.status} ${brief(res.body)}, expected 404`);
      }
      let refused = false;
      try {
        await q("INSERT INTO project_stages (project_id, stage_order, title) VALUES (987654321, 1, 'یتیم')");
      } catch (err) {
        refused = String((err as { code?: string }).code) === '23503';
      }
      if (!refused) problems.push('a stage of a missing project was stored');

      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const check = (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'project_stage_integrity');
      if (check?.status !== 'healthy' || check?.metrics?.projectForeignKeyValid !== 1 || check?.metrics?.orderIndexPresent !== 1) {
        problems.push(`the health check reported ${brief(check)}, expected healthy with the index and a valid foreign key`);
      }
      assertNoProblems(problems);
      return 'stage of a deleted or missing project refused by the service and the foreign key';
    }));
  }

  const inputId = 'reg_project_stage_input_td_755';
  if (shouldRun(inputId, 'td755', 'projects', 'package11')) {
    await runCase(results, inputId, 'v9.0.337: an invalid stage number or percent is a Persian 400 without SQL text, a number held by another stage is 409 STAGE_ORDER_TAKEN, and a renumbered stage keeps its ticks (TD-755)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const manual = await newProject(api, {});
      const stageUrl = (projectId: number, stageId: number) => `/api/projects/${projectId}/stages/${stageId}`;

      for (const body of [{ stage_order: 'abc' }, { progress_percent: 'نیمه' }, { progress_percent: 150 }, { stage_order: 0 }]) {
        const res = await api.put(stageUrl(manual.id, manual.stages[0].id), body);
        if (res.status !== 400 || JSON.stringify(res.body).includes('Failed query')) problems.push(`${brief(body)} answered ${res.status} ${brief(res.body)}, expected 400 without SQL text`);
      }
      const taken = await api.put(stageUrl(manual.id, manual.stages[1].id), { stage_order: 1 });
      if (taken.status !== 409 || taken.body?.code !== 'STAGE_ORDER_TAKEN') problems.push(`giving stage 2 the number 1 answered ${taken.status} ${brief(taken.body)}, expected 409 STAGE_ORDER_TAKEN`);
      const persian = await api.put(stageUrl(manual.id, manual.stages[2].id), { stage_order: '۸' });
      if (persian.status !== 200 || Number(persian.body?.stage_order ?? persian.body?.stageOrder) !== 8) problems.push(`a Persian-digit number answered ${persian.status} ${brief(persian.body)}, expected 200 with number 8`);

      const matrix = await newProject(api, { products: [{ itemId: item.id, qty: 1 }] });
      await tickAll(api, matrix.id, item.id, [2]);
      const moved = await api.put(stageUrl(matrix.id, matrix.stages[1].id), { stage_order: 7 });
      const view = await api.get(`/api/projects/${matrix.id}/product-progress`);
      const cell = (view.body?.data?.products?.[0]?.progress ?? []).find((c: Row) => Number(c.stage_order) === 7);
      if (moved.status !== 200 || cell?.status !== 'completed') problems.push(`renumbering the ticked stage to 7 answered ${moved.status} and left its cell ${brief(cell)}, expected the tick to follow`);
      assertNoProblems(problems);
      return 'invalid input 400; taken number 409; Persian digits read; ticks follow a renumbered stage';
    }));
  }

  return results;
}
