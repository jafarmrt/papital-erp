import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { type Client, type Row, brief, editProject, newProject, q } from './projectStageIntegrityTests.js';

/**
 * Closing sweep, project observations of package 11 (OBS-R2-43, OBS-R2-44): each test is red on the version before
 * its fix. Real Express routes and PostgreSQL in an isolated schema.
 */

/** POST /api/projects with a customer part; the raw answer, so a refusal can be checked */
async function postProject(api: Client, customer: Row) {
  const today = await businessTodayIsoDate();
  return api.post('/api/projects', {
    title: `OBS-R2-43 ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, start_date: today, end_date: today, quantity: 1,
    initial_stages: [{ title: 'برش' }], ...customer,
  });
}

const refusedAsInvalidCustomer = (res: { status: number; body?: { code?: unknown } }) =>
  res.status === 422 && res.body?.code === 'PROJECT_CUSTOMER_INVALID';

const projectRow = async (id: number) =>
  (await q('SELECT customer_id, customer_name FROM production_projects WHERE id = $1', [id]))[0] ?? {};

export async function runProjectSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const customerId = 'reg_project_customer_link_obs_r2_43';
  if (shouldRun(customerId, 'obs-r2-43', 'projects', 'customer')) {
    await runCase(results, customerId, 'closing sweep: a project links only a live customer, whose current name it stores; an unknown or deleted customer is 422 PROJECT_CUSTOMER_INVALID (OBS-R2-43)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const live = await createTestCustomer();
      const other = await createTestCustomer();
      const deleted = await createTestCustomer();
      await q('UPDATE customers SET is_deleted = 1 WHERE id = $1', [deleted.id]);

      const linkedRes = await postProject(api, { customer_id: live.id, customer_name: 'Another typed name' });
      if (linkedRes.status !== 201) throw new Error(`creating a project for a live customer answered ${linkedRes.status} ${brief(linkedRes.body)}`);
      const linked = linkedRes.body as { id: number };
      const linkedRow = await projectRow(linked.id);
      if (Number(linkedRow.customer_id) !== live.id || linkedRow.customer_name !== live.name) {
        problems.push(`a project linked to customer ${live.id} stored ${brief(linkedRow)}, expected that id with the customer's own name`);
      }

      const unknown = await postProject(api, { customer_id: 987654321, customer_name: 'Ghost' });
      if (!refusedAsInvalidCustomer(unknown)) {
        problems.push(`a project with an unknown customer id answered ${unknown.status} ${brief(unknown.body)}, expected 422 PROJECT_CUSTOMER_INVALID`);
      }
      const gone = await postProject(api, { customer_id: deleted.id, customer_name: deleted.name });
      if (!refusedAsInvalidCustomer(gone)) {
        problems.push(`a project with a deleted customer answered ${gone.status} ${brief(gone.body)}, expected 422 PROJECT_CUSTOMER_INVALID`);
      }

      const toDeleted = await editProject(api, linked.id, { customer_id: deleted.id, customer_name: deleted.name });
      if (!refusedAsInvalidCustomer(toDeleted)) {
        problems.push(`moving a project to a deleted customer answered ${toDeleted.status} ${brief(toDeleted.body)}, expected 422 PROJECT_CUSTOMER_INVALID`);
      }
      const toOther = await editProject(api, linked.id, { customer_id: other.id, customer_name: 'Typed over the picker' });
      const otherRow = await projectRow(linked.id);
      if (toOther.status !== 200 || Number(otherRow.customer_id) !== other.id || otherRow.customer_name !== other.name) {
        problems.push(`moving a project to customer ${other.id} answered ${toOther.status} and stored ${brief(otherRow)}, expected that customer's own name`);
      }

      // a project keeps the party it already holds after that party was deleted, so its edit is not refused
      await q('UPDATE customers SET is_deleted = 1 WHERE id = $1', [other.id]);
      const keep = await editProject(api, linked.id, { customer_id: other.id, customer_name: other.name, description: 'kept link' });
      if (keep.status !== 200) problems.push(`editing a project whose own customer was deleted since answered ${keep.status} ${brief(keep.body)}, expected 200`);

      const freeRes = await postProject(api, { customer_name: 'Walk-in buyer' });
      if (freeRes.status !== 201) throw new Error(`creating a project without a customer id answered ${freeRes.status} ${brief(freeRes.body)}`);
      const free = freeRes.body as { id: number };
      const freeRow = await projectRow(free.id);
      if (freeRow.customer_id !== null || freeRow.customer_name !== 'Walk-in buyer') {
        problems.push(`a project without a customer id stored ${brief(freeRow)}, expected no id and the typed name`);
      }
      assertNoProblems(problems);
      return 'live customer linked with its own name; unknown and deleted customers refused with 422; free-text name kept';
    }));
  }

  const progressId = 'reg_project_delete_progress_rows_obs_r2_44';
  if (shouldRun(progressId, 'obs-r2-44', 'projects', 'delete', 'progress')) {
    await runCase(results, progressId, 'closing sweep: deleting a project soft-deletes its progress matrix rows in the same transaction (OBS-R2-44)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const item = await createTestItem({ type: 'product' });
      const project = await newProject(api, { products: [{ itemId: item.id, qty: 2 }], stages: ['برش', 'مونتاژ'] });
      const tick = await api.put(`/api/projects/${project.id}/product-progress`, { items: [{ item_id: item.id, stage_order: 1, status: 'completed' }] });
      if (tick.status !== 200) problems.push(`ticking a cell answered ${tick.status} ${brief(tick.body)}`);
      const before = await q('SELECT count(*)::int AS n FROM project_product_stage_progress WHERE project_id = $1 AND is_deleted = 0', [project.id]);
      if (Number(before[0]?.n) < 1) problems.push('the tick wrote no live progress row');

      const del = await api.del(`/api/projects/${project.id}`);
      if (del.status !== 200) problems.push(`deleting the project answered ${del.status} ${brief(del.body)}`);
      const live = await q('SELECT count(*)::int AS n FROM project_product_stage_progress WHERE project_id = $1 AND is_deleted = 0', [project.id]);
      if (Number(live[0]?.n) !== 0) problems.push(`${String(live[0]?.n)} progress rows of the deleted project are still live, expected none`);
      assertNoProblems(problems);
      return 'the deleted project left no live progress row';
    }));
  }

  return results;
}
