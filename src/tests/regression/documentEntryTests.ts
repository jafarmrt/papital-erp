import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';

/**
 * Package 8 (documents and invoices), PR A: stock direction, the sellable gate and line numbers of `POST /documents`, through
 * the real Express routes with real sessions. Each case reproduces a finding of the package 8 review and is red on the
 * code before its fix.
 */
export async function runDocumentEntryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_document_direction_from_type_td_770',
      'v9.0.213: the stock direction of a document comes from its type; an inOut against the type is 422 and a transfer is not recorded through POST /documents (TD-770)',
      ['td770', 'documents', 'direction', 'package8'], directionFromTypeCase],
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

interface Fixture {
  wh: string;
  today: string;
  item(stock: number, wac?: number, stocks?: Record<string, number>): Promise<number>;
  stock(itemId: number, wh?: string): Promise<number>;
  doc(docType: string, status: string, lines: Array<Record<string, unknown>>, extra?: Record<string, unknown>): Record<string, unknown>;
}

async function fixture(h: Harness): Promise<Fixture> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const wh = String(await getDefaultWarehouseCode(orm));
  const today = await businessTodayIsoDate();
  let serial = 0;
  return {
    wh,
    today,
    async item(stock, wac = 1_000, stocks) {
      serial += 1;
      const created = await createTestItem({
        type: 'product', code: `P8A-${h.tag}-${serial}-${Math.floor(Math.random() * 1e5)}`,
        stocks: stocks ?? { [wh]: stock }, weightedAverageCost: wac,
      } as never);
      return Number(created.id);
    },
    async stock(itemId, code = wh) {
      const [row] = await h.q(
        `SELECT COALESCE(SUM(s.current_stock), 0)::float8 AS qty FROM item_warehouse_stocks s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.item_id = $1 AND w.code = $2`,
        [itemId, code],
      );
      return Number(row?.qty ?? 0);
    },
    doc(docType, status, lines, extra = {}) {
      return { docType, status, refNumber: 'auto', date: today, buyer_name: `P8 party ${h.tag}`, items: lines, ...extra };
    },
  };
}

const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 180)}`;

/** B08-01 (TD-770): «رسید» با inOut: out، فاکتور با inOut: in، پیش‌فاکتور با inOut: in و transfer از POST /documents */
async function directionFromTypeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const line = (itemId: number, qty: number, price = 1_000) => [{ itemId, quantity: qty, unit_price: price, location: f.wh }];

  // 1) inconsistent inOut: 422 DOCUMENT_DIRECTION_MISMATCH and nothing moves
  const mismatches: Array<[string, string, string]> = [
    ['receipt', 'final', 'out'], ['invoice', 'final', 'in'], ['remittance', 'final', 'in'],
    ['return', 'final', 'out'], ['invoice', 'proforma', 'in'], ['waste', 'draft', 'in'],
  ];
  for (const [docType, status, inOut] of mismatches) {
    const res = await h.post('/api/documents', f.doc(docType, status, line(a, 4), { inOut }));
    if (res.status !== 422 || (res.body as { code?: string })?.code !== 'DOCUMENT_DIRECTION_MISMATCH') {
      wrong.push(`${docType}/${status} with inOut ${inOut} answered ${brief(res)}, expected 422 DOCUMENT_DIRECTION_MISMATCH`);
    }
  }
  if (await f.stock(a) !== 10) wrong.push(`the stock moved to ${await f.stock(a)} after refused documents, expected 10`);

  // 2) a transfer is not recorded through POST /documents (400 with the Persian pointer to the transfer page)
  const transfer = await h.post('/api/documents', f.doc('transfer', 'final', line(a, 4), { inOut: 'out' }));
  const transferText = String((transfer.body as { error?: unknown; message?: unknown })?.error ?? (transfer.body as { message?: unknown })?.message ?? JSON.stringify(transfer.body));
  if (transfer.status !== 400 || !transferText.includes('انتقال بین انبارها')) wrong.push(`a transfer through POST /documents answered ${brief(transfer)}, expected 400 naming the transfer page`);
  if (await f.stock(a) !== 10) wrong.push(`the stock moved to ${await f.stock(a)} after a refused transfer, expected 10`);
  const { DocumentService } = await import('../../services/document.service.js');
  const serviceCode = await DocumentService.createDocument({ docType: 'transfer', status: 'final', date: f.today, items: line(a, 1) } as never)
    .then(() => 'recorded', (err: { code?: string }) => String(err?.code));
  if (serviceCode !== 'DOCUMENT_TYPE_NOT_RECORDABLE') wrong.push(`the document service recorded a transfer (${serviceCode}), expected DOCUMENT_TYPE_NOT_RECORDABLE`);

  // 3) consistent or missing inOut: the type decides; a receipt adds, an invoice removes, a sales voucher is issued
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', line(a, 2)));
  if (receipt.status !== 200 || await f.stock(a) !== 12) wrong.push(`a receipt without inOut answered ${brief(receipt)} and left stock ${await f.stock(a)}, expected 200 and 12`);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', line(a, 3, 5_000), { inOut: 'out' }));
  if (invoice.status !== 200 || await f.stock(a) !== 9) wrong.push(`an invoice with inOut out answered ${brief(invoice)} and left stock ${await f.stock(a)}, expected 200 and 9`);
  const remittance = await h.post('/api/documents', f.doc('remittance', 'final', line(a, 1)));
  if (remittance.status !== 200 || await f.stock(a) !== 8) wrong.push(`a remittance without inOut answered ${brief(remittance)} and left stock ${await f.stock(a)}, expected 200 and 8`);

  // 4) the permission follows the type: warehouse.out alone cannot record a receipt by sending inOut: out
  const outOnly = await h.sessionWith(['warehouse.view', 'warehouse.out']);
  const sneaky = await h.post('/api/documents', f.doc('receipt', 'final', line(a, 4), { inOut: 'out' }), outOnly);
  if (sneaky.status !== 422) wrong.push(`warehouse.out with a receipt and inOut out answered ${brief(sneaky)}, expected 422`);
  const plainReceipt = await h.post('/api/documents', f.doc('receipt', 'final', line(a, 4)), outOnly);
  if (plainReceipt.status !== 403) wrong.push(`warehouse.out recorded a receipt with ${brief(plainReceipt)}, expected 403`);
  if (await f.stock(a) !== 8) wrong.push(`the stock ended at ${await f.stock(a)}, expected 8`);
  return 'receipt/out, invoice/in, remittance/in, return/out, proforma/in and waste/in drafts are 422 and move nothing; a transfer is 400 on the route and DOCUMENT_TYPE_NOT_RECORDABLE in the service; documents without inOut move by their type; warehouse.out cannot record a receipt';
}
