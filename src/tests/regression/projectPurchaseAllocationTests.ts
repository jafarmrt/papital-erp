import { PROJECT_LIST_ROW_FIELDS, PROJECT_LIST_STAGE_FIELDS } from '../../lib/projects/projectList.js';
import { createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { type Row, brief, editProject, newProject, projectStatus, q } from './projectStageIntegrityTests.js';

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
    await runCase(results, closedId, 'v9.0.410: materials are not allocated to a cancelled or completed project (422 PROJECT_CLOSED_FOR_ALLOCATION, no stock moved), releasing earlier allocations stays possible, and a project with an open allocation is not cancelled (TD-759)', async () => inFiscalSandbox(async () => {
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

  const listId = 'reg_project_list_paged_td_743';
  if (shouldRun(listId, 'td743', 'projects', 'package11')) {
    await runCase(results, listId, 'v9.0.412: GET /projects answers one summary page {data, total, page, limit, statusCounts} filtered in SQL by search, status and priority; a row carries only the summary fields and its stages, never the inventory control, schedule, description or attachments (TD-743)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const tag = `TD743-${Date.now().toString(36)}`;
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) ids.push((await newProject(api, { stages: ['cut', 'assemble'] })).id);
      const heavy = JSON.stringify({ reservedItems: Array.from({ length: 200 }, (_, i) => ({ itemId: i + 1, qty: 1, note: 'x'.repeat(40) })) });
      const attachments = JSON.stringify([{ id: 'a1', name: 'a.pdf', url: '/api/attachments/1' }, { id: 'a2', name: 'b.pdf', url: '/api/attachments/2' }]);
      const setProject = (id: number, title: string, customer: string, itemCode: string, status: string, priority: string) => q(
        `UPDATE production_projects SET title = $2, customer_name = $3, item_code = $4, status = $5, priority = $6, inventory_control = $7::jsonb,
           stage_schedules = $7::jsonb, description = $8, attachments = $9::jsonb WHERE id = $1`,
        [id, title, customer, itemCode, status, priority, heavy, 'y'.repeat(2000), attachments],
      );
      await setProject(ids[0], `${tag} first`, 'customer one', 'SKU-1', 'in_progress', 'urgent');
      await setProject(ids[1], `${tag} second`, 'customer two', 'SKU-2', 'planned', 'medium');
      await setProject(ids[2], 'other title', `${tag} customer`, `${tag}-SKU`, 'planned', 'urgent');
      await q(`UPDATE project_stages SET status = 'completed', progress_percent = 100
               WHERE id = (SELECT id FROM project_stages WHERE project_id = $1 AND is_deleted = 0 ORDER BY stage_order LIMIT 1)`, [ids[0]]);

      type Page = { data?: Row[]; total?: number; page?: number; limit?: number; statusCounts?: Record<string, number> };
      const list = async (params: string) => {
        const res = await api.get(`/api/projects?${params}`);
        return { status: res.status, body: (res.body ?? {}) as Page };
      };
      const idsOf = (body: Page) => (Array.isArray(body.data) ? body.data : []).map(r => Number(r.id));
      const counts = (body: Page) => JSON.stringify(Object.entries(body.statusCounts ?? {}).sort());
      const search = `search=${encodeURIComponent(tag)}`;

      // paging over the three projects of the search: 2 + 1 distinct rows, the counts of the whole search on each page
      const first = await list(`${search}&limit=2&page=1`);
      const second = await list(`${search}&limit=2&page=2`);
      if (first.status !== 200 || idsOf(first.body).length !== 2 || first.body.total !== 3 || first.body.page !== 1 || first.body.limit !== 2) {
        problems.push(`page 1 of 2 answered ${first.status} with ${idsOf(first.body).length} rows ${brief({ ...first.body, data: undefined })}, expected 2 rows of total 3`);
      }
      if (second.status !== 200 || idsOf(second.body).length !== 1 || second.body.page !== 2) problems.push(`page 2 answered ${second.status} with ${idsOf(second.body).length} rows, expected 1`);
      const paged = [...idsOf(first.body), ...idsOf(second.body)].sort((a, b) => a - b);
      if (JSON.stringify(paged) !== JSON.stringify([...ids].sort((a, b) => a - b))) problems.push(`the two pages hold ${paged.join(',')}, expected ${ids.join(',')}`);
      if (counts(first.body) !== JSON.stringify([['in_progress', 1], ['planned', 2]])) problems.push(`status counts of the search are ${counts(first.body)}`);

      // a row is the summary only
      const row = (first.body.data ?? []).concat(second.body.data ?? []).find(r => Number(r.id) === ids[0]);
      const extra = Object.keys(row ?? {}).filter(k => !(PROJECT_LIST_ROW_FIELDS as readonly string[]).includes(k));
      const missing = PROJECT_LIST_ROW_FIELDS.filter(k => !(k in (row ?? {})));
      if (!row || extra.length > 0 || missing.length > 0) problems.push(`the list row carries ${extra.join(', ') || '-'} and lacks ${missing.join(', ') || '-'}`);
      const stages = Array.isArray(row?.stages) ? row.stages as Row[] : [];
      const stageExtra = stages.flatMap(st => Object.keys(st).filter(k => !(PROJECT_LIST_STAGE_FIELDS as readonly string[]).includes(k)));
      if (stages.length !== 2 || stageExtra.length > 0) problems.push(`the row has ${stages.length} stages with extra keys ${stageExtra.join(', ') || '-'}, expected 2 summary stages`);
      if (row && (row.progress_percent !== 50 || row.completed_stages !== 1 || row.total_stages !== 2 || row.attachments_count !== 2 || row.status !== 'in_progress' || row.priority !== 'urgent')) {
        problems.push(`the row summary is ${brief({ ...row, stages: undefined })}, expected progress 50, 1 of 2 stages, 2 attachments`);
      }
      if (row && JSON.stringify(row).length > 1500) problems.push(`the list row is ${JSON.stringify(row).length} characters long`);

      // filters run in SQL, and the status counts ignore only the status filter
      const running = await list(`${search}&status=in_progress`);
      if (JSON.stringify(idsOf(running.body)) !== JSON.stringify([ids[0]]) || running.body.total !== 1 || counts(running.body) !== counts(first.body)) {
        problems.push(`status=in_progress gave ${idsOf(running.body).join(',')} of total ${running.body.total} with counts ${counts(running.body)}`);
      }
      const urgent = await list(`${search}&priority=urgent`);
      if (JSON.stringify(idsOf(urgent.body).sort((a, b) => a - b)) !== JSON.stringify([ids[0], ids[2]].sort((a, b) => a - b)) || counts(urgent.body) !== JSON.stringify([['in_progress', 1], ['planned', 1]])) {
        problems.push(`priority=urgent gave ${idsOf(urgent.body).join(',')} with counts ${counts(urgent.body)}`);
      }
      const bySku = await list(`search=${encodeURIComponent(`${tag}-sku`)}`);
      if (JSON.stringify(idsOf(bySku.body)) !== JSON.stringify([ids[2]])) problems.push(`searching the item code gave ${idsOf(bySku.body).join(',') || 'nothing'}`);

      const defaults = await list('');
      if (defaults.status !== 200 || defaults.body.limit !== 50 || defaults.body.page !== 1 || idsOf(defaults.body).length > 50) problems.push(`the list without paging answered ${defaults.status} ${brief({ ...defaults.body, data: undefined })}, expected page 1 of 50`);
      for (const bad of ['status=unknown', 'priority=critical', 'limit=500', 'page=0']) {
        const res = await list(bad);
        if (res.status !== 400) problems.push(`${bad} answered ${res.status}, expected 400`);
      }
      assertNoProblems(problems);
      return 'one summary page with SQL filters, counts of the other filters and summary stages; malformed filters 400';
    }));
  }

  const presetId = 'reg_project_preset_sections_td_748';
  if (shouldRun(presetId, 'td748', 'projects', 'package11')) {
    await runCase(results, presetId, 'v9.0.413: inventory control sections in the preset shape (materials in items) are stored as project rows, per product for a code-by-code check and global otherwise, and finalizing reserves their materials (TD-748)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const held = await createTestItem({ type: 'raw_material', currentStock: 30 });
      const missing = await createTestItem({ type: 'raw_material', currentStock: 0 });
      const product = await createTestItem({ type: 'product' });
      const project = await newProject(api, { products: [{ itemId: product.id, qty: 2 }] });
      const sections = [
        { id: 'secCode', title: 'کد به کد', checkType: 'per_item', items: [{ id: 'm_held', name: held.name, itemCode: held.code, unit: 'عدد' }] },
        { id: 'secAll', title: 'کلی', checkType: 'global', items: [{ id: 'm_missing', name: missing.name, itemCode: missing.code, unit: 'عدد' }, { id: 'm_held2', name: held.name, itemCode: held.code, unit: 'عدد' }] },
      ];
      const res = await editProject(api, project.id, { inventory_control: { sections, isFinalized: true } });
      if (res.status !== 200) problems.push(`finalizing with preset sections answered ${res.status} ${brief(res.body)}, expected 200`);
      const stored = (await q('SELECT inventory_control FROM production_projects WHERE id = $1', [project.id]))[0]?.inventory_control as Row | undefined;
      const [perItem, global] = (Array.isArray(stored?.sections) ? stored.sections : []) as Row[];
      if (!perItem || 'items' in perItem || 'items' in (global ?? {})) problems.push(`the stored sections still keep their materials in items: ${brief(stored?.sections)}`);
      const productRows = (perItem?.perItemResults as Record<string, Record<string, Row>> | undefined)?.[`prod_${product.id}`];
      const heldRow = productRows?.m_held;
      if (heldRow?.name !== held.name || Number(heldRow?.requiredQty) !== 1 || heldRow?.status !== 'available' || Number(heldRow?.stockQty) !== 30) {
        problems.push(`the code-by-code row of the product is ${brief(heldRow ?? productRows ?? perItem?.perItemResults)}, expected the held material, required 1, stock 30, available`);
      }
      const globalRows = (Array.isArray(global?.globalItems) ? global.globalItems : []) as Row[];
      const missingRow = globalRows.find(row => row.itemCode === missing.code);
      if (globalRows.length !== 2 || missingRow?.status !== 'needs_procurement' || Number(missingRow?.requiredQty) !== 1) problems.push(`the global rows are ${brief(globalRows)}, expected two rows with the missing material to procure`);
      const reserved = (Array.isArray(stored?.reservedItems) ? stored.reservedItems : []) as Row[];
      const heldReserved = reserved.filter(row => Number(row.itemId) === held.id).reduce((sum, row) => sum + Number(row.reservedQty), 0);
      if (heldReserved !== 2 || reserved.some(row => Number(row.itemId) === missing.id)) problems.push(`the reservation is ${brief(reserved)}, expected 2 of the held material (one per product and one global) and nothing of the missing one`);
      assertNoProblems(problems);
      return 'preset sections stored as project rows with stock status; finalizing reserves their materials';
    }));
  }

  const costId = 'reg_project_material_cost_td_1210';
  if (shouldRun(costId, 'td1210', 'projects', 'package11')) {
    await runCase(results, costId, 'v10.0.90: the project allocation list carries each allocation cost at its Kardex outflow, equal to its work-in-progress voucher, only for item cost readers (TD-1210)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const wh = await defaultWarehouse();
      const raw = await createTestItem({ type: 'raw_material' });
      const project = await newProject(api, {});
      const allocated = await api.post('/api/inventory/allocations/allocate', { projectId: project.id, allocations: [{ itemId: raw.id, quantity: 3, location: wh }] });
      const allocationId = Number(allocated.body?.data?.allocations?.[0]?.id);
      if (allocated.status !== 200 || !Number.isInteger(allocationId)) throw new Error(`allocating answered ${allocated.status} ${brief(allocated.body)}`);
      const voucher = Number((await q(`SELECT COALESCE(SUM(i.debit), 0)::text AS d FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
        WHERE v.source_bom_allocation_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0`, [allocationId]))[0]?.d);
      if (!(voucher > 0)) problems.push(`the allocation voucher debit is ${voucher}, expected above zero`);
      const list = await api.get(`/api/inventory/allocations?projectId=${project.id}`);
      const row = (list.body?.allocations ?? list.body?.data?.allocations ?? [])[0] as Row | undefined;
      if (list.status !== 200 || Number(row?.cost) !== voucher) problems.push(`the admin list answered ${list.status} with cost ${brief(row?.cost)}, expected the voucher amount ${voucher}`);
      const viewer = await sandboxClientWith(['projects.view']);
      const viewed = await viewer.get(`/api/inventory/allocations?projectId=${project.id}`);
      const viewedRow = (viewed.body?.allocations ?? viewed.body?.data?.allocations ?? [])[0] as Row | undefined;
      if (viewed.status !== 200 || !viewedRow || 'cost' in viewedRow) problems.push(`a projects.view reader got ${viewed.status} ${brief(viewedRow)}, expected the row without its cost`);
      const keeper = await sandboxClientWith(['warehouse.in', 'projects.view']);
      const kept = await keeper.get(`/api/inventory/allocations?projectId=${project.id}`);
      const keptRow = (kept.body?.allocations ?? kept.body?.data?.allocations ?? [])[0] as Row | undefined;
      if (Number(keptRow?.cost) !== voucher) problems.push(`a warehouse.in reader got cost ${brief(keptRow?.cost)}, expected ${voucher}`);
      assertNoProblems(problems);
      return 'allocation cost equals its voucher and is shown only to item cost readers';
    }));
  }

  return results;
}
