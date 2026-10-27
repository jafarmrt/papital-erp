import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture, type Fixture } from './documentEntryTests.js';
import { runReservationCases } from './stockReservationTests.js';

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): a project's production receipt costs the project's real cost, its work in progress
 * (1402); a cost other than that needs a reason and the difference goes to «اختلاف بهای تولید» (6005); the receipt that
 * completes the plan closes 1402; and the materials of a project that delivered goods are neither released nor voided.
 * Through the real Express routes with real sessions. Each case is red on the code before the change: the typed cost or
 * the item's weighted average cost was posted, 1402 was left over or overdrawn, and release and void were allowed.
 */
export async function runProductionRealCostTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_production_real_cost_one_product_v11_6_1th',
      'v11 6.1th: one product takes its share of the project 1402 by quantity and the last receipt closes it; another cost is 422 without a reason and with one posts the difference to 6005 (owner decision t52-3)',
      ['v11', 'phase6', 'projects', 'delivery', 'wip'], oneProductCase],
    ['reg_production_real_cost_several_products_v11_6_1th',
      'v11 6.1th: a project of several products prices a receipt at its typed or average cost until the receipt that completes the plan spreads all of 1402 by those costs; taking more than 1402 needs a reason (owner decision t59 A)',
      ['v11', 'phase6', 'projects', 'delivery', 'wip'], severalProductsCase],
    ['reg_production_real_cost_without_wip_v11_6_1th',
      'v11 6.1th: a project without 1402 delivers at a typed or average cost only with a reason, all of it to 6005',
      ['v11', 'phase6', 'projects', 'delivery', 'wip'], withoutWipCase],
    ['reg_project_materials_delivered_guard_v11_6_1th',
      'v11 6.1th: a material allocation is not released and a project remittance is not voided while the project has a live production receipt (409 PROJECT_MATERIALS_DELIVERED); after the receipts are voided both are',
      ['v11', 'phase6', 'projects', 'allocation', 'wip'], deliveredGuardCase],
  ]);
}

const ACCOUNTS = { wip: '1402', finishedGoods: '1403', variance: '6005' } as const;

interface CostRefusal { code?: string; details?: { kind?: string; rule?: string; unitCosts?: string[]; wipBalance?: string } }

async function project(h: Harness, f: Fixture, products: Array<[number, number]>): Promise<number> {
  const res = await h.post('/api/projects', {
    title: `6.1th cost ${h.tag} ${Math.floor(Math.random() * 1e6)}`, start_date: f.today, end_date: f.today, quantity: 1,
    products: products.map(([itemId, quantity]) => ({ item_id: itemId, item_code: '', item_name: '', quantity, unit: 'عدد' })),
  });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  return Number((res.body as { id?: unknown }).id);
}

async function allocate(h: Harness, f: Fixture, projectId: number, itemId: number, quantity: number): Promise<number> {
  const res = await h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId, quantity, location: f.wh }] });
  if (res.status !== 200) throw new Error(`setup: the allocation answered ${brief(res)}`);
  const [row] = await h.q(`SELECT id FROM project_bom_allocations WHERE project_id = $1 AND item_id = $2 AND is_deleted = 0 ORDER BY id DESC LIMIT 1`, [projectId, itemId]);
  return Number(row?.id);
}

type Line = { itemId: number; quantity: number; unitPrice?: number };

function deliver(h: Harness, f: Fixture, projectId: number, lines: Line[], productionCostReason?: string) {
  return h.post(`/api/projects/${projectId}/add-to-inventory`, {
    itemsToAdd: lines.map(l => ({ ...l, location: f.wh })), ...(productionCostReason ? { productionCostReason } : {}),
  });
}

async function delivered(h: Harness, f: Fixture, projectId: number, lines: Line[], productionCostReason?: string): Promise<number> {
  const res = await deliver(h, f, projectId, lines, productionCostReason);
  if (res.status !== 200) throw new Error(`the delivery of ${JSON.stringify(lines)} answered ${brief(res)}`);
  return Number((res.body as { documentId?: unknown }).documentId);
}

