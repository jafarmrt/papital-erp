import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 15 (events and integrations), TD-713 / B15-11: the sales and purchase document events carry the document's
 * payable amount (net of active lines + VAT + service charge, in the document currency, and in rials at its rate), read
 * from the stored document in the transaction that records the event. On v9.0.381 the invoice event payload had only
 * documentId, refNumber, docType, buyerName, currency, itemCount and status, so the seeded rule `payload.totalAmount gt 0`
 * never ran and the audit wrote «به مبلغ undefined».
 */
export async function runDocumentEventAmountTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_document_event_payable_amount_td_713';
  if (!shouldRun(id, 'td713', 'b15-11', 'events', 'documents', 'package15')) return results;

  const name = 'v9.0.382: invoice and purchase events carry the payable amount (net + VAT + service) in the document currency and in rials, on create and on finalize (TD-713)';
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const f = await fixture(h);
    const wrong: string[] = [];
    const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
    const record = async (label: string, body: object) => {
      const res = await h!.post('/api/documents', body);
      const docId = docIdOf(res);
      if (res.status !== 200 || !docId) throw new Error(`setup ${label}: ${brief(res)}`);
      return docId;
    };
    const eventOf = async (docId: number, eventType: string) => {
      const rows = await h!.q('SELECT payload FROM outbox_events WHERE aggregate_type = $1 AND aggregate_id = $2 AND event_type = $3 ORDER BY id DESC LIMIT 1', ['Document', String(docId), eventType]);
      return (rows[0]?.payload ?? null) as Record<string, unknown> | null;
    };
    const expectAmounts = (label: string, payload: Record<string, unknown> | null, expected: Record<string, number | null>) => {
      if (!payload) { wrong.push(`${label}: no event recorded`); return; }
      for (const [key, value] of Object.entries(expected)) {
        if (payload[key] !== value) wrong.push(`${label}: ${key} ${JSON.stringify(payload[key])}, expected ${JSON.stringify(value)}`);
      }
    };
    const item = await f.item(20, 400);

    // 1) a final rial invoice: 2 x 1,000 with a 200 line discount at 10% VAT -> net 1,800, VAT 180, payable 1,980
    const invoiceId = await record('final invoice', f.doc('invoice', 'final', [{ itemId: item, quantity: 2, unit_price: 1_000, discount: 200, location: f.wh }], { vatPercent: 10 }));
    const approved = await eventOf(invoiceId, 'InvoiceApproved');
    expectAmounts('final invoice', approved, { totalAmount: 1_980, netAmount: 1_800, vatAmount: 180, serviceChargeAmount: 0, totalAmountIrr: 1_980 });

    // 2) a draft dollar invoice: 1 x 100 USD at 10% and rate 600,000 -> 110 USD, 66,000,000 rials
    const usdId = await record('draft USD invoice', f.doc('invoice', 'draft', [{ itemId: item, quantity: 1, unit_price: 100, location: f.wh }], { currency: 'USD', exchangeRate: 600_000, vatPercent: 10 }));
    expectAmounts('draft USD invoice', await eventOf(usdId, 'InvoiceCreated'), { totalAmount: 110, netAmount: 100, vatAmount: 10, totalAmountIrr: 66_000_000 });

    // 3) a draft finalized later: the finalize event carries the amount too
    const draftId = await record('draft invoice', f.doc('invoice', 'draft', [{ itemId: item, quantity: 3, unit_price: 500, location: f.wh }], { vatPercent: 10 }));
    const finalized = await h.put(`/api/documents/${draftId}/finalize`, {});
    if (finalized.status !== 200) wrong.push(`finalize: ${brief(finalized)}`);
    else expectAmounts('finalized invoice', await eventOf(draftId, 'InvoiceApproved'), { totalAmount: 1_650, netAmount: 1_500, vatAmount: 150, totalAmountIrr: 1_650 });

    // 4) a purchase receipt carries its amount as well
    const receiptId = await record('receipt', f.doc('receipt', 'final', [{ itemId: item, quantity: 4, unit_price: 250, location: f.wh }]));
    expectAmounts('receipt', await eventOf(receiptId, 'PurchaseApproved'), { totalAmount: 1_000, netAmount: 1_000, vatAmount: 0, totalAmountIrr: 1_000 });

    // 5) the seeded rule's condition now matches an approved invoice
    const { RuleEngineService } = await import('../../services/ruleEngine.service.js');
    if (approved && !RuleEngineService.evaluate([{ field: 'payload.totalAmount', operator: 'gt', value: 0 }], { payload: approved })) {
      wrong.push('the condition payload.totalAmount gt 0 does not match the approved invoice event');
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'final, draft USD and finalized invoices and a receipt carry totalAmount / netAmount / vatAmount / totalAmountIrr; the seeded condition matches',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.cleanup();
  }
  return results;
}
