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