/** The project's 1402 the delivery tab reads */
async function wipOf(h: Harness, projectId: number): Promise<number | null> {
  const res = await h.get(`/api/projects/${projectId}/delivery-cost`);
  return (res.body as { wipBalance?: number | null }).wipBalance ?? null;
}

/** Net (debit − credit) by account code of a document's live voucher, and whether its 1402 and 6005 rows carry the project */
async function voucherOf(h: Harness, documentId: number, projectId: number): Promise<{ net: Record<string, number>; balanced: boolean; projectRows: boolean }> {
  const rows = await h.q(
    `SELECT a.code, i.debit::float8 AS debit, i.credit::float8 AS credit, i.detailed_type AS "detailedType", i.detailed_id AS "detailedId"
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0`, [documentId]);
  const net: Record<string, number> = {};
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const code = String(r.code);
    net[code] = Math.round(((net[code] ?? 0) + Number(r.debit) - Number(r.credit)) * 10_000) / 10_000;
    debit += Number(r.debit);
    credit += Number(r.credit);
  }
  const projectRows = rows
    .filter(r => r.code === ACCOUNTS.wip || r.code === ACCOUNTS.variance)
    .every(r => r.detailedType === 'project' && Number(r.detailedId) === projectId);
  return { net, balanced: rows.length > 0 && Math.abs(debit - credit) < 0.01, projectRows };
}

async function kardexCosts(h: Harness, documentId: number): Promise<Record<number, number>> {
  const rows = await h.q(
    `SELECT item_id AS "itemId", unit_price::float8 AS cost FROM transactions WHERE document_id = $1 AND is_deleted = 0 AND reversal_of_id IS NULL`, [documentId]);
  return Object.fromEntries(rows.map(r => [Number(r.itemId), Number(r.cost)]));
}

async function receiptCount(h: Harness, projectId: number): Promise<number> {
  const [row] = await h.q(`SELECT count(*)::int AS n FROM documents WHERE project_id = $1 AND type = 'production_receipt' AND is_deleted = 0`, [projectId]);
  return Number(row?.n ?? 0);
}

const sameNet = (actual: Record<string, number>, expected: Record<string, number>) =>
  JSON.stringify(Object.entries(actual).filter(([, v]) => v !== 0).sort()) === JSON.stringify(Object.entries(expected).sort());

