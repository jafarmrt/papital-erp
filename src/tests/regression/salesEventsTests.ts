import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Series 10 phase 3, lane L2 PR B5 (owner decision ت۱۱ «بله» for TD-931 / TD-935 / TD-936 and TD-933 = ب): the events of a
 * voided and of a directly final sales invoice, the VAT percent of a WooCommerce invoice and the exact amount of a full
 * return of a split line. Through the real Express routes and the WooCommerce order service; each case is red on the code
 * before its fix.
 */
export async function runSalesEventsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_invoice_void_events_td_931',
      'v10.0.36: voiding a sales invoice writes InvoiceVoided and a stock event for each reversed Kardex row, so the stock events of an item add up to its stock (TD-931)',
      ['td931', 'documents', 'events', 'void', 'package8'], invoiceVoidEventsCase],
    ['reg_direct_final_invoice_created_event_td_935',
      'v10.0.37: a sales invoice recorded final writes InvoiceCreated before InvoiceApproved, like a proforma that is finalized later (TD-935)',
      ['td935', 'documents', 'events', 'invoice', 'package8'], directFinalInvoiceEventsCase],
    ['reg_woo_invoice_vat_percent_td_936',
      'v10.0.38: a WooCommerce invoice stores the VAT percent of its order (tax ÷ net) when that percent rebuilds the tax, and its return at that percent is accepted (TD-936)',
      ['td936', 'woocommerce', 'vat', 'return', 'package15'], wooInvoiceVatPercentCase],
    ['reg_full_return_exact_remainder_td_933',
      'v10.0.39: a return that completes the quantity of an item gives back the exact remaining net of the invoice line, so the customer nets to zero (TD-933)',
      ['td933', 'documents', 'return', 'woocommerce', 'package8'], fullReturnExactRemainderCase],
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

interface OutboxRow { id: number; event_type: string; aggregate_id: string; payload: Record<string, unknown> }

async function outboxOf(h: Harness, aggregateType: string, aggregateId: number): Promise<OutboxRow[]> {
  return await h.q(
    `SELECT id, event_type, aggregate_id, payload FROM outbox_events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY id`,
    [aggregateType, String(aggregateId)],
  ) as unknown as OutboxRow[];
}

/** P5-S-08 (TD-931): voiding an invoice wrote no event, so the stock events of an item did not add up to its stock */
async function invoiceVoidEventsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(0, 400_000);
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: a, quantity: 10, unit_price: 400_000, location: f.wh }]));
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 3, unit_price: 900_000, location: f.wh }], { vatPercent: 10 }));
  const invoiceId = docIdOf(invoice);
  if (receipt.status !== 200 || invoice.status !== 200) throw new Error(`setup: receipt ${brief(receipt)}, invoice ${brief(invoice)}`);

  const voided = await h.del(`/api/documents/${invoiceId}`);
  if (voided.status !== 200) throw new Error(`setup: void ${brief(voided)}`);

  const docEvents = await outboxOf(h, 'Document', invoiceId);
  const voidEvent = docEvents.find(e => e.event_type === 'InvoiceVoided');
  if (!voidEvent) wrong.push(`the voided invoice has events ${JSON.stringify(docEvents.map(e => e.event_type))}, expected InvoiceVoided`);
  else if (Number(voidEvent.payload.totalAmount) !== 2_970_000 || voidEvent.payload.status !== 'final') {
    wrong.push(`InvoiceVoided carries total ${voidEvent.payload.totalAmount} and status ${voidEvent.payload.status}, expected 2970000 and final`);
  }

  const stockEvents = await outboxOf(h, 'Item', a);
  const net = stockEvents.reduce((sum, e) => sum + (e.event_type === 'StockReceived' ? 1 : e.event_type === 'StockIssued' ? -1 : 0) * Number(e.payload.quantity), 0);
  const reversal = stockEvents.find(e => e.event_type === 'StockReceived' && String(e.payload.referenceDocNumber ?? '').startsWith('REV-'));
  if (net !== await f.stock(a)) wrong.push(`the stock events of the item add up to ${net} (${stockEvents.map(e => `${e.event_type} ${e.payload.quantity}`).join(', ')}), its stock is ${await f.stock(a)}`);
  if (!reversal || Number(reversal.payload.quantity) !== 3) wrong.push('voiding the invoice wrote no StockReceived event for the 3 units it brought back');
  return 'a receipt of 10, an invoice of 3 and its void: the invoice gets InvoiceVoided with its payable amount, the void writes StockReceived 3 (REV-), and the stock events add up to the stock of 10';
}

