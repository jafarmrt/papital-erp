import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture, type Fixture } from './documentEntryTests.js';

/**
 * Package 7 (inventory planning), PR A: which documents and projects reserve stock, how much a project reserves and how
 * reservations are keyed. Through the real Express routes with real sessions. Each case reproduces a finding of the
 * package 7 review and is red on the code before its fix.
 */
export async function runStockReservationTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_reservation_sales_proforma_only_td_818',
      'v9.0.348: only a sales proforma (invoice or proforma type in proforma status) reserves stock; a purchase proforma and a draft do not (TD-818)',
      ['td818', 'reservation', 'proforma', 'package7'], salesProformaOnlyCase],
    ['reg_reservation_finalized_project_only_td_817',
      'v9.0.349: only the stored reservation of a finalized project reserves stock; a draft or unfrozen project reserves nothing and a consumed reservation stays consumed (TD-817)',
      ['td817', 'reservation', 'project', 'package7'], finalizedProjectOnlyCase],
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
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

interface ReservedView { total: number; proforma: number; project: number; sources: string[] }

/** The reservation summary of one item as the exit gate reads it (scoped to that item) */
export async function reservedOf(itemId: number): Promise<ReservedView> {
  const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
  const report = await ItemStockReservationService.getReservedStockDetails(undefined, true, { itemIds: [itemId] });
  const s = report.itemSummaries.find(x => Number(x.itemId) === itemId);
  return {
    total: Number(s?.totalReservedQty ?? 0),
    proforma: Number(s?.proformaReservedQty ?? 0),
    project: Number(s?.projectReservedQty ?? 0),
    sources: (s?.reservations ?? []).map(r => `${r.sourceType}:${r.sourceRef}=${r.reservedQty}`),
  };
}

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);

/** One global inventory-control section with the given material rows */
export const globalSection = (rows: Array<Record<string, unknown>>) => [{ id: 'sec-1', title: 'مواد', checkType: 'global', globalItems: rows }];

/** A project created through POST /api/projects with this inventory control; returns its id */
export async function createProject(h: Harness, inventoryControl: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await h.post('/api/projects', { title: `P7 project ${h.tag} ${Math.floor(Math.random() * 1e6)}`, products: [], inventory_control: inventoryControl, ...extra });
  if (res.status !== 201) throw new Error(`setup: project create answered ${brief(res)}`);
  return Number((res.body as { id?: unknown }).id);
}

/** The project's stored inventory_control.reservedItems */
export async function storedReservation(h: Harness, projectId: number): Promise<Array<Record<string, unknown>>> {
  const [row] = await h.q(`SELECT inventory_control->'reservedItems' AS r FROM production_projects WHERE id = $1`, [projectId]);
  return Array.isArray(row?.r) ? (row.r as Array<Record<string, unknown>>) : [];
}

async function postDoc(h: Harness, f: Fixture, type: string, status: string, itemId: number, quantity: number, price = 5_000) {
  return h.post('/api/documents', f.doc(type, status, [{ itemId, quantity, unit_price: price, location: f.wh }]));
}

/** B07-02 (TD-818): a purchase proforma (receipt in proforma status) and a draft of type proforma reserved stock as a sales proforma */
async function salesProformaOnlyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const setup: Array<[string, string, number]> = [['receipt', 'proforma', 9], ['proforma', 'draft', 7], ['invoice', 'draft', 1], ['invoice', 'proforma', 2]];
  const ids: Record<string, number> = {};
  for (const [type, status, qty] of setup) {
    const res = await postDoc(h, f, type, status, a, qty);
    if (res.status !== 200) throw new Error(`setup: ${type}/${status} answered ${brief(res)}`);
    ids[`${type}/${status}`] = docIdOf(res);
  }
  const stored = await h.q(`SELECT type, status FROM documents WHERE id = $1`, [ids['proforma/draft']]);
  if (stored[0]?.type !== 'proforma' || stored[0]?.status !== 'draft') throw new Error(`setup: the draft proforma is stored as ${JSON.stringify(stored[0])}`);

  const view = await reservedOf(a);
  if (view.total !== 2 || view.proforma !== 2) {
    wrong.push(`stock 10 with a purchase proforma of 9, a draft proforma of 7, a draft invoice of 1 and a sales proforma of 2 reserves ${view.total} (${view.sources.join(', ')}), expected 2 from the sales proforma only`);
  }
  // the 8 units no sales proforma holds can be sold
  const sale = await postDoc(h, f, 'invoice', 'final', a, 8);
  if (sale.status !== 200) wrong.push(`a final invoice of the 8 free units answered ${brief(sale)}, expected 200`);
  // and the sales proforma itself is still protected: 1 more unit for someone else is refused
  const more = await postDoc(h, f, 'invoice', 'final', a, 1);
  if (more.status !== 400) wrong.push(`a final invoice of 1 more unit (2 left, both reserved by the sales proforma) answered ${brief(more)}, expected 400`);
  return 'stock 10: a purchase proforma of 9, a draft proforma of 7 and a draft invoice of 1 reserve nothing; the sales proforma of 2 reserves 2, so 8 sell and a 9th is refused';
}