/** A plan of 10 with 8,000 in 1402: 4 without a cost take 3,200; 6 typed at 900 take the last 4,800 and 600 goes to 6005 */
async function oneProductCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const product = await f.item(0, 0);
  const projectId = await project(h, f, [[product, 10]]);
  await allocate(h, f, projectId, material, 5);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: material, quantity: 3, unit_price: 0, location: f.wh }], { projectId }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance answered ${brief(rem)}`);

  const first = await delivered(h, f, projectId, [{ itemId: product, quantity: 4 }]);
  if ((await kardexCosts(h, first))[product] !== 800) wrong.push(`4 of 10 without a cost entered at ${(await kardexCosts(h, first))[product]}, expected 800 (8,000 ÷ 10)`);
  const v1 = await voucherOf(h, first, projectId);
  if (!v1.balanced || !v1.projectRows || !sameNet(v1.net, { [ACCOUNTS.finishedGoods]: 3_200, [ACCOUNTS.wip]: -3_200 })) {
    wrong.push(`the first receipt's voucher is ${JSON.stringify(v1)}, expected Dr 1403 3,200 / Cr 1402 3,200 with the project`);
  }
  const [cost1] = await h.q(`SELECT cost_rule AS rule, wip_credit::float8 AS credit, reason FROM production_receipt_costs WHERE document_id = $1`, [first]);
  if (cost1?.rule !== 'share' || Number(cost1?.credit) !== 3_200 || cost1?.reason !== '') wrong.push(`the first receipt's pricing row is ${JSON.stringify(cost1)}, expected share, 3,200, no reason`);

  // a cost other than the real one is refused without a reason and writes nothing
  const refused = await deliver(h, f, projectId, [{ itemId: product, quantity: 6, unitPrice: 900 }]);
  const body = refused.body as CostRefusal;
  if (refused.status !== 422 || body.code !== 'PRODUCTION_COST_REASON_REQUIRED' || body.details?.kind !== 'cost_changed' || body.details?.unitCosts?.[0] !== '800') {
    wrong.push(`6 typed at 900 against a real cost of 800 answered ${brief(refused)}, expected 422 PRODUCTION_COST_REASON_REQUIRED cost_changed with the real cost 800`);
  }
  if (await receiptCount(h, projectId) !== 1) wrong.push('the refused delivery wrote a production receipt');

  const last = await delivered(h, f, projectId, [{ itemId: product, quantity: 6, unitPrice: 900 }], 'a dearer batch of parts');
  if ((await kardexCosts(h, last))[product] !== 900) wrong.push(`6 typed at 900 with a reason entered at ${(await kardexCosts(h, last))[product]}, expected 900`);
  const v2 = await voucherOf(h, last, projectId);
  if (!v2.balanced || !v2.projectRows || !sameNet(v2.net, { [ACCOUNTS.finishedGoods]: 5_400, [ACCOUNTS.wip]: -4_800, [ACCOUNTS.variance]: -600 })) {
    wrong.push(`the last receipt's voucher is ${JSON.stringify(v2)}, expected Dr 1403 5,400 / Cr 1402 4,800 / Cr 6005 600 with the project`);
  }
  const wip = await wipOf(h, projectId);
  if (wip !== 0) wrong.push(`the project's 1402 after the receipt that completes the plan is ${wip}, expected 0`);
  const [notes] = await h.q(`SELECT notes FROM documents WHERE id = $1`, [last]);
  if (!String(notes?.notes ?? '').includes('a dearer batch of parts')) wrong.push(`the reason is not in the receipt's notes: ${notes?.notes}`);
  return 'share 800 × 4; 900 refused without a reason, with one Cr 1402 4,800 and Cr 6005 600; 1402 closed at zero';
}

/** Chairs (plan 10, cost 100) and a table (plan 1): 5 chairs take 500 of 5,000; the completing receipt spreads 4,500 */
async function severalProductsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const chair = await f.item(0, 100);
  const table = await f.item(0, 0);
  const projectId = await project(h, f, [[chair, 10], [table, 1]]);
  await allocate(h, f, projectId, material, 5);

  const first = await delivered(h, f, projectId, [{ itemId: chair, quantity: 5 }]);
  if ((await kardexCosts(h, first))[chair] !== 100) wrong.push(`5 chairs before the plan is complete entered at ${(await kardexCosts(h, first))[chair]}, expected their average cost 100`);
  if (await wipOf(h, projectId) !== 4_500) wrong.push(`1402 after 5 chairs at 100 is ${await wipOf(h, projectId)}, expected 4,500`);

  const overdraw = await deliver(h, f, projectId, [{ itemId: chair, quantity: 5, unitPrice: 2_000 }]);
  if (overdraw.status !== 422 || (overdraw.body as CostRefusal).details?.kind !== 'overdraw') {
    wrong.push(`5 chairs at 2,000 against 4,500 in 1402 answered ${brief(overdraw)}, expected 422 overdraw`);
  }

  // the receipt that completes the plan: weights 5 × 100 and 1 × 1,500 spread 4,500 as 225 a chair and 3,375 the table
  const last = await delivered(h, f, projectId, [{ itemId: chair, quantity: 5 }, { itemId: table, quantity: 1, unitPrice: 1_500 }]);
  const costs = await kardexCosts(h, last);
  if (costs[chair] !== 225 || costs[table] !== 3_375) wrong.push(`the completing receipt entered a chair at ${costs[chair]} and the table at ${costs[table]}, expected 225 and 3,375`);
  const v = await voucherOf(h, last, projectId);
  if (!v.balanced || !sameNet(v.net, { [ACCOUNTS.finishedGoods]: 4_500, [ACCOUNTS.wip]: -4_500 })) {
    wrong.push(`the completing receipt's voucher is ${JSON.stringify(v)}, expected Dr 1403 4,500 / Cr 1402 4,500`);
  }
  if (await wipOf(h, projectId) !== 0) wrong.push(`1402 after the completing receipt is ${await wipOf(h, projectId)}, expected 0`);
  return '5 chairs at 100; 5 at 2,000 refused as overdraw; the completing receipt 225 and 3,375 closed 1402';
}

