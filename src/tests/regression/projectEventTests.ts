import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * Series 10 phase 3, lane L3 (package 11): the events a project's stock paths publish. Through the real Express routes;
 * each case is red on the code before its fix.
 */
export async function runProjectEventTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_production_receipt_no_purchase_event_td_942',
      'v10.0.22: a project delivery records its production receipt without a purchase event (no PurchaseApproved with an empty supplier); its stock entry event stays (TD-942)',
      ['td942', 'p5-m09', 'events', 'projects', 'package11'], productionReceiptEventCase],
    ['reg_allocation_event_project_aggregate_td_944',
      'v10.0.23: the allocation event is recorded on the project (aggregate id = project id), so the project timeline shows it (TD-944)',
      ['td944', 'p5-m11', 'events', 'projects', 'allocation', 'package11'], allocationEventCase],
  ]);
}

/** A project with one finished-good product of `quantity` */
async function deliverableProject(h: Harness, f: Awaited<ReturnType<typeof fixture>>, product: number, quantity: number): Promise<number> {
  const res = await h.post('/api/projects', {
    title: `P3 events ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity,
    products: [{ item_id: product, item_code: '', item_name: '', quantity, unit: 'عدد' }],
  });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  return Number((res.body as { id?: unknown }).id);
}

/**
 * P5-M09 (TD-942): the production receipt of a project delivery published `PurchaseApproved` with `supplierName: ''`, so a
 * webhook or rule on purchases received every delivery as a purchase from nobody.
 */
async function productionReceiptEventCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const product = await f.item(0, 0);
  const projectId = await deliverableProject(h, f, product, 3);
  const delivered = await h.post(`/api/projects/${projectId}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 3, unitPrice: 200_000, location: f.wh }] });
  const documentId = Number((delivered.body as { documentId?: unknown })?.documentId);
  if (delivered.status !== 200 || !Number.isInteger(documentId)) throw new Error(`setup: the delivery answered ${brief(delivered)}`);
  const events = await h.q(`SELECT event_type, aggregate_type, payload FROM outbox_events WHERE aggregate_id = $1 OR payload->>'documentId' = $1`, [String(documentId)]);
  const purchase = events.filter(e => String(e.event_type).startsWith('Purchase'));
  if (purchase.length > 0) wrong.push(`the production receipt published ${purchase.map(e => `${e.event_type} supplierName=${JSON.stringify((e.payload as { supplierName?: unknown })?.supplierName)}`).join(', ')}, expected no purchase event`);
  const [stockIn] = await h.q(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'StockReceived' AND payload->>'itemId' = $1`, [String(product)]);
  if (Number(stockIn?.n) < 1) wrong.push('the delivery published no StockReceived event for the product');
  // a purchase receipt still publishes its purchase event
  const raw = await f.item(0, 100);
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: raw, quantity: 2, unit_price: 100, location: f.wh }]));
  const receiptId = Number((receipt.body as { docId?: unknown })?.docId);
  const [approved] = await h.q(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'PurchaseApproved' AND aggregate_id = $1`, [String(receiptId)]);
  if (receipt.status !== 200 || Number(approved?.n) !== 1) wrong.push(`a final purchase receipt answered ${brief(receipt)} with ${approved?.n} PurchaseApproved events, expected 200 and 1`);
  return 'the production receipt publishes StockReceived only; a purchase receipt still publishes PurchaseApproved';
}

/**
 * P5-M11 (TD-944): the allocation event used the allocation id as its aggregate id under the aggregate type «Project», so
 * the timeline of project N showed the events of allocation N instead of its own.
 */
async function allocationEventCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(10, 1_000);
  // a first project, so the project id and the allocation id differ in a fresh schema
  const other = await h.post('/api/projects', { title: `P3 other ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (other.status !== 201) throw new Error(`setup: project create answered ${brief(other)}`);
  const res = await h.post('/api/projects', { title: `P3 allocation ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [] });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  const projectId = Number((res.body as { id?: unknown }).id);
  const allocated = await h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId: material, quantity: 4, location: f.wh }] });
  const allocationId = Number((allocated.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
  if (allocated.status !== 200 || !Number.isInteger(allocationId)) throw new Error(`setup: the allocation answered ${brief(allocated)}`);
  const events = await h.q(`SELECT aggregate_type, aggregate_id FROM outbox_events WHERE (payload->>'allocationId')::int = $1`, [allocationId]);
  if (events.length === 0) wrong.push('the allocation recorded no event');
  for (const e of events) {
    if (e.aggregate_type !== 'Project' || e.aggregate_id !== String(projectId)) wrong.push(`the allocation event is on ${e.aggregate_type} ${e.aggregate_id}, expected Project ${projectId}`);
  }
  return 'the allocation event is recorded on its project';
}