/** B07-01 (TD-817): the reader rebuilt an empty stored reservation from the sections, for draft, unfrozen and consumed projects */
async function finalizedProjectOnlyCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { findProjectReservationIssues } = await import('../../services/projects/projectReservationHealth.js');
  const material = async (itemId: number) => {
    const [it] = await h.q(`SELECT code, name FROM items WHERE id = $1`, [itemId]);
    return { itemCode: it.code, name: it.name, unit: 'عدد', requiredQty: 8 };
  };
  const expectFree = async (itemId: number, label: string, sellable: number) => {
    const view = await reservedOf(itemId);
    if (view.total !== 0) wrong.push(`${label}: reserves ${view.total} (${view.sources.join(', ')}), expected nothing`);
    const sale = await postDoc(h, f, 'invoice', 'final', itemId, sellable);
    if (sale.status !== 200) wrong.push(`${label}: a final invoice of the ${sellable} free units answered ${brief(sale)}, expected 200`);
  };

  // 1) a project saved with its control section and never finalized
  const a = await f.item(10);
  await createProject(h, { sections: globalSection([await material(a)]), manualPurchaseItems: [], isFinalized: false });
  await expectFree(a, 'stock 10 and a project needing 8 that was never finalized', 5);

  // 2) finalized (reserves 8), then unfrozen (the server clears the stored reservation)
  const b = await f.item(10);
  const invB = { sections: globalSection([await material(b)]), manualPurchaseItems: [], isFinalized: true };
  const pb = await createProject(h, invB);
  if ((await reservedOf(b)).project !== 8) wrong.push(`a finalized project needing 8 of 10 reserves ${(await reservedOf(b)).project}, expected 8`);
  const unfreeze = await h.put(`/api/projects/${pb}`, { inventory_control: { ...invB, isFinalized: false } });
  if (unfreeze.status !== 200) throw new Error(`setup: unfreeze answered ${brief(unfreeze)}`);
  await expectFree(b, 'the same project after leaving the frozen state', 5);

  // 3) finalized and its own remittance consumed all 8: nothing is rebuilt from the 2 units left
  const c = await f.item(10);
  const pc = await createProject(h, { sections: globalSection([await material(c)]), manualPurchaseItems: [], isFinalized: true });
  const rem = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: c, quantity: 8, unit_price: 0, location: f.wh }], { projectId: pc }));
  if (rem.status !== 200) throw new Error(`setup: the project's remittance of 8 answered ${brief(rem)}`);
  if ((await storedReservation(h, pc)).length !== 0) wrong.push(`the consumed reservation is still stored: ${JSON.stringify(await storedReservation(h, pc))}`);
  await expectFree(c, 'a finalized project whose remittance consumed its whole reservation (2 units left)', 2);

  // 4) legacy rows are only listed by the health check: a draft project holding a stored reservation, and a project
  //    finalized before the server wrote reservations (no finalizedAt, no reservedItems)
  const d = await f.item(10);
  const [legacyDraft] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, 'P7 legacy draft', 'in_progress', 1, $2::jsonb) RETURNING id`,
    [`P7-LD-${h.tag}-${d}`, JSON.stringify({ isFinalized: false, reservedItems: [{ itemId: d, reservedQty: 4, unit: 'عدد' }] })],
  );
  const [legacyFinal] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, 'P7 legacy final', 'in_progress', 1, $2::jsonb) RETURNING id`,
    [`P7-LF-${h.tag}-${d}`, JSON.stringify({ isFinalized: true, sections: globalSection([await material(d)]) })],
  );
  if ((await reservedOf(d)).total !== 0) wrong.push(`the legacy projects reserve ${(await reservedOf(d)).total} of item ${d}, expected nothing`);
  const issues = await findProjectReservationIssues();
  const kindOf = (id: unknown) => issues.filter(i => i.projectId === Number(id)).map(i => i.kind).join(',');
  if (kindOf(legacyDraft.id) !== 'unfinalized_with_reservation') wrong.push(`the health check lists the legacy draft as «${kindOf(legacyDraft.id)}», expected unfinalized_with_reservation`);
  if (kindOf(legacyFinal.id) !== 'finalized_without_reservation') wrong.push(`the health check lists the legacy finalized project as «${kindOf(legacyFinal.id)}», expected finalized_without_reservation`);
  if (kindOf(pc) !== '') wrong.push(`the health check lists the consumed project as «${kindOf(pc)}», expected nothing`);
  await h.q(`UPDATE production_projects SET is_deleted = 1 WHERE id = ANY($1::int[])`, [[Number(legacyDraft.id), Number(legacyFinal.id)]]);
  return 'a draft, an unfrozen and a consumed project reserve nothing, so 5, 5 and the last 2 units sell; legacy projects are listed by the health check only';
}