/** No materials: 2 typed at 500 need a reason, then all 1,000 goes to 6005 and 1402 is untouched */
async function withoutWipCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const product = await f.item(0, 0);
  const projectId = await project(h, f, [[product, 5]]);

  const refused = await deliver(h, f, projectId, [{ itemId: product, quantity: 2, unitPrice: 500 }]);
  if (refused.status !== 422 || (refused.body as CostRefusal).details?.kind !== 'no_wip') {
    wrong.push(`2 typed at 500 for a project without 1402 answered ${brief(refused)}, expected 422 no_wip`);
  }
  const doc = await delivered(h, f, projectId, [{ itemId: product, quantity: 2, unitPrice: 500 }], 'materials bought for this order directly');
  const v = await voucherOf(h, doc, projectId);
  if (!v.balanced || !v.projectRows || !sameNet(v.net, { [ACCOUNTS.finishedGoods]: 1_000, [ACCOUNTS.variance]: -1_000 })) {
    wrong.push(`the receipt's voucher is ${JSON.stringify(v)}, expected Dr 1403 1,000 / Cr 6005 1,000 with the project and no 1402 row`);
  }
  if (await wipOf(h, projectId) !== 0) wrong.push(`1402 of the project without materials became ${await wipOf(h, projectId)}`);
  return 'refused without a reason; with one Dr 1403 1,000 / Cr 6005 1,000';
}

async function deliveredGuardCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const material = await f.item(20, 1_000);
  const product = await f.item(0, 0);
  const projectId = await project(h, f, [[product, 4]]);
  const allocationId = await allocate(h, f, projectId, material, 2);
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: material, quantity: 2, unit_price: 0, location: f.wh }], { projectId }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance answered ${brief(rem)}`);
  const remId = Number((rem.body as { docId?: unknown }).docId);
  const receipt = await delivered(h, f, projectId, [{ itemId: product, quantity: 2 }]);

  const release = await h.post(`/api/inventory/allocations/${allocationId}/release`, {});
  if (release.status !== 409 || (release.body as CostRefusal).code !== 'PROJECT_MATERIALS_DELIVERED') wrong.push(`releasing the allocation after a delivery answered ${brief(release)}, expected 409 PROJECT_MATERIALS_DELIVERED`);
  const voidRem = await h.del(`/api/documents/${remId}`);
  if (voidRem.status !== 409 || (voidRem.body as CostRefusal).code !== 'PROJECT_MATERIALS_DELIVERED') wrong.push(`voiding the project remittance after a delivery answered ${brief(voidRem)}, expected 409 PROJECT_MATERIALS_DELIVERED`);
  if (await wipOf(h, projectId) !== 2_000) wrong.push(`1402 after the refused release and void is ${await wipOf(h, projectId)}, expected 2,000 (4,000 − 2 × 1,000)`);

  // voiding the receipt brings its share back to 1402, and then the materials go
  const voidReceipt = await h.del(`/api/documents/${receipt}`);
  if (voidReceipt.status !== 200) throw new Error(`voiding the production receipt answered ${brief(voidReceipt)}`);
  const released = await h.post(`/api/inventory/allocations/${allocationId}/release`, {});
  if (released.status !== 200) wrong.push(`releasing the allocation after the receipt was voided answered ${brief(released)}, expected 200`);
  const voided = await h.del(`/api/documents/${remId}`);
  if (voided.status !== 200) wrong.push(`voiding the remittance after the receipt was voided answered ${brief(voided)}, expected 200`);
  if (await wipOf(h, projectId) !== 0) wrong.push(`1402 after the receipt, the allocation and the remittance are undone is ${await wipOf(h, projectId)}, expected 0`);
  return 'release and void 409 while the receipt lives; 200 after it is voided; 1402 back to zero';
}
