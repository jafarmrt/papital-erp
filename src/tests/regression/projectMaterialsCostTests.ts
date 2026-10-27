import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture, type Fixture } from './documentEntryTests.js';
import { createProject, globalSection, postDoc, runReservationCases } from './stockReservationTests.js';

/**
 * Series 10.2 package 3 (v10.2.3, TD-1290): the material and cost readers of a production project, through the real
 * Express routes with real sessions. Each case is red on the code before the change (the routes did not exist).
 */
export async function runProjectMaterialsCostTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_material_availability_td_1290',
      'v10.2.3: the free stock of a project material is total stock minus the reservations of sales proformas and other projects, never its own; the row status follows the finalize rule; an id beyond the integer range is 400 (TD-1290)',
      ['td1290', 'd1', 'projects', 'reservation', 'package3'], availabilityCase],
    ['reg_project_delivery_cost_td_1290',
      'v10.2.3: the delivery tab reads the project work-in-progress balance, planned and delivered quantities; balance and cost only for item cost readers (TD-1290)',
      ['td1290', 'd2', 'projects', 'delivery', 'wip', 'package3'], deliveryCostCase],
    ['reg_project_issued_materials_td_1290',
      'v10.2.3: the materials taken from stock list live allocations and final remittances and waste of the project, with Kardex cost only for item cost readers (TD-1290)',
      ['td1290', 'd3', 'projects', 'allocation', 'package3'], issuedMaterialsCase],
  ]);
}

interface AvailabilityBody { projectId?: number; items?: Array<{ itemId: number; stock: number; reservedByOthers: number; issuedToProject: number; freeForProject: number }> }

async function itemRow(h: Harness, itemId: number) {
  const [it] = await h.q(`SELECT id, code, name, unit, current_stock::float8 AS stock FROM items WHERE id = $1`, [itemId]);
  return { id: Number(it.id), code: String(it.code), name: String(it.name), unit: String(it.unit || 'عدد'), stock: Number(it.stock) };
}

async function putProject(h: Harness, projectId: number, body: Record<string, unknown>) {
  const [row] = await h.q('SELECT version FROM production_projects WHERE id = $1', [projectId]);
  return h.put(`/api/projects/${projectId}`, { ...body, version: Number(row?.version) });
}

/** Counts of the rows a reader must never write */
async function writeCounts(h: Harness): Promise<string> {
  const [row] = await h.q(`SELECT
    (SELECT count(*) FROM journal_vouchers) AS v, (SELECT count(*) FROM journal_voucher_items) AS vi,
    (SELECT count(*) FROM documents) AS d, (SELECT count(*) FROM transactions) AS t,
    (SELECT count(*) FROM activity_logs) AS a, (SELECT count(*) FROM outbox_events) AS o`);
  return JSON.stringify(row);
}

/**
 * D1 of the production projects review: the materials tab compared need with total stock, so a row said «موجود» while the
 * finalize reserved less, because a sales proforma and another project held part of the stock.
 */
