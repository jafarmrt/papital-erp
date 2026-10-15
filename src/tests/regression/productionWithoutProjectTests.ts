import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createTestItem } from '../fixtures/factories.js';

/**
 * v10.1.6 (N-06, decision t26): a finished product made in the workshop outside any project enters stock from the stock
 * page as a final rial production receipt without a project. Its unit cost is the entered material cost, else the item's
 * current weighted average cost (TD-256), and a product without one at price zero is refused (TD-906); its draft voucher
 * debits finished goods and credits «مصرف مواد بی پروژه» (6003, mapping unassignedConsumptionAccountCode), never work in
 * progress. Only finished products, rial and final; recording it needs warehouse.production_receipt (granted to no role).
 * Through the real Express routes with real sessions; red on the code before the change (POST /documents refused every
 * production receipt with 422 PRODUCTION_RECEIPT_PROJECT_ONLY).
 */
export async function runProductionWithoutProjectTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_production_receipt_without_project_n06',
      'v10.1.6: a final rial production receipt without a project enters finished products at the entered cost or the weighted average cost, its draft voucher credits 6003 instead of 1402, a raw material, another currency or a product without cost is 422, and recording it needs warehouse.production_receipt (N-06)',
      ['n06', 'documents', 'production_receipt', 'vouchers', 'permissions'], productionWithoutProjectCase],
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

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;

interface VoucherRow { code: string; debit: number; credit: number; detailed_type: string | null; status: string }

