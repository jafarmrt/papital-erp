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
      'v9.0.238: the stock direction of a document comes from its type; an inOut against the type is 422 and a transfer is not recorded through POST /documents (TD-770)',
      ['td770', 'documents', 'direction', 'package8'], directionFromTypeCase],
    ['reg_document_sellable_gate_td_775',
      'v9.0.239: create and finalize check the summed quantity of each item and warehouse against sellable stock, with or without inOut (TD-775)',
      ['td775', 'documents', 'sellable', 'reservation', 'package8'], sellableGateCase],
    ['reg_document_line_numbers_decimal_td_784',
      'v9.0.240: document line numbers are read with decimalInput: hex and exponent text is 400, an empty sent price is 400, Persian digits and thousands separators are read (TD-784)',
      ['td784', 'documents', 'decimal', 'validation', 'package8'], lineNumbersCase],
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
  const unknownCode = await DocumentService.createDocument({ docType: 'td770_unknown', status: 'final', date: f.today, items: line(a, 1) } as never)
    .then(() => 'recorded', (err: { code?: string }) => String(err?.code));
  if (unknownCode !== 'DOCUMENT_TYPE_NOT_RECORDABLE') wrong.push(`the document service recorded lines of a type without a direction (${unknownCode}), expected DOCUMENT_TYPE_NOT_RECORDABLE`);

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
  return 'receipt/out, invoice/in, remittance/in, return/out, proforma/in and waste/in drafts are 422 and move nothing; a transfer is 400 on the route and DOCUMENT_TYPE_NOT_RECORDABLE in the service, like lines of a type without a direction; documents without inOut move by their type; warehouse.out cannot record a receipt';
}

/** B08-06 (TD-775): قابل فروش ۴ (موجودی ۱۰، پیش‌فاکتور دیگری ۶): فاکتور ۵ بی inOut، دو ردیف ۴ و نهایی‌سازی پیش‌نویس دو ردیف ۴ */
async function sellableGateCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const line = (itemId: number, qty: number, location = f.wh) => ({ itemId, quantity: qty, unit_price: 5_000, location });
  const refusedWith = (res: { status: number; body?: unknown }) => res.status === 400 && (res.body as { code?: string })?.code === 'INSUFFICIENT_STOCK';
  const textOf = (res: { body?: unknown }) => String((res.body as { error?: unknown })?.error ?? (res.body as { message?: unknown })?.message ?? '');
  const stockIs = async (expected: number, after: string) => {
    const actual = await f.stock(a);
    if (actual !== expected) wrong.push(`the stock is ${actual} after ${after}, expected ${expected}`);
  };

  const proforma = await h.post('/api/documents', f.doc('invoice', 'proforma', [line(a, 6)]));
  const proformaId = Number((proforma.body as { docId?: unknown })?.docId);
  if (proforma.status !== 200 || !proformaId) throw new Error(`the reserving proforma was not recorded: ${brief(proforma)}`);

  // 1) a final invoice of 5 without inOut is refused (sellable 4) and names the reservation
  const five = await h.post('/api/documents', f.doc('invoice', 'final', [line(a, 5)]));
  if (!refusedWith(five)) wrong.push(`a final invoice of 5 without inOut answered ${brief(five)}, expected 400 INSUFFICIENT_STOCK`);
  else if (!textOf(five).includes('رزرو سایر مصارف') || !textOf(five).includes('قابل فروش')) wrong.push(`the refusal does not explain the reservation: ${textOf(five)}`);
  await stockIs(10, 'a refused invoice of 5');

  // 2) two lines of 4 of the same item are summed (8 > 4)
  const twoLines = await h.post('/api/documents', f.doc('invoice', 'final', [line(a, 4), line(a, 4)], { inOut: 'out' }));
  if (!refusedWith(twoLines)) wrong.push(`a final invoice with two lines of 4 answered ${brief(twoLines)}, expected 400 INSUFFICIENT_STOCK`);
  await stockIs(10, 'a refused invoice with two lines of 4');

  // 3) a draft with two lines of 4 is saved, but finalizing it is refused the same way
  const draft = await h.post('/api/documents', f.doc('invoice', 'draft', [line(a, 4), line(a, 4)]));
  const draftId = Number((draft.body as { docId?: unknown })?.docId);
  if (draft.status !== 200 || !draftId) wrong.push(`the draft with two lines of 4 answered ${brief(draft)}, expected 200`);
  else {
    const finalized = await h.put(`/api/documents/${draftId}/finalize`, {});
    if (!refusedWith(finalized)) wrong.push(`finalizing the draft with two lines of 4 answered ${brief(finalized)}, expected 400 INSUFFICIENT_STOCK`);
    await stockIs(10, 'a refused finalize');
  }

  // 4) within sellable passes, and the proforma that holds the reservation still finalizes against its own reservation
  const four = await h.post('/api/documents', f.doc('invoice', 'final', [line(a, 4)]));
  if (four.status !== 200) wrong.push(`a final invoice of 4 answered ${brief(four)}, expected 200`);
  await stockIs(6, 'an invoice of 4');
  const finProforma = await h.put(`/api/documents/${proformaId}/finalize`, {});
  if (finProforma.status !== 200) wrong.push(`finalizing the reserving proforma of 6 answered ${brief(finProforma)}, expected 200`);
  await stockIs(0, 'finalizing the proforma');

  // 5) each warehouse is checked on its own stock: 3 + 5 from two warehouses passes, 4 from the first is refused
  const { createTestWarehouse } = await import('../fixtures/factories.js');
  const second = await createTestWarehouse({ name: `P8 second warehouse ${h.tag}` });
  const b = await f.item(0, 1_000, { [f.wh]: 3, [String(second.code)]: 5 });
  const tooMany = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: b, quantity: 4, location: f.wh }]));
  if (!refusedWith(tooMany)) wrong.push(`a remittance of 4 from a warehouse holding 3 answered ${brief(tooMany)}, expected 400 INSUFFICIENT_STOCK`);
  const split = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: b, quantity: 3, location: f.wh }, { itemId: b, quantity: 5, location: second.code }]));
  if (split.status !== 200) wrong.push(`a remittance of 3 + 5 from two warehouses answered ${brief(split)}, expected 200`);
  const left = (await f.stock(b)) + (await f.stock(b, String(second.code)));
  if (left !== 0) wrong.push(`the two-warehouse item has ${left} left, expected 0`);
  return 'with sellable 4 an invoice of 5 without inOut, two lines of 4 and the finalize of a draft with two lines of 4 are 400 and move nothing; 4 passes and the reserving proforma finalizes; each warehouse is checked on its own stock';
}