async function availabilityCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const row = await itemRow(h, a);
  const section = (qty: number) => globalSection([{ itemCode: row.code, name: row.name, unit: row.unit, requiredQty: qty }]);

  // a sales proforma of 4 and another finalized project needing 3 hold 7 of the 10
  const proforma = await postDoc(h, f, 'invoice', 'proforma', a, 4);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);
  const other = await createProject(h, { sections: section(3), manualPurchaseItems: [], isFinalized: false });
  const otherFin = await putProject(h, other, { inventory_control: { sections: section(3), manualPurchaseItems: [], isFinalized: true } });
  if (otherFin.status !== 200) throw new Error(`setup: finalizing the other project answered ${brief(otherFin)}`);

  // the project needs 5 and already took 2 with its own remittance
  const project = await createProject(h, { sections: section(5), manualPurchaseItems: [], isFinalized: false });
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 2, unit_price: 0, location: f.wh }], { projectId: project }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance answered ${brief(rem)}`);

  const res = await h.get(`/api/projects/${project}/material-availability?itemIds=${a},999999999`);
  const body = res.body as AvailabilityBody;
  const figures = body.items?.find(i => Number(i.itemId) === a);
  if (res.status !== 200) wrong.push(`the availability answered ${brief(res)}, expected 200`);
  else if (!figures || figures.stock !== 8 || figures.reservedByOthers !== 7 || figures.issuedToProject !== 2 || figures.freeForProject !== 1) {
    wrong.push(`stock 8 with a proforma of 4 and another project's 3 and 2 issued to this project gives ${JSON.stringify(body.items)}, expected stock 8, others 7, issued 2, free 1`);
  }
  if ((body.items ?? []).some(i => Number(i.itemId) === 999999999)) wrong.push('an item id that does not exist came back in the availability');

  // the browser's row status from these figures is the finalize's: need 5 − issued 2 = 3, free 1, short 2
  const { buildMaterialAvailabilityView } = await import('../../lib/projects/materialAvailability.js');
  const view = buildMaterialAvailabilityView({
    sections: section(5), products: [], manualPurchaseItems: [],
    stockItems: [{ id: a, code: row.code, name: row.name, unit: row.unit, current_stock: 8 }],
    report: { projectId: project, items: body.items ?? [] }, status: 'ready',
  });
  const state = view.rowState({ itemCode: row.code, name: row.name, unit: row.unit });
  if (state.kind !== 'short' || state.shortQty !== 2 || state.free !== 1 || state.issued !== 2) {
    wrong.push(`the row status is ${JSON.stringify(state)}, expected short by 2 with free 1 and issued 2 (the old rule, need 5 against stock 8, said available)`);
  }

  // finalizing reserves the same free unit and stores the same shortage; the project's own reservation never counts as others'
  const fin = await putProject(h, project, { inventory_control: { sections: section(5), manualPurchaseItems: [], isFinalized: true } });
  const shortages = ((fin.body as { inventory_control?: { reservationShortages?: Array<{ itemId: number; shortQty: number }> } })?.inventory_control?.reservationShortages) ?? [];
  if (fin.status !== 200 || shortages.length !== 1 || shortages[0].shortQty !== 2) wrong.push(`finalizing answered ${brief(fin)}, expected 200 with a shortage of 2`);
  const after = await h.get(`/api/projects/${project}/material-availability?itemIds=${a}`);
  const afterFigures = (after.body as AvailabilityBody).items?.[0];
  if (afterFigures?.reservedByOthers !== 7 || afterFigures?.freeForProject !== 1) {
    wrong.push(`after finalizing, the project's figures are ${JSON.stringify(afterFigures)}, expected others 7 and free 1 (its own reservation of 1 not counted)`);
  }
  const otherView = await h.get(`/api/projects/${other}/material-availability?itemIds=${a}`);
  const otherFigures = (otherView.body as AvailabilityBody).items?.[0];
  if (otherFigures?.reservedByOthers !== 5) wrong.push(`the other project sees ${JSON.stringify(otherFigures)}, expected others 5 (proforma 4 + this project's 1)`);

  // access and input: a pick-list reader of another section is refused, a warehouse reader reads, bad input is 400, a missing project 404
  const outsider = await h.sessionWith(['documents.view']);
  const refused = await h.get(`/api/projects/${project}/material-availability?itemIds=${a}`, outsider);
  if (refused.status !== 403) wrong.push(`a reader with documents.view only answered ${refused.status}, expected 403`);
  const keeper = await h.sessionWith(['warehouse.view']);
  const kept = await h.get(`/api/projects/${project}/material-availability?itemIds=${a}`, keeper);
  if (kept.status !== 200) wrong.push(`a reader with warehouse.view answered ${brief(kept)}, expected 200`);
  const bad = await h.get(`/api/projects/${project}/material-availability?itemIds=1,abc`);
  if (bad.status !== 400) wrong.push(`itemIds «1,abc» answered ${bad.status}, expected 400`);
  // review of package 3: an id beyond the PostgreSQL integer range was a database error (500), now 400
  const huge = await h.get(`/api/projects/${project}/material-availability?itemIds=${a},99999999999`);
  if (huge.status !== 400) wrong.push(`an item id beyond the integer range answered ${huge.status}, expected 400`);
  const hugeProject = await h.get('/api/projects/99999999999/delivery-cost');
  if (hugeProject.status !== 400) wrong.push(`a project id beyond the integer range answered ${hugeProject.status}, expected 400`);
  const missing = await h.get(`/api/projects/999999999/material-availability?itemIds=${a}`);
  if (missing.status !== 404) wrong.push(`a missing project answered ${missing.status}, expected 404`);
  const none = await h.get(`/api/projects/${project}/material-availability`);
  if (none.status !== 200 || ((none.body as AvailabilityBody).items ?? []).length !== 0) wrong.push(`no item ids answered ${brief(none)}, expected 200 with no items`);
  const settled = await writeCounts(h);
  await h.get(`/api/projects/${project}/material-availability?itemIds=${a}`);
  if ((await writeCounts(h)) !== settled) wrong.push('reading the availability wrote a voucher, document, Kardex, audit or outbox row');
  return 'stock 8 with a proforma of 4, another project of 3 and 2 issued: free 1, the row is short by 2 as the finalize stores; the own reservation is not counted; 403 / 400 (an id beyond the integer range too) / 404; nothing written';
}