async function productionWithoutProjectCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const priced = await f.item(0, 0);
  const withWac = await f.item(0, 1_000);
  const noCost = await f.item(0, 0);
  const forHolder = await f.item(0, 0);
  const raw = Number((await createTestItem({ type: 'raw_material', code: `N06-RM-${h.tag}-${Math.floor(Math.random() * 1e5)}`, stocks: { [f.wh]: 0 }, weightedAverageCost: 500 } as never)).id);
  const line = (itemId: number, quantity: number, unitPrice: number) => [{ itemId, quantity, unit_price: unitPrice, location: f.wh }];
  const receipt = (lines: ReturnType<typeof line>, extra: Record<string, unknown> = {}) =>
    f.doc('production_receipt', 'final', lines, { buyer_name: '', inOut: 'in', currency: 'IRR', ...extra });
  const voucherRows = async (docId: number): Promise<VoucherRow[]> => await h.q(
    `SELECT a.code, i.debit::float8 AS debit, i.credit::float8 AS credit, i.detailed_type, v.status
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 ORDER BY i.id`, [docId]) as unknown as VoucherRow[];
  const kardexCost = async (docId: number) => (await h.q(
    `SELECT unit_price::float8 AS cost FROM transactions WHERE document_id = $1 AND type = 'in' AND is_deleted = 0`, [docId]))
    .map(r => Number(r.cost));
  const expectVoucher = (label: string, rows: VoucherRow[], value: number) => {
    const debit = rows.filter(r => r.code === '1403').reduce((s, r) => s + r.debit, 0);
    const credit = rows.filter(r => r.code === '6003').reduce((s, r) => s + r.credit, 0);
    const wip = rows.filter(r => r.code === '1402').length;
    const detail = rows.find(r => r.code === '6003')?.detailed_type;
    if (debit !== value || credit !== value || wip !== 0 || detail !== 'other' || rows.some(r => r.status !== 'draft')) {
      wrong.push(`${label} posted ${JSON.stringify(rows)}, expected a draft voucher Dr 1403 ${value} / Cr 6003 ${value} (detail other) and no 1402 row`);
    }
  };

  // 1) the system admin records 4 × 150,000: stock 4 at Kardex cost 150,000, voucher Dr 1403 / Cr 6003 600,000
  const first = await h.post('/api/documents', receipt(line(priced, 4, 150_000)));
  const firstId = docIdOf(first);
  if (first.status !== 200 || !(firstId > 0)) throw new Error(`a production receipt without a project answered ${brief(first)}, expected 200`);
  const [firstRow] = await h.q(`SELECT type, status, project_id, currency FROM documents WHERE id = $1`, [firstId]);
  if (firstRow?.type !== 'production_receipt' || firstRow?.status !== 'final' || firstRow?.project_id !== null) {
    wrong.push(`the stored receipt is ${JSON.stringify(firstRow)}, expected a final production receipt without a project`);
  }
  if (await f.stock(priced) !== 4 || JSON.stringify(await kardexCost(firstId)) !== '[150000]') {
    wrong.push(`the receipt left stock ${await f.stock(priced)} with Kardex cost ${JSON.stringify(await kardexCost(firstId))}, expected 4 at [150000]`);
  }
  expectVoucher('the priced receipt', await voucherRows(firstId), 600_000);

  // 2) an empty price enters at the item's weighted average cost (1,000) and the voucher follows the Kardex value
  const atWac = await h.post('/api/documents', receipt(line(withWac, 2, 0)));
  if (atWac.status !== 200) wrong.push(`a zero-price production receipt of a product with a weighted average cost answered ${brief(atWac)}, expected 200`);
  else {
    if (await f.stock(withWac) !== 2 || JSON.stringify(await kardexCost(docIdOf(atWac))) !== '[1000]') {
      wrong.push(`the zero-price receipt left stock ${await f.stock(withWac)} with Kardex cost ${JSON.stringify(await kardexCost(docIdOf(atWac)))}, expected 2 at [1000]`);
    }
    expectVoucher('the zero-price receipt', await voucherRows(docIdOf(atWac)), 2_000);
  }

  // 3) refused before any movement: no cost, a raw material, another currency
  const refusals: Array<[string, Record<string, unknown>, string, number]> = [
    ['a zero price for a product without a weighted average cost', receipt(line(noCost, 1, 0)), 'INCOMING_LINE_WITHOUT_COST', noCost],
    ['a raw material', receipt(line(raw, 3, 500)), 'PRODUCTION_RECEIPT_PRODUCTS_ONLY', raw],
    ['a USD receipt', receipt(line(noCost, 1, 20), { currency: 'USD', exchangeRate: 600_000 }), 'PRODUCTION_RECEIPT_RIAL_ONLY', noCost],
  ];
  for (const [label, body, code, itemId] of refusals) {
    const res = await h.post('/api/documents', body);
    if (res.status !== 422 || codeOf(res) !== code) wrong.push(`${label} answered ${brief(res)}, expected 422 ${code}`);
    if (await f.stock(itemId) !== 0) wrong.push(`after ${label} the item has stock ${await f.stock(itemId)}, expected 0`);
  }

  // 4) warehouse.in alone does not record it; warehouse.production_receipt does
  const keeper = await h.sessionWith(['warehouse.view', 'warehouse.in']);
  const denied = await h.post('/api/documents', receipt(line(forHolder, 1, 90_000)), keeper);
  if (denied.status !== 403 || codeOf(denied) !== 'DOCUMENT_PERMISSION_REQUIRED') wrong.push(`warehouse.in alone answered ${brief(denied)}, expected 403 DOCUMENT_PERMISSION_REQUIRED`);
  const holder = await h.sessionWith(['warehouse.view', 'warehouse.in', 'warehouse.production_receipt']);
  const allowed = await h.post('/api/documents', receipt(line(forHolder, 1, 90_000)), holder);
  if (allowed.status !== 200 || await f.stock(forHolder) !== 1) wrong.push(`the holder of warehouse.production_receipt answered ${brief(allowed)} with stock ${await f.stock(forHolder)}, expected 200 and 1`);

  // 5) voiding the first receipt takes the stock back and drops its draft voucher
  const voided = await h.del(`/api/documents/${firstId}`);
  const left = await voucherRows(firstId);
  if (voided.status !== 200 || await f.stock(priced) !== 0 || left.length !== 0) {
    wrong.push(`voiding the receipt answered ${brief(voided)} with stock ${await f.stock(priced)} and voucher rows ${JSON.stringify(left)}, expected 200, 0 and none`);
  }

  return 'a final rial production receipt without a project entered 4 at 150,000 (voucher Dr 1403 / Cr 6003 600,000, no 1402) and 2 at the weighted average cost 1,000 (2,000); no cost, a raw material and USD were 422 with no movement; warehouse.in alone was 403 and warehouse.production_receipt recorded it; the void took the stock back and dropped the draft voucher';
}