/** P5-S-12 (TD-935): a final invoice recorded at once wrote only InvoiceApproved */
async function directFinalInvoiceEventsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10, 400_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }]));
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const types = (await outboxOf(h, 'Document', docIdOf(invoice))).map(e => e.event_type);
  if (JSON.stringify(types) !== JSON.stringify(['InvoiceCreated', 'InvoiceApproved'])) {
    wrong.push(`a final invoice wrote ${JSON.stringify(types)}, expected ["InvoiceCreated","InvoiceApproved"]`);
  }
  const proforma = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }]));
  const proformaTypes = (await outboxOf(h, 'Document', docIdOf(proforma))).map(e => e.event_type);
  if (JSON.stringify(proformaTypes) !== JSON.stringify(['InvoiceCreated'])) wrong.push(`a proforma wrote ${JSON.stringify(proformaTypes)}, expected ["InvoiceCreated"]`);
  return 'a final invoice writes InvoiceCreated then InvoiceApproved; a proforma writes InvoiceCreated only';
}

/** P5-S-13 (TD-936): a WooCommerce invoice had VAT percent 0 with a positive VAT amount, so its return at the real percent was 422 */
async function wooInvoiceVatPercentCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const code = `WC-TD936-${h.tag}`;
  const a = await f.item(10, 400_000);
  await h.q(`UPDATE items SET code = $1 WHERE id = $2`, [code, a]);
  const order = (wcId: string, total: string, tax: string, shipping = '0') => ({
    id: wcId, number: wcId, status: 'processing', currency: 'IRR', total, total_tax: tax,
    shipping_lines: Number(shipping) > 0 ? [{ id: 1, total: shipping }] : [],
    billing: { first_name: 'آزمون', last_name: `خریدار ${h.tag}`, phone: `0913${h.tag}`, city: 'تهران', address_1: 'آزمون' },
    line_items: [{ id: 1, name: 'قلم آزمون', sku: code, quantity: 2, price: 500000, total: '1000000' }],
  });
  const vatOf = async (docId: number) => (await h.q(`SELECT vat_percent::float8 AS pct, vat_amount::float8 AS amount FROM documents WHERE id = $1`, [docId]))[0] as { pct: number; amount: number };
  const orderIds = [`936${h.tag}1`, `936${h.tag}2`];
  try {
    return await wooVatSteps(h, f, a, order, vatOf, wrong);
  } finally {
    // the order log and the return point to the WooCommerce invoice; drop both links so the harness can remove it
    await h.q(`UPDATE documents SET return_of_document_id = NULL WHERE return_of_document_id IN
      (SELECT erp_document_id FROM woocommerce_order_logs WHERE wc_order_id = ANY($1::text[]))`, [orderIds]);
    await h.q(`DELETE FROM woocommerce_order_logs WHERE wc_order_id = ANY($1::text[])`, [orderIds]);
    await h.q(`UPDATE customers SET is_deleted = 1 WHERE name = $1`, [`آزمون خریدار ${h.tag}`]);
  }
}

async function wooVatSteps(
  h: Harness, f: Awaited<ReturnType<typeof fixture>>, a: number,
  order: (wcId: string, total: string, tax: string, shipping?: string) => Record<string, unknown>,
  vatOf: (docId: number) => Promise<{ pct: number; amount: number }>, wrong: string[],
): Promise<string> {
  const { WooOrderSyncService } = await import('../../services/woocommerce/wooOrderSync.service.js');

  // 1) tax 100,000 on 1,000,000: 10% is stored with the amount
  const r1 = await WooOrderSyncService.handleOrder(order(`936${h.tag}1`, '1100000', '100000'));
  if (r1.status !== 'processed' || !r1.docId) throw new Error(`setup: order ${r1.status} ${r1.message}`);
  const v1 = await vatOf(r1.docId);
  if (v1.pct !== 10 || v1.amount !== 100_000) wrong.push(`the WooCommerce invoice stored VAT ${JSON.stringify(v1)}, expected 10% and 100,000`);
  const ret = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: r1.docId, vatPercent: 10 }));
  if (ret.status !== 200) wrong.push(`a return of the WooCommerce invoice at 10% answered ${brief(ret)}, expected 200`);
  else {
    const rv = await vatOf(docIdOf(ret));
    if (rv.pct !== 10 || rv.amount !== 50_000) wrong.push(`the return stored VAT ${JSON.stringify(rv)}, expected 10% and 50,000`);
  }

  // 2) a tax no percent of the lines rebuilds (it holds shipping tax) keeps its amount without a percent
  const r2 = await WooOrderSyncService.handleOrder(order(`936${h.tag}2`, '1153333', '103333', '50000'));
  if (r2.status !== 'processed' || !r2.docId) wrong.push(`the order with an odd tax answered ${r2.status} ${r2.message}, expected processed`);
  else {
    const v2 = await vatOf(r2.docId);
    if (v2.pct !== 0 || v2.amount !== 103_333) wrong.push(`the invoice of the odd tax stored VAT ${JSON.stringify(v2)}, expected 0% and 103,333`);
  }
  return 'a WooCommerce order of 1,000,000 with tax 100,000 gives an invoice at 10% whose return at 10% is accepted with VAT 50,000; a tax of 103,333 that no two-decimal percent rebuilds keeps its amount at 0%';
}