/** B08-15 (TD-784): «0x10» شانزده و «1e3» هزار خوانده می‌شد، قیمت خالی صفر، و «۲» رد می‌شد */
async function lineNumbersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const lineOf = (fields: Record<string, unknown>) => [{ itemId: a, location: f.wh, ...fields }];
  const fieldOf = (res: { body?: unknown }) => ((res.body as { details?: { issues?: Array<{ path?: string }> } })?.details?.issues ?? []).map(i => i.path).join(',');

  // 1) text that Number() reads as a number is refused with 400 on its field, and nothing moves
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ['quantity 0x10', { quantity: '0x10', unit_price: 1_000 }, 'quantity'],
    ['quantity 1e3', { quantity: '1e3', unit_price: 1_000 }, 'quantity'],
    ['unit_price 0x3E8', { quantity: 1, unit_price: '0x3E8' }, 'unit_price'],
    ['unit_price empty', { quantity: 1, unit_price: '' }, 'unit_price'],
    ['unitPrice empty', { quantity: 1, unitPrice: '  ' }, 'unitPrice'],
    ['discount 1e2', { quantity: 1, unit_price: 1_000, discount: '1e2' }, 'discount'],
  ];
  for (const [label, fields, field] of refused) {
    const res = await h.post('/api/documents', f.doc('receipt', 'final', lineOf(fields)));
    if (res.status !== 400 || !fieldOf(res).includes(field)) wrong.push(`a receipt line with ${label} answered ${brief(res)}, expected 400 on ${field}`);
  }
  const draft = await h.post('/api/documents', f.doc('invoice', 'draft', lineOf({ quantity: 1, unit_price: '' })));
  if (draft.status !== 400) wrong.push(`a draft invoice with an empty price answered ${brief(draft)}, expected 400`);
  if (await f.stock(a) !== 10) wrong.push(`the stock moved to ${await f.stock(a)} after refused lines, expected 10`);

  // 2) Persian digits and thousands separators are read
  const persian = await h.post('/api/documents', f.doc('receipt', 'final', lineOf({ quantity: '۲', unit_price: '1,000', discount: '۱۰۰' })));
  const docId = Number((persian.body as { docId?: unknown })?.docId);
  if (persian.status !== 200 || !docId) wrong.push(`a receipt with quantity ۲, price 1,000 and discount ۱۰۰ answered ${brief(persian)}, expected 200`);
  else {
    const [stored] = await h.q('SELECT quantity::float8 AS q, unit_price::float8 AS p, discount::float8 AS d FROM document_items WHERE document_id = $1 AND is_deleted = 0', [docId]);
    if (Number(stored?.q) !== 2 || Number(stored?.p) !== 1000 || Number(stored?.d) !== 100) wrong.push(`the line was stored as ${JSON.stringify(stored)}, expected quantity 2, price 1000, discount 100`);
  }
  if (await f.stock(a) !== 12) wrong.push(`the stock is ${await f.stock(a)} after a receipt of ۲, expected 12`);

  // 3) a line without a price is still accepted (price 0), as before
  const noPrice = await h.post('/api/documents', f.doc('remittance', 'final', [{ itemId: a, quantity: 1, location: f.wh }]));
  if (noPrice.status !== 200) wrong.push(`a remittance line without a price answered ${brief(noPrice)}, expected 200`);
  return 'quantity 0x10 and 1e3, price 0x3E8, an empty sent price and discount 1e2 are 400 on their field and move nothing; quantity ۲, price 1,000 and discount ۱۰۰ are stored as 2, 1000 and 100; a line without a price is accepted';
}