async function deliverableProject(h: Harness, f: Fixture, product: number, quantity: number): Promise<number> {
  const res = await h.post('/api/projects', {
    title: `P3 cost ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity,
    products: [{ item_id: product, item_code: '', item_name: '', quantity, unit: 'عدد' }],
  });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  return Number((res.body as { id?: unknown }).id);
}

interface DeliveryCostBody { costVisible?: boolean; wipBalance?: number | null; products?: Array<{ itemId: number; plannedQty: number; deliveredQty: number; weightedAverageCost: number | null }> }

/**
 * D2 of the review: the unit cost of a production receipt was typed by hand with no sight of the project's work in
 * progress (1402), so a receipt that did not match left a balance there.
 */
async function deliveryCostCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const product = await f.item(0, 0);
  const project = await deliverableProject(h, f, product, 10);

  const allocated = await h.post('/api/inventory/allocations/allocate', { projectId: project, allocations: [{ itemId: material, quantity: 5, location: f.wh }] });
  if (allocated.status !== 200) throw new Error(`setup: the allocation answered ${brief(allocated)}`);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: material, quantity: 3, unit_price: 0, location: f.wh }], { projectId: project }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance answered ${brief(rem)}`);

  // v11 phase 6.1ث: the server prices the receipt with the same rule the tab reads the report with
  const { planDeliveryCost } = await import('../../lib/projects/deliveryCostPlan.js');
  const unitCostFor = (b: DeliveryCostBody, p: { plannedQty: number; deliveredQty: number } | undefined, quantity: number) => Number(planDeliveryCost(
    b.wipBalance, [{ itemId: product, plannedQty: p?.plannedQty ?? 0, deliveredQty: p?.deliveredQty ?? 0 }],
    [{ itemId: product, quantity, typedUnitCost: null, weightedAverageCost: 0 }],
  ).unitCosts[0]);
  const first = await h.get(`/api/projects/${project}/delivery-cost`);
  const b1 = first.body as DeliveryCostBody;
  const p1 = b1.products?.find(p => Number(p.itemId) === product);
  if (first.status !== 200 || b1.costVisible !== true || b1.wipBalance !== 8_000 || p1?.plannedQty !== 10 || p1?.deliveredQty !== 0) {
    wrong.push(`before delivery the cost answered ${brief(first)}, expected the balance 8,000 (allocation 5,000 + remittance 3,000, drafts counted), planned 10, delivered 0`);
  }
  const suggested = unitCostFor(b1, p1, 4);
  if (suggested !== 800) wrong.push(`the real unit cost for 4 of 10 is ${suggested}, expected 800 (8,000 ÷ 10 still to deliver)`);

  // a typed cost equal to the real one needs no reason: 4 × 800 leaves 4,800 in the project's 1402
  const delivered = await h.post(`/api/projects/${project}/add-to-inventory`, { itemsToAdd: [{ itemId: product, quantity: 4, unitPrice: 800, location: f.wh }] });
  if (delivered.status !== 200) throw new Error(`setup: the delivery answered ${brief(delivered)}`);
  const second = await h.get(`/api/projects/${project}/delivery-cost`);
  const b2 = second.body as DeliveryCostBody;
  const p2 = b2.products?.find(p => Number(p.itemId) === product);
  if (b2.wipBalance !== 4_800 || p2?.deliveredQty !== 4 || p2?.weightedAverageCost !== 800) {
    wrong.push(`after delivering 4 at 800 the cost answered ${brief(second)}, expected the balance 4,800, delivered 4 and the product's cost 800`);
  }
  if (unitCostFor(b2, p2, 6) !== 800) wrong.push('the real unit cost of the last 6 is not 800, so the last delivery would not close the balance');

  // a project reader without an item cost key gets the quantities only
  const viewer = await h.sessionWith(['projects.view']);
  const plain = await h.get(`/api/projects/${project}/delivery-cost`, viewer);
  const b3 = plain.body as DeliveryCostBody;
  if (plain.status !== 200 || b3.costVisible !== false || b3.wipBalance !== null || b3.products?.[0]?.weightedAverageCost !== null || b3.products?.[0]?.plannedQty !== 10) {
    wrong.push(`a reader with projects.view only got ${brief(plain)}, expected quantities without the balance or the cost`);
  }
  const missing = await h.get('/api/projects/999999999/delivery-cost');
  if (missing.status !== 404) wrong.push(`a missing project answered ${missing.status}, expected 404`);
  const settled = await writeCounts(h);
  await h.get(`/api/projects/${project}/delivery-cost`);
  if ((await writeCounts(h)) !== settled) wrong.push('reading the delivery cost wrote a row');
  return 'allocation 5,000 + project remittance 3,000 = 8,000 in 1402; 800 suggested for each of the 10, and after 4 at 800 the 4,800 left gives 800 again; no balance or cost for a reader without an item cost key';
}

interface IssuedBody { costVisible?: boolean; total?: number; totalCost?: number | null; rows?: Array<{ source: string; sourceId: number; itemId: number; quantity: number; status: string; cost: number | null; date: string | null; refNumber: string | null }> }

/** D3 of the review: what the project took from stock was spread over the allocation tab, the documents list and the Kardex */
async function issuedMaterialsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(50, 1_000);
  const project = await createProject(h, { sections: [], manualPurchaseItems: [], isFinalized: false });
  const otherProject = await createProject(h, { sections: [], manualPurchaseItems: [], isFinalized: false });
  const allocate = async (projectId: number, quantity: number) => {
    const res = await h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId: material, quantity, location: f.wh }] });
    const id = Number((res.body as { data?: { allocations?: Array<{ id?: unknown }> } })?.data?.allocations?.[0]?.id);
    if (res.status !== 200 || !Number.isInteger(id)) throw new Error(`setup: the allocation answered ${brief(res)}`);
    return id;
  };
  const doc = async (type: string, status: string, quantity: number, projectId = project) => {
    const res = await h.post('/api/documents', f.doc(type, status, [{ itemId: material, quantity, unit_price: 0, location: f.wh }], { projectId }));
    if (res.status !== 200) throw new Error(`setup: ${type}/${status} answered ${brief(res)}`);
    return Number((res.body as { docId?: unknown }).docId);
  };

  const kept = await allocate(project, 5);
  const consumed = await h.post(`/api/inventory/allocations/${kept}/consume`, {});
  if (consumed.status !== 200) throw new Error(`setup: consume answered ${brief(consumed)}`);
  const released = await allocate(project, 2);
  const rel = await h.post(`/api/inventory/allocations/${released}/release`, { reason: 'TD-1290' });
  if (rel.status !== 200) throw new Error(`setup: release answered ${brief(rel)}`);
  await allocate(otherProject, 6);
  const remittance = await doc('remittance', 'final', 3);
  const waste = await doc('waste', 'final', 1);
  await doc('remittance', 'draft', 4);
  const voided = await doc('remittance', 'final', 2);
  const voidRes = await h.del(`/api/documents/${voided}`);
  if (voidRes.status !== 200) throw new Error(`setup: the void answered ${brief(voidRes)}`);

  const res = await h.get(`/api/projects/${project}/issued-materials`);
  const body = res.body as IssuedBody;
  const rows = body.rows ?? [];
  const seen = rows.map(r => `${r.source}:${r.sourceId}=${r.quantity}/${r.status}/${r.cost}`).sort();
  const expected = [`allocation:${kept}=5/consumed/5000`, `remittance:${remittance}=3/final/3000`, `waste:${waste}=1/final/1000`].sort();
  if (res.status !== 200 || JSON.stringify(seen) !== JSON.stringify(expected) || body.total !== 3 || body.totalCost !== 9_000 || body.costVisible !== true) {
    wrong.push(`the list answered ${brief(res)} with rows ${JSON.stringify(seen)}, expected ${JSON.stringify(expected)}, total 3 and cost 9,000 (released, draft, voided and the other project's left out)`);
  }
  const allocationRow = rows.find(r => r.source === 'allocation');
  if (allocationRow && !(typeof allocationRow.date === 'string' && allocationRow.date.endsWith('Z'))) wrong.push(`the allocation time ${allocationRow.date} is not sent with a Z`);
  const documentRow = rows.find(r => r.source === 'remittance');
  if (documentRow && !(String(documentRow.date).startsWith(f.today) && documentRow.refNumber)) wrong.push(`the remittance row has date ${documentRow.date} and number ${documentRow.refNumber}, expected its own date and number`);

  const viewer = await h.sessionWith(['projects.view']);
  const plain = await h.get(`/api/projects/${project}/issued-materials`, viewer);
  const pb = plain.body as IssuedBody;
  if (plain.status !== 200 || pb.costVisible !== false || pb.totalCost !== null || (pb.rows ?? []).some(r => r.cost !== null) || (pb.rows ?? []).length !== 3) {
    wrong.push(`a reader with projects.view only got ${brief(plain)}, expected the 3 rows without cost`);
  }
  const outsider = await h.sessionWith(['documents.view']);
  if ((await h.get(`/api/projects/${project}/issued-materials`, outsider)).status !== 403) wrong.push('a reader with documents.view only was not refused');
  return 'a consumed allocation, a final remittance and a final waste of the project, 9,000 in all; released, draft, voided and another project\'s rows left out; no cost for a reader without an item cost key';
}
