import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, docVersion, fixture } from './documentEntryTests.js';

/**
 * Series 10 phase 3, lane L2 (TD-1136): the manual invoice form sends a service charge. POST /documents and
 * PUT /documents/:id used to drop `serviceChargeAmount` (it was not in their schemas) and the edit never wrote it, so only
 * the WooCommerce sync could record one. Red on the code before the fix.
 */
export async function runInvoiceServiceChargeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_invoice_service_charge_entry_td_1136';
  if (!shouldRun(id, 'td1136', 'documents', 'invoice', 'service_charge')) return results;
  const tStart = Date.now();
  let h: Harness | undefined;
  try {
    h = await createHarness();
    const wrong: string[] = [];
    const details = await serviceChargeEntryCase(h, wrong);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name: 'v10.0.250: POST and PUT /documents record the service charge of a manual sales document, read Persian digits, keep it when not sent and refuse a negative one or one on another type (TD-1136)',
      layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name: 'v10.0.250: manual invoice service charge (TD-1136)', layer: 'regression', executionType: 'real_database',
      passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h?.cleanup();
  }
  return results;
}

async function serviceChargeEntryCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const item = await f.item(20);
  const line = [{ itemId: item, quantity: 1, unit_price: 10_000, location: f.wh }];
  const stored = async (docId: number) => Number((await h.q(`SELECT service_charge_amount::float8 AS s FROM documents WHERE id = $1`, [docId]))[0]?.s);

  const created = await h.post('/api/documents', f.doc('proforma', 'proforma', line, { serviceChargeAmount: '۳٬۵۰۰' }));
  const docId = Number((created.body as { docId?: unknown })?.docId);
  if (created.status !== 200 || !docId) throw new Error(`creating a proforma with a service charge answered ${brief(created)}`);
  if (await stored(docId) !== 3_500) wrong.push(`the created proforma stored service charge ${await stored(docId)}, expected 3500`);

  const edited = await h.put(`/api/documents/${docId}`, { version: await docVersion(h, docId), serviceChargeAmount: 1_200 });
  if (edited.status !== 200) wrong.push(`editing the service charge answered ${brief(edited)}, expected 200`);
  if (await stored(docId) !== 1_200) wrong.push(`the edited proforma stored service charge ${await stored(docId)}, expected 1200`);

  const notesOnly = await h.put(`/api/documents/${docId}`, { version: await docVersion(h, docId), notes: 'TD-1136 notes only' });
  if (notesOnly.status !== 200 || await stored(docId) !== 1_200) wrong.push(`an edit without the field answered ${brief(notesOnly)} and left ${await stored(docId)}, expected 200 and 1200`);

  const negative = await h.put(`/api/documents/${docId}`, { version: await docVersion(h, docId), serviceChargeAmount: -5 });
  if (negative.status !== 422 || (negative.body as { code?: string })?.code !== 'SERVICE_CHARGE_NEGATIVE') wrong.push(`a negative service charge answered ${brief(negative)}, expected 422 SERVICE_CHARGE_NEGATIVE`);
  const text = await h.put(`/api/documents/${docId}`, { version: await docVersion(h, docId), serviceChargeAmount: 'abc' });
  if (text.status !== 400) wrong.push(`a text service charge answered ${brief(text)}, expected 400`);

  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', line, { serviceChargeAmount: 500 }));
  if (receipt.status !== 422 || (receipt.body as { code?: string })?.code !== 'SERVICE_CHARGE_NOT_ALLOWED') wrong.push(`a receipt with a service charge answered ${brief(receipt)}, expected 422 SERVICE_CHARGE_NOT_ALLOWED`);

  const read = await h.get(`/api/documents/${docId}`);
  const payable = Number((read.body as { payableAmount?: unknown })?.payableAmount);
  if (payable !== 11_200) wrong.push(`the proforma payable amount is ${payable}, expected 11200 (lines 10000 + service charge 1200)`);
  return 'a proforma created with «۳٬۵۰۰» stores 3500, an edit stores 1200, an edit without the field keeps it, a negative one is 422, text is 400, a receipt refuses one, and the payable amount includes it';
}
