import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { PAGE_ACCESS } from '../../lib/permissions/pageAccess.js';
import { legacyRequisitionOrder } from '../invariants/workflowScenarioHelpers.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * Package 10 (purchasing and procurement), PR C: what the procurement desk reads, through the real Express routes with
 * real sessions. Each case reproduces a finding of the package 10 review and is red on the code before its fix.
 */
export async function runProcurementDeskTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_desk_reads_td_702',
      'v9.0.352: every API the procurement desk reads opens for each permission that opens the page (procurement.view, projects.view); the summary refused projects.view and emptied the desk (TD-702)',
      ['td702', 'procurement', 'permissions', 'security', 'package10'], deskReadsCase],
    ['reg_procurement_list_filters_td_697',
      'v9.0.353: the requisition list filters by the statuses it writes and their groups, searches item names, counts each requisition\'s orders in SQL and answers with the limit it used; the order list takes only its own status filters (TD-697)',
      ['td697', 'procurement', 'pagination', 'package10'], listFiltersCase],
    ['reg_procurement_messages_td_901',
      'v9.0.355: procurement errors name a workflow action by its Persian title, never its key, and a requisition row without a quantity gets its own Persian message on that field (TD-901)',
      ['td901', 'procurement', 'wording', 'package10'], messagesCase],
    ['reg_procurement_order_warehouse_name_td_1131',
      'v10.0.48: the procurement order list names the destination warehouse of an order and of each line next to its code; the delivery window showed the raw code (TD-1131)',
      ['td1131', 'procurement', 'wording', 'package10'], warehouseNameCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_api', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

/** v9.0.352 (TD-702, B10-15): a holder of either page key reads every desk API; a key that does not open the page reads none */
async function deskReadsCase(h: Harness, wrong: string[]): Promise<string> {
  const rule = PAGE_ACCESS['/procurement'];
  const keys = typeof rule.gate === 'object' ? rule.gate.anyOf : [];
  const reads = ['/api/procurement/inbox/summary', '/api/procurement/requisitions?page=1&limit=20', '/api/procurement/orders?page=1&limit=20'];
  if (!rule.api.includes('GET /api/procurement/inbox/summary')) wrong.push('the page access table does not list the desk summary among the desk APIs');
  for (const key of keys) {
    const session = await h.sessionWith([key]);
    for (const url of reads) {
      const res = await h.get(url, session);
      if (res.status !== 200) wrong.push(`${key}: GET ${url} answered ${res.status}`);
    }
  }
  const outsider = await h.sessionWith(['documents.view']);
  const summary = await h.get('/api/procurement/inbox/summary', outsider);
  if (summary.status !== 403) wrong.push(`documents.view (does not open the page): summary answered ${summary.status}`);
  return `${keys.join(' and ')} each read the summary, the requisitions and the orders; documents.view reads none`;
}

type ListBody = { data?: Array<Record<string, unknown>>; total?: number; limit?: number; page?: number };

/** v9.0.353 (TD-697, B10-10): status groups, item search, order counts and the limit actually used */
async function listFiltersCase(h: Harness, wrong: string[]): Promise<string> {
  const prefix = `P10L-${h.tag}-${Math.floor(Math.random() * 1e5)}`;
  const itemName = `فیروزه فهرست ${prefix}`;
  const rows = JSON.stringify([{ id: 'item-1', itemId: null, itemName, itemCode: `${prefix}-ITEM`, unit: 'عدد', requestedQty: 1, orderedQty: 0, remainingQty: 1 }]);
  // 105 requisitions of this case: more than the old service cap of 100
  await h.q(
    `INSERT INTO purchase_requisitions (code, title, status, priority, items)
     SELECT $1 || '-' || lpad(g::text, 3, '0'), 'فهرست آزمون', 'pending', 'normal', $2::jsonb FROM generate_series(1, 105) AS g`,
    [prefix, rows],
  );
  const statusOf: Record<string, string> = {
    '001': 'under_review', '002': 'manager_approval', '003': 'ordered', '004': 'approved', '005': 'received', '006': 'completed',
    '007': 'rejected', '008': 'cancelled', '009': 'consolidated',
  };
  for (const [serial, status] of Object.entries(statusOf)) {
    await h.q(`UPDATE purchase_requisitions SET status = $2, priority = 'urgent' WHERE code = $1`, [`${prefix}-${serial}`, status]);
  }
  const list = async (query: string): Promise<{ status: number; body: ListBody }> => {
    const res = await h.get(`/api/procurement/requisitions?search=${encodeURIComponent(prefix)}&${query}`);
    return { status: res.status, body: (res.body ?? {}) as ListBody };
  };
  const expectTotal = async (query: string, total: number) => {
    const res = await list(query);
    if (res.status !== 200) wrong.push(`${query}: answered ${res.status}`);
    else if (res.body.total !== total) wrong.push(`${query}: total ${res.body.total}, expected ${total}`);
  };
  await expectTotal('status=received', 2);
  await expectTotal('status=under_review', 1);
  await expectTotal('status=open', 98);
  await expectTotal('status=ordered', 2);
  await expectTotal('status=rejected', 2);
  await expectTotal('status=consolidated', 1);
  await expectTotal('priority=urgent', 9);
  await expectTotal('status=all&priority=all', 105);

  const page = await list('limit=200');
  if (page.body.data?.length !== 105 || page.body.limit !== 200) {
    wrong.push(`limit=200 returned ${page.body.data?.length} rows with limit ${page.body.limit} (total ${page.body.total})`);
  }
  const tooMany = await list('limit=500');
  if (tooMany.status !== 400) wrong.push(`limit=500 answered ${tooMany.status}`);

  const byItem = await h.get(`/api/procurement/requisitions?search=${encodeURIComponent(itemName)}`);
  if ((byItem.body as ListBody)?.total !== 105) wrong.push(`search by item name found ${(byItem.body as ListBody)?.total} requisitions`);

  const item = await createTestItem({ type: 'raw_material', code: `${prefix}-RM`, name: `مواد ${prefix}`, stocks: {}, weightedAverageCost: 0 } as never);
  const [ordered] = await h.q(`SELECT id FROM purchase_requisitions WHERE code = $1`, [`${prefix}-003`]);
  await legacyRequisitionOrder(Number(ordered.id), Number(item.id), 1);
  const withOrder = await list('status=ordered');
  const counted = withOrder.body.data?.find(row => row.code === `${prefix}-003`);
  if (counted?.ordersCount !== 1 || counted?.pendingDeliveryOrdersCount !== 1) {
    wrong.push(`ordered requisition carries ordersCount ${counted?.ordersCount} and pendingDeliveryOrdersCount ${counted?.pendingDeliveryOrdersCount}`);
  }

  const badOrderStatus = await h.get('/api/procurement/orders?status=whatever');
  if (badOrderStatus.status !== 400) wrong.push(`orders?status=whatever answered ${badOrderStatus.status}`);
  const orders = await h.get('/api/procurement/orders?status=pending_delivery&limit=200');
  if (orders.status !== 200 || (orders.body as ListBody)?.limit !== 200) wrong.push(`orders limit=200 answered ${orders.status} with limit ${(orders.body as ListBody)?.limit}`);
  return 'status groups (received, open, ordered, rejected, consolidated), priority urgent, item-name search, order counts and limit 200 over 105 requisitions';
}

type ErrorBody = { message?: string; details?: { issues?: Array<{ path?: string; message?: string }> } };

/** v9.0.355 (TD-901, decision t5): Persian workflow action names and a field-level message for a missing quantity */
async function messagesCase(h: Harness, wrong: string[]): Promise<string> {
  const missingQty = await h.post('/api/procurement/requisitions', { title: `پیام‌ها ${h.tag}`, items: [{ itemName: `کالای پیام ${h.tag}` }] });
  const qtyIssue = (missingQty.body as ErrorBody)?.details?.issues?.find(issue => issue.path === 'body.items.0.requestedQty');
  if (missingQty.status !== 400 || qtyIssue?.message !== 'مقدار درخواستی را وارد کنید') {
    wrong.push(`a row without a quantity answered ${missingQty.status} with "${qtyIssue?.message ?? (missingQty.body as ErrorBody)?.message}"`);
  }

  const created = await h.post('/api/procurement/requisitions', { title: `پیام‌ها ${h.tag}`, items: [{ itemName: `کالای پیام ${h.tag}`, requestedQty: 2 }] });
  const id = Number((created.body as { data?: { id?: unknown } })?.data?.id ?? 0);
  if (created.status !== 201 && created.status !== 200) wrong.push(`requisition create answered ${created.status}`);
  const action = await h.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'cancel_order' });
  const message = String((action.body as ErrorBody)?.message ?? '');
  if (action.status !== 409) wrong.push(`cancel_order on a pending requisition answered ${action.status}`);
  if (message.includes('cancel_order') || !message.includes('لغو یا رد سفارش')) wrong.push(`the refusal names the action as: ${message}`);
  return 'a missing quantity is reported on its field in Persian; a refused cancel_order names the action by its Persian title';
}

