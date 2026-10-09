import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Lane L1 guide finding TD-1122 (v10.0.40 on): the treasury page could only move a receipt on account; the server move to
 * another document (TD-779) had no screen. GET /accounting/treasury/:id/document-options lists exactly the documents the
 * move accepts: live, same side, same currency, same party, the current one left out. Red before: the route was 404.
 */
export async function runTreasuryRelinkOptionsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_treasury_relink_options_td_1122';
  if (!shouldRun(id, 'td1122', 'treasury', 'documents')) return results;
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    const details = await relinkOptionsCase(h, wrong);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id, name: 'TD-1122: the move-to-another-document window lists only the documents the move accepts', layer: 'regression', executionType: 'real_api', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name: 'TD-1122: the move-to-another-document window lists only the documents the move accepts', layer: 'regression', executionType: 'real_api',
      passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.cleanup();
  }
  return results;
}

async function relinkOptionsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const bank = await createBank('L1 TD-1122 bank');
  const party = `L1 relink party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const a = await f.item(20, 1_000);
  const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
  const sale = async (extra: Record<string, unknown> = {}) => docIdOf(await h.post('/api/documents',
    f.doc('invoice', 'final', [{ itemId: a, quantity: 1, unit_price: 2_000_000, location: f.wh }], { buyer_name: party, partyId: customer.id, ...extra })));

  const first = await sale();
  const second = await sale();
  const voided = await sale();
  await h.del(`/api/documents/${voided}`);
  const otherParty = docIdOf(await h.post('/api/documents',
    f.doc('invoice', 'final', [{ itemId: a, quantity: 1, unit_price: 2_000_000, location: f.wh }], { buyer_name: `L1 other ${h.tag}` })));
  const dollar = await sale({ currency: 'USD', exchangeRate: 1_000_000 });

  for (const [label, docId] of [['first', first], ['second', second], ['voided', voided], ['other party', otherParty], ['USD', dollar]] as const) {
    if (!(docId > 0)) throw new Error(`setup: the ${label} invoice was not recorded`);
  }
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 2_000_000, date: f.today,
    partyType: 'customer', partyId: customer.id, partyName: party, documentId: first,
  });
  const receiptId = Number((receipt.body as { id?: unknown })?.id);
  if (![200, 201].includes(receipt.status) || !receiptId) throw new Error(`setup: receipt ${brief(receipt)}`);

  const reader = await h.sessionWith(['accounting.view']);
  const denied = await h.get(`/api/accounting/treasury/${receiptId}/document-options`, reader);
  if (denied.status !== 403) wrong.push(`accounting.view read the options: ${brief(denied)}, expected 403`);

  const res = await h.get(`/api/accounting/treasury/${receiptId}/document-options`);
  const ids = Array.isArray(res.body) ? (res.body as Array<{ id: number }>).map(r => Number(r.id)) : [];
  if (res.status !== 200) wrong.push(`options answered ${brief(res)}, expected 200`);
  if (!ids.includes(second)) wrong.push(`options ${JSON.stringify(ids)} miss the other invoice ${second} of the party`);
  for (const [label, docId] of [['current', first], ['voided', voided], ['other party', otherParty], ['USD', dollar]] as const) {
    if (ids.includes(docId)) wrong.push(`options list the ${label} document ${docId}`);
  }
  const moved = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: second });
  if (moved.status !== 200) wrong.push(`moving to a listed document answered ${brief(moved)}, expected 200`);
  return 'options list the other live invoice of the party in the same currency, not the current, voided, other-party or USD one; accounting.view is refused; the move to a listed document is accepted';
}
