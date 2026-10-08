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
    ['reg_reservation_unit_conversion_td_820',
      'v9.0.350: a project reserves its need converted to the item unit with the row\'s conversion rate; a row in another unit without a conversion refuses finalizing with 422 (TD-820)',
      ['td820', 'reservation', 'project', 'unit', 'package7'], unitConversionCase],
    ['reg_reservation_free_stock_at_finalize_td_819',
      'v9.0.351: finalizing a project reserves only the stock no one else holds and stores the shortage; concurrent finalizes never reserve the same stock twice (TD-819)',
      ['td819', 'reservation', 'project', 'shortage', 'package7'], freeStockAtFinalizeCase],
    ['reg_reservation_keyed_by_item_td_822',
      'v9.0.352: the reservation summary is keyed by item id, so two items whose codes fold to one key keep their own reservations in the report, the item list and the exit gate (TD-822)',
      ['td822', 'reservation', 'summary', 'package7'], keyedByItemCase],
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

/** B07-04 (TD-820): the reservation took the requirement in the row's unit as if it were the item's unit */
async function unitConversionCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const unitItem = async (stock: number, unit: string) => {
    const id = await f.item(stock);
    await h.q(`UPDATE items SET unit = $1 WHERE id = $2`, [unit, id]);
    const [it] = await h.q(`SELECT code, name FROM items WHERE id = $1`, [id]);
    return { id, code: String(it.code), name: String(it.name) };
  };

  // (a) 100 metres at 5 metres a string = 20 strings of an item kept in strings (stock 30): 20 reserved, so 10 sell
  const a = await unitItem(30, 'ریسه');
  const pa = await createProject(h, { isFinalized: true, manualPurchaseItems: [], sections: globalSection([
    { itemCode: a.code, name: a.name, unit: 'متر', requiredQty: 100, convertedUnit: 'ریسه', conversionRate: 5, convertedQty: 20 },
  ]) });
  const va = await reservedOf(a.id);
  if (va.project !== 20) wrong.push(`100 metres at 5 metres a string reserve ${va.project} strings, expected 20`);
  const rowA = (await storedReservation(h, pa))[0] ?? {};
  if (Number(rowA.itemId) !== a.id || rowA.unit !== 'ریسه' || 'convertedQty' in rowA || Number(rowA.conversionRate) !== 5) {
    wrong.push(`the stored reservation row is ${JSON.stringify(rowA)}, expected item ${a.id} in strings with its conversion rate and no convertedQty`);
  }
  const saleA = await postDoc(h, f, 'invoice', 'final', a.id, 10);
  if (saleA.status !== 200) wrong.push(`a final invoice of the 10 free strings answered ${brief(saleA)}, expected 200`);

  // (b) 2 kilograms of an item kept in grams (stock 5,000) at 0.001 kilogram a gram = 2,000 grams reserved
  const b = await unitItem(5_000, 'گرم');
  await createProject(h, { isFinalized: true, manualPurchaseItems: [], sections: globalSection([
    { itemCode: b.code, name: b.name, unit: 'کیلوگرم', requiredQty: 2, convertedUnit: 'گرم', conversionRate: 0.001 },
  ]) });
  if ((await reservedOf(b.id)).project !== 2_000) wrong.push(`2 kilograms reserve ${(await reservedOf(b.id)).project} grams, expected 2000`);
  const bigSale = await postDoc(h, f, 'invoice', 'final', b.id, 4_900);
  if (bigSale.status !== 400) wrong.push(`a final invoice of 4,900 grams with 2,000 reserved answered ${brief(bigSale)}, expected 400`);
  const freeSale = await postDoc(h, f, 'invoice', 'final', b.id, 3_000);
  if (freeSale.status !== 200) wrong.push(`a final invoice of the 3,000 free grams answered ${brief(freeSale)}, expected 200`);

  // (c) a row in kilograms without a conversion: finalizing is refused and nothing is reserved
  const c = await unitItem(5_000, 'گرم');
  const invC = { manualPurchaseItems: [], sections: globalSection([{ itemCode: c.code, name: c.name, unit: 'کیلوگرم', requiredQty: 2 }]) };
  const createFinal = await h.post('/api/projects', { title: `P7 unit ${h.tag}`, products: [], inventory_control: { ...invC, isFinalized: true } });
  if (createFinal.status !== 422 || (createFinal.body as { code?: string })?.code !== 'PROJECT_RESERVATION_UNIT_MISMATCH') {
    wrong.push(`creating a finalized project with 2 kilograms of a gram item and no conversion answered ${brief(createFinal)}, expected 422 PROJECT_RESERVATION_UNIT_MISMATCH`);
  }
  const pc = await createProject(h, { ...invC, isFinalized: false });
  const finalizeC = await h.put(`/api/projects/${pc}`, { inventory_control: { ...invC, isFinalized: true } });
  if (finalizeC.status !== 422 || (finalizeC.body as { code?: string })?.code !== 'PROJECT_RESERVATION_UNIT_MISMATCH') {
    wrong.push(`finalizing it answered ${brief(finalizeC)}, expected 422 PROJECT_RESERVATION_UNIT_MISMATCH`);
  }
  const [storedC] = await h.q(`SELECT inventory_control->'isFinalized' AS fz FROM production_projects WHERE id = $1`, [pc]);
  if (storedC?.fz === true) wrong.push('the refused finalize was stored');
  if ((await reservedOf(c.id)).total !== 0) wrong.push(`the refused project reserves ${(await reservedOf(c.id)).total} grams, expected nothing`);

  // (d) two rows of one item in two units are summed after conversion: 100 metres (20 strings) + 3 strings = 23
  const d = await unitItem(30, 'ریسه');
  const pd = await createProject(h, { isFinalized: true, manualPurchaseItems: [], sections: [
    ...globalSection([{ itemCode: d.code, name: d.name, unit: 'متر', requiredQty: 100, convertedUnit: 'ریسه', conversionRate: 5 }]),
    { id: 'sec-2', title: 'مواد ۲', checkType: 'global', globalItems: [{ itemCode: d.code.toLowerCase(), name: d.name, unit: ' ریسه ', requiredQty: 3 }] },
  ] });
  const rowsD = await storedReservation(h, pd);
  if (rowsD.length !== 1 || Number(rowsD[0].reservedQty) !== 23) wrong.push(`100 metres and 3 strings of one item are stored as ${JSON.stringify(rowsD)}, expected one row of 23 strings`);

  // (e) a reservation stored before the conversion (row unit kept as originalUnit, no rate) is only listed by the health check
  const { findProjectReservationIssues } = await import('../../services/projects/projectReservationHealth.js');
  const [legacy] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, 'P7 legacy unit', 'in_progress', 1, $2::jsonb) RETURNING id`,
    [`P7-LU-${h.tag}-${c.id}`, JSON.stringify({ isFinalized: true, finalizedAt: '2026-01-01T00:00:00Z', reservedItems: [{ itemId: c.id, reservedQty: 2, originalQty: 2, unit: 'گرم', originalUnit: 'کیلوگرم' }] })],
  );
  const kinds = (await findProjectReservationIssues()).filter(i => i.projectId === Number(legacy.id) || i.projectId === pa).map(i => `${i.projectId}:${i.kind}`);
  if (kinds.join(',') !== `${legacy.id}:reservation_unit_unconverted`) wrong.push(`the health check lists ${JSON.stringify(kinds)}, expected only the legacy project as reservation_unit_unconverted`);
  await h.q(`UPDATE production_projects SET is_deleted = 1 WHERE id = $1`, [legacy.id]);
  return 'a project reserves 20 strings for 100 metres, 2,000 grams for 2 kilograms and 23 strings for 100 metres plus 3 strings; a row in kilograms of a gram item without a conversion refuses finalizing with 422; a legacy unconverted reservation is listed by the health check';
}

type Shortage = { itemId?: number; requiredQty?: number; reservedQty?: number; shortQty?: number; reservedByOthers?: number };
const shortagesOf = (body: unknown): Shortage[] => {
  const ic = (body as { inventory_control?: { reservationShortages?: unknown } })?.inventory_control;
  return Array.isArray(ic?.reservationShortages) ? (ic.reservationShortages as Shortage[]) : [];
};

/** B07-03 (TD-819): finalizing reserved min(stock, need) without the reservations of others, so the holders blocked each other */
async function freeStockAtFinalizeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const need = async (itemId: number, qty: number) => {
    const [it] = await h.q(`SELECT code, name FROM items WHERE id = $1`, [itemId]);
    return globalSection([{ itemCode: it.code, name: it.name, unit: 'عدد', requiredQty: qty }]);
  };
  const finalize = async (projectId: number, sections: unknown) =>
    h.put(`/api/projects/${projectId}`, { inventory_control: { sections, manualPurchaseItems: [], isFinalized: true } });

  // (a) stock 30, project A then project B each needing 30: A reserves 30, B reserves nothing and stores a shortage of 30
  const a = await f.item(30);
  const secA = await need(a, 30);
  const pa = await createProject(h, { sections: secA, manualPurchaseItems: [], isFinalized: false });
  const pb = await createProject(h, { sections: secA, manualPurchaseItems: [], isFinalized: false });
  const finA = await finalize(pa, secA);
  if (finA.status !== 200 || shortagesOf(finA.body).length !== 0) wrong.push(`finalizing A answered ${brief(finA)}, expected 200 without a shortage`);
  const finB = await finalize(pb, secA);
  const shortB = shortagesOf(finB.body);
  if (finB.status !== 200) wrong.push(`finalizing B answered ${brief(finB)}, expected 200`);
  if (shortB.length !== 1 || Number(shortB[0].itemId) !== a || shortB[0].requiredQty !== 30 || shortB[0].reservedQty !== 0 || shortB[0].shortQty !== 30 || shortB[0].reservedByOthers !== 30) {
    wrong.push(`B's shortage is ${JSON.stringify(shortB)}, expected item ${a}: need 30, reserved 0, short 30, held by others 30`);
  }
  const viewA = await reservedOf(a);
  if (viewA.project !== 30) wrong.push(`stock 30 with two projects needing 30 reserves ${viewA.project} (${viewA.sources.join(', ')}), expected 30`);
  const remA = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 1, unit_price: 0, location: f.wh }], { projectId: pa }));
  if (remA.status !== 200) wrong.push(`A's own remittance of 1 answered ${brief(remA)}, expected 200`);
  const [storedB] = await h.q(`SELECT inventory_control->'reservationShortages' AS s FROM production_projects WHERE id = $1`, [pb]);
  if (!Array.isArray(storedB?.s) || storedB.s.length !== 1) wrong.push(`B's stored shortage is ${JSON.stringify(storedB?.s)}, expected one row`);

  // (b) stock 10 with a sales proforma of 6: the project reserves the 4 free units and the proforma still finalizes
  const b = await f.item(10);
  const proforma = await postDoc(h, f, 'invoice', 'proforma', b, 6);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);
  const secB = await need(b, 10);
  const pp = await createProject(h, { sections: secB, manualPurchaseItems: [], isFinalized: false });
  const finP = await finalize(pp, secB);
  const shortP = shortagesOf(finP.body);
  if ((await reservedOf(b)).project !== 4 || shortP[0]?.shortQty !== 6) wrong.push(`with a proforma of 6 the project reserves ${(await reservedOf(b)).project} and stores ${JSON.stringify(shortP)}, expected 4 reserved and 6 short`);
  const finProforma = await h.put(`/api/documents/${docIdOf(proforma)}/finalize`, {});
  if (finProforma.status !== 200) wrong.push(`finalizing the earlier proforma answered ${brief(finProforma)}, expected 200`);

  // (c) the shortage comes only from the server: one sent in the body is ignored, and unfreezing clears it
  const forged = await createProject(h, { sections: secB, manualPurchaseItems: [], isFinalized: false, reservationShortages: [{ itemId: b, shortQty: 99 }] });
  const [storedForged] = await h.q(`SELECT inventory_control->'reservationShortages' AS s FROM production_projects WHERE id = $1`, [forged]);
  if (storedForged?.s != null) wrong.push(`a shortage sent in the body was stored: ${JSON.stringify(storedForged.s)}`);
  const unfreeze = await h.put(`/api/projects/${pb}`, { inventory_control: { sections: secA, manualPurchaseItems: [], isFinalized: false } });
  if (unfreeze.status !== 200 || shortagesOf(unfreeze.body).length !== 0) wrong.push(`unfreezing B answered ${brief(unfreeze)}, expected 200 without a shortage`);

  // (d) two projects finalized at the same moment share stock 30 instead of both reserving it
  const c = await f.item(30);
  const secC = await need(c, 30);
  const p1 = await createProject(h, { sections: secC, manualPurchaseItems: [], isFinalized: false });
  const p2 = await createProject(h, { sections: secC, manualPurchaseItems: [], isFinalized: false });
  const both = await Promise.all([finalize(p1, secC), finalize(p2, secC)]);
  if (both.some(r => r.status !== 200)) wrong.push(`concurrent finalizes answered ${both.map(brief).join(' / ')}, expected 200 each`);
  const viewC = await reservedOf(c);
  if (viewC.project !== 30) wrong.push(`two projects finalized together against stock 30 reserve ${viewC.project} (${viewC.sources.join(', ')}), expected 30`);

  // (e) a reservation above stock left by earlier versions is only listed by the health check
  const { findOverReservedItems } = await import('../../services/projects/projectReservationHealth.js');
  const d = await f.item(10);
  const [legacy] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, 'P7 legacy over', 'in_progress', 1, $2::jsonb) RETURNING id`,
    [`P7-LO-${h.tag}-${d}`, JSON.stringify({ isFinalized: true, finalizedAt: '2026-01-01T00:00:00Z', reservedItems: [{ itemId: d, reservedQty: 50, unit: 'عدد' }] })],
  );
  const over = (await findOverReservedItems()).filter(r => [a, b, c, d].includes(r.itemId)).map(r => `${r.itemId}:${r.stock}/${r.reserved}`);
  if (over.join(',') !== `${d}:10/50`) wrong.push(`the health check lists over-reserved items ${JSON.stringify(over)}, expected only item ${d} (stock 10, reserved 50)`);
  await h.q(`UPDATE production_projects SET is_deleted = 1 WHERE id = $1`, [legacy.id]);
  return 'stock 30: the second project needing 30 reserves nothing and stores a shortage of 30, so the first can issue its remittance; with a proforma of 6 a project reserves the 4 free units and the proforma still finalizes; concurrent finalizes reserve 30 in total; a legacy over-reservation is listed by the health check';
}

/**
 * B07-06 (TD-822): summaries were keyed by the code upper-cased in JavaScript. «p7ß-…» and «P7SS-…» are two codes for the
 * database key (upper(btrim(code)) keeps «ß»), so both items exist without dropping uq_items_code_active, but JavaScript
 * upper-cases «ß» to «SS» and gave both one summary: the same collision as two legacy items with codes differing in case.
 */
async function keyedByItemCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const lower = await f.item(10);
  const upper = await f.item(10);
  await h.q(`UPDATE items SET code = $1 WHERE id = $2`, [`p7ß-${h.tag}`, lower]);
  await h.q(`UPDATE items SET code = $1 WHERE id = $2`, [`P7SS-${h.tag}`, upper]);
  const proforma = await postDoc(h, f, 'invoice', 'proforma', lower, 6);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);

  const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
  const report = await ItemStockReservationService.getReservedStockDetails(undefined, true);
  const reservedIn = (id: number) => report.itemSummaries.filter(s => Number(s.itemId) === id).reduce((t, s) => t + Number(s.totalReservedQty), 0);
  if (reservedIn(lower) !== 6 || reservedIn(upper) !== 0) wrong.push(`the full report gives the proforma's item ${reservedIn(lower)} and the other item ${reservedIn(upper)}, expected 6 and 0`);

  const list = await h.get(`/api/items?search=${encodeURIComponent(h.tag)}&limit=50`);
  const rows = (Array.isArray((list.body as { data?: unknown })?.data) ? (list.body as { data: Array<Record<string, unknown>> }).data : []);
  const listed = (id: number) => Number(rows.find(r => Number(r.id) === id)?.reserved_stock);
  if (listed(lower) !== 6 || listed(upper) !== 0) wrong.push(`GET /items shows reserved ${listed(lower)} and ${listed(upper)}, expected 6 and 0`);

  // one invoice with both items: the free 4 of the proforma's item and all 10 of the other item
  const sale = await h.post('/api/documents', f.doc('invoice', 'final', [
    { itemId: lower, quantity: 4, unit_price: 5_000, location: f.wh },
    { itemId: upper, quantity: 10, unit_price: 5_000, location: f.wh },
  ]));
  if (sale.status !== 200) wrong.push(`a final invoice of 4 free units of one item and 10 of the other answered ${brief(sale)}, expected 200`);
  const over = await postDoc(h, f, 'invoice', 'final', lower, 1);
  if (over.status !== 400) wrong.push(`one more unit of the proforma's item answered ${brief(over)}, expected 400`);
  return 'two items whose codes fold to one key: the proforma of 6 stays on its own item in the report, GET /items and the exit gate';
}
