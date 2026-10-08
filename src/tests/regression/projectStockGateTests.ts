import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, postDoc, reservedOf, runReservationCases } from './stockReservationTests.js';

/**
 * Series 9 phase 5 (closing review), PR «الف»: the side paths that move project stock — material allocation, its release
 * and the project delivery — follow the rules of the stock documents. Through the real Express routes with real sessions;
 * each case reproduces a phase 5 finding and is red on the code before its fix.
 */
export async function runProjectStockGateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_project_allocation_sellable_gate_td_905',
      'v9.0.451: allocating material to a project passes the sellable gate of a remittance; the reservations of another project and of a sales proforma are not consumed (TD-905)',
      ['td905', 'allocation', 'reservation', 'sellable', 'phase5'], allocationSellableGateCase],
  ]);
}

const errorText = (body: unknown) => String((body as { error?: unknown; message?: unknown } | undefined)?.error ?? (body as { message?: unknown } | undefined)?.message ?? '');

/** One global control row of the item, needing `requiredQty` */
async function materialRow(h: Harness, itemId: number, requiredQty: number) {
  const [it] = await h.q('SELECT code, name FROM items WHERE id = $1', [itemId]);
  return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty };
}

/** A project frozen with these needs (it reserves them), or an open project without a reservation */
async function projectNeeding(h: Harness, needs: Array<[number, number]>): Promise<number> {
  const rows = await Promise.all(needs.map(([itemId, qty]) => materialRow(h, itemId, qty)));
  return createProject(h, { sections: rows.length > 0 ? globalSection(rows) : [], manualPurchaseItems: [], isFinalized: rows.length > 0 });
}

const allocationRows = async (h: Harness, projectId: number, itemId: number) => Number(
  (await h.q(`SELECT count(*)::int AS n FROM project_bom_allocations WHERE project_id = $1 AND item_id = $2 AND is_deleted = 0 AND status = 'allocated'`, [projectId, itemId]))[0]?.n,
);

/**
 * P5-M02 (TD-905): allocation moved stock out without the sellable gate (TD-775). With all 10 units of an item reserved for
 * project P1, a remittance of 6 for project P2 was refused but an allocation of 6 to P2 passed, and P1 could no longer
 * issue its own 10; a sales proforma's 5 units went to an allocation and the proforma could no longer be finalized.
 */
async function allocationSellableGateCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const allocate = (projectId: number, itemId: number, quantity: number) =>
    h.post('/api/inventory/allocations/allocate', { projectId, allocations: [{ itemId, quantity, location: f.wh }] });

  // 1) another project's reservation: P1 holds all 10 units of G
  const g = await f.item(10);
  const p1 = await projectNeeding(h, [[g, 10]]);
  const p2 = await projectNeeding(h, []);
  if ((await reservedOf(g)).project !== 10) throw new Error(`setup: P1 reserves ${(await reservedOf(g)).project} of 10, expected 10`);
  const remittance = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: g, quantity: 6, unit_price: 0, location: f.wh }], { projectId: p2 }));
  if (remittance.status !== 400) throw new Error(`setup: a remittance of 6 for P2 answered ${brief(remittance)}, expected 400`);
  const toP2 = await allocate(p2, g, 6);
  if (toP2.status !== 400 || toP2.body?.code !== 'INSUFFICIENT_STOCK') wrong.push(`allocating 6 of P1's reserved 10 to P2 answered ${brief(toP2)}, expected 400 INSUFFICIENT_STOCK like the remittance`);
  if (await f.stock(g) !== 10) wrong.push(`the refused allocation left stock ${await f.stock(g)}, expected 10`);
  if (await allocationRows(h, p2, g) !== 0) wrong.push('the refused allocation stored an allocation row for P2');
  const ownAllocation = await allocate(p1, g, 10);
  if (ownAllocation.status !== 200) wrong.push(`P1 allocating its own reserved 10 answered ${brief(ownAllocation)}, expected 200`);

  // 2) a sales proforma's reservation: 5 of H are held by a proforma, 2 of J's 10 by another
  const hItem = await f.item(5);
  const proforma = await postDoc(h, f, 'invoice', 'proforma', hItem, 5);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);
  const takeH = await allocate(p2, hItem, 5);
  if (takeH.status !== 400 || takeH.body?.code !== 'INSUFFICIENT_STOCK') wrong.push(`allocating the 5 units a sales proforma holds answered ${brief(takeH)}, expected 400 INSUFFICIENT_STOCK`);
  if (!errorText(takeH.body).includes('رزرو')) wrong.push(`the refusal does not name the reservation: ${errorText(takeH.body).slice(0, 160)}`);
  const finalize = await h.put(`/api/documents/${Number(proforma.body?.docId)}/finalize`, {});
  if (finalize.status !== 200) wrong.push(`finalizing the sales proforma after the refused allocation answered ${brief(finalize)}, expected 200`);

  const j = await f.item(10);
  if ((await postDoc(h, f, 'invoice', 'proforma', j, 2)).status !== 200) throw new Error('setup: the sales proforma of 2 J failed');
  const free = await allocate(p2, j, 8);
  if (free.status !== 200) wrong.push(`allocating the 8 free units of J answered ${brief(free)}, expected 200`);
  const beyond = await allocate(p2, j, 1);
  if (beyond.status !== 400) wrong.push(`allocating 1 more unit of J (only the proforma's 2 left) answered ${brief(beyond)}, expected 400`);
  if (await f.stock(j) !== 2) wrong.push(`J has stock ${await f.stock(j)} after the allocations, expected 2`);
  return 'allocation refused for the stock of another project and of a sales proforma; the project\'s own reservation and free stock allocate';
}
