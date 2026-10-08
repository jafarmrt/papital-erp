import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

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

  return results;
}