/** P5-S-10 (TD-933): the full return of a split line left 0.0001 rial on the customer */
async function fullReturnExactRemainderCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) throw new Error('the trade receivables account is not mapped');
  const netOn = async (docIds: number[]) => Number((await h.q(
    `SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS net FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = ANY($1::int[]) AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2`,
    [docIds, receivable.id],
  ))[0]?.net);
  const linesOf = async (docId: number) => (await h.q(
    `SELECT quantity::float8 AS qty, unit_price::text AS price FROM document_items WHERE document_id = $1 AND is_deleted = 0 ORDER BY id`, [docId],
  )) as Array<{ qty: number; price: string }>;

  // the split line of a WooCommerce order: 1,000 for 3 = 2 x 333 + 1 x 334 (TD-297)
  const a = await f.item(0, 100);
  const stockIn = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: a, quantity: 10, unit_price: 100, location: f.wh }]));
  const split = [{ itemId: a, quantity: 2, unit_price: 333, location: f.wh }, { itemId: a, quantity: 1, unit_price: 334, location: f.wh }];
  const sale = async () => {
    const res = await h.post('/api/documents', f.doc('invoice', 'final', split));
    if (stockIn.status !== 200 || res.status !== 200) throw new Error(`setup: receipt ${brief(stockIn)}, invoice ${brief(res)}`);
    return docIdOf(res);
  };
  const giveBack = (invoiceId: number, quantity: number, status = 'final') =>
    h.post('/api/documents', f.doc('return', status, [{ itemId: a, quantity, location: f.wh }], { returnOfDocumentId: invoiceId }));

  // 1) one full return of 3: the customer nets to exactly 0
  const first = await sale();
  const full = await giveBack(first, 3);
  if (full.status !== 200) wrong.push(`the full return answered ${brief(full)}, expected 200`);
  else {
    const net = await netOn([first, docIdOf(full)]);
    if (net !== 0) wrong.push(`after the full return of the split line the customer nets ${net}, expected 0 (lines ${JSON.stringify(await linesOf(docIdOf(full)))})`);
  }

  // 2) a return of 1, then a draft of 2 finalized later: the last one completes it and the customer nets to 0
  const second = await sale();
  const one = await giveBack(second, 1);
  const rest = await giveBack(second, 2, 'draft');
  const finalized = await h.put(`/api/documents/${docIdOf(rest)}/finalize`, {});
  if (one.status !== 200 || rest.status !== 200 || finalized.status !== 200) {
    wrong.push(`the return of 1, the draft of 2 and its finalize answered ${brief(one)}, ${brief(rest)} and ${brief(finalized)}, expected 200`);
  } else {
    const net = await netOn([second, docIdOf(one), docIdOf(rest)]);
    if (net !== 0) wrong.push(`after returns of 1 and 2 the customer nets ${net}, expected 0 (lines ${JSON.stringify(await linesOf(docIdOf(rest)))})`);
  }

  // 3) a partial return keeps the net unit price
  const third = await sale();
  const partial = await giveBack(third, 2);
  const partialLines = await linesOf(docIdOf(partial));
  if (partial.status !== 200 || partialLines.length !== 1 || Number(partialLines[0].price) !== 333.3333) {
    wrong.push(`a partial return of 2 stored ${JSON.stringify(partialLines)}, expected one line at 333.3333`);
  }
  return 'an invoice of 1,000 for 3 split as 2 x 333 + 1 x 334: a full return of 3 and returns of 1 then 2 (draft finalized) each leave the customer at exactly 0; a partial return of 2 stays at 333.3333';
}