/** v10.0.48 (TD-1131): the order list carries the warehouse name the delivery window and the order list show */
async function warehouseNameCase(h: Harness, wrong: string[]): Promise<string> {
  const prefix = `P10W-${h.tag}-${Math.floor(Math.random() * 1e5)}`;
  const [req] = await h.q(
    `INSERT INTO purchase_requisitions (code, title, status, priority, items)
     VALUES ($1, 'انبار سفارش', 'ordered', 'normal', $2::jsonb) RETURNING id`,
    [prefix, JSON.stringify([{ id: 'item-1', itemId: null, itemName: `کالا ${prefix}`, unit: 'عدد', requestedQty: 1, orderedQty: 0, remainingQty: 1 }])],
  );
  const item = await createTestItem({ type: 'raw_material', code: `${prefix}-RM`, name: `مواد ${prefix}`, stocks: {}, weightedAverageCost: 0 } as never);
  await legacyRequisitionOrder(Number(req.id), Number(item.id), 1);
  const [wh] = await h.q(`SELECT code, name FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1`);
  const listed = await h.get(`/api/procurement/orders?requisitionId=${Number(req.id)}`);
  const order = ((listed.body as ListBody)?.data ?? [])[0] as { location?: string; locationName?: string; items?: Array<{ locationName?: string }> } | undefined;
  if (listed.status !== 200 || !order) wrong.push(`order list answered ${listed.status} without the order`);
  if (order?.location !== wh.code) wrong.push(`order location ${String(order?.location)}, expected the code ${String(wh.code)}`);
  if (order?.locationName !== wh.name) wrong.push(`order locationName ${String(order?.locationName)}, expected ${String(wh.name)}`);
  if (order?.items?.[0]?.locationName !== wh.name) wrong.push(`line locationName ${String(order?.items?.[0]?.locationName)}, expected ${String(wh.name)}`);
  return 'the order and its line carry the destination warehouse name next to its code';
}
