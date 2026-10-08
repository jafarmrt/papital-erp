import { createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';
import { brief, editProject, newProject, projectStatus, q } from './projectStageIntegrityTests.js';

/**
 * Package 11 (project control and production), PR «ج»: lists, purchase and material allocation — the project list,
 * the purchase document of the project page, the allocation warehouse and allocation to a closed project. Runs on
 * real Express routes and PostgreSQL in an isolated schema and is red on the version before each fix.
 */

const stockOf = async (itemId: number) => Number((await q('SELECT COALESCE(SUM(current_stock), 0) AS s FROM item_warehouse_stocks WHERE item_id = $1', [itemId]))[0]?.s);
const defaultWarehouse = async () => String((await q('SELECT code FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1'))[0]?.code);
const errorText = (body: { error?: unknown; message?: unknown } | undefined) => String(body?.error ?? body?.message ?? '');

export async function runProjectPurchaseAllocationTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const closedId = 'reg_project_allocation_closed_td_759';
  if (shouldRun(closedId, 'td759', 'projects', 'package11')) {
    await runCase(results, closedId, 'v9.0.386: materials are not allocated to a cancelled or completed project (422 PROJECT_CLOSED_FOR_ALLOCATION, no stock moved), releasing earlier allocations stays possible, and a project with an open allocation is not cancelled (TD-759)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const wh = await defaultWarehouse();
      const raw = await createTestItem({ type: 'raw_material' });
      const allocate = (projectId: number, quantity: number) => api.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId: raw.id, quantity, location: wh }] });
      const release = (allocationId: number) => api.post(`/api/inventory/allocations/${allocationId}/release`, { reason: 'TD-759' });
      const allocationCount = async (projectId: number) => Number((await q('SELECT count(*)::int AS n FROM project_bom_allocations WHERE project_id = $1 AND is_deleted = 0', [projectId]))[0]?.n);

      // an open allocation blocks cancelling, like deleting (TD-412)
      const open = await newProject(api, {});
      const first = await allocate(open.id, 4);
      const firstId = Number(first.body?.data?.allocations?.[0]?.id);
      if (first.status !== 200 || !Number.isInteger(firstId)) problems.push(`allocating to a planned project answered ${first.status} ${brief(first.body)}, expected 200`);
      const cancelOpen = await editProject(api, open.id, { status: 'cancelled' });
      if (cancelOpen.status !== 422 || !errorText(cancelOpen.body).includes('لغو نمی‌شود')) problems.push(`cancelling a project with an open allocation answered ${cancelOpen.status} ${brief(cancelOpen.body)}, expected 422`);
      if (await projectStatus(open.id) === 'cancelled') problems.push('the refused cancel still stored the cancelled status');
      if ((await release(firstId)).status !== 200) problems.push('releasing the open allocation failed');
      const cancelFree = await editProject(api, open.id, { status: 'cancelled' });
      if (cancelFree.status !== 200) problems.push(`cancelling after the release answered ${cancelFree.status} ${brief(cancelFree.body)}, expected 200`);

      // a cancelled project takes no material and moves no stock
      const stockBefore = await stockOf(raw.id);
      const toCancelled = await allocate(open.id, 4);
      if (toCancelled.status !== 422 || toCancelled.body?.code !== 'PROJECT_CLOSED_FOR_ALLOCATION') problems.push(`allocating to a cancelled project answered ${toCancelled.status} ${brief(toCancelled.body)}, expected 422 PROJECT_CLOSED_FOR_ALLOCATION`);
      if (await stockOf(raw.id) !== stockBefore) problems.push(`the refused allocation moved stock from ${stockBefore} to ${await stockOf(raw.id)}`);
      if (await allocationCount(open.id) !== 1) problems.push(`the cancelled project has ${await allocationCount(open.id)} allocation rows, expected only the released one`);

      // a completed project takes no new material, and its earlier allocation is still released
      const product = await createTestItem({ type: 'product' });
      const done = await newProject(api, { products: [{ itemId: product.id, qty: 1 }], stages: ['cut'] });
      const before = await allocate(done.id, 2);
      const beforeId = Number(before.body?.data?.allocations?.[0]?.id);
      if (before.status !== 200) problems.push(`allocating before completion answered ${before.status} ${brief(before.body)}`);
      await api.put(`/api/projects/${done.id}/product-progress`, { items: [{ item_id: product.id, stage_order: 1, status: 'completed' }] });
      if (await projectStatus(done.id) !== 'completed') problems.push(`the ticked project is ${await projectStatus(done.id)}, expected completed`);
      const toCompleted = await allocate(done.id, 1);
      if (toCompleted.status !== 422 || toCompleted.body?.code !== 'PROJECT_CLOSED_FOR_ALLOCATION') problems.push(`allocating to a completed project answered ${toCompleted.status} ${brief(toCompleted.body)}, expected 422 PROJECT_CLOSED_FOR_ALLOCATION`);
      const releaseDone = await release(beforeId);
      if (releaseDone.status !== 200) problems.push(`releasing an allocation of the completed project answered ${releaseDone.status} ${brief(releaseDone.body)}, expected 200`);
      assertNoProblems(problems);
      return 'closed projects take no material; earlier allocations release; an open allocation blocks the cancel';
    }));
  }

  return results;
}
