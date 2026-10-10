import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, docVersion, fixture } from './documentEntryTests.js';
import { proformaInvoiceNote } from '../../lib/documents/proformaInvoiceNote.js';

/**
 * Series 10 phase 3, lane L2 PR B2 (owner decisions ت۶ الف, ت۷ الف and TD-972 «بله»): the balance of an invoice with
 * returns, the date and number of a finalized proforma of type invoice, and the version of a document edit. Through the
 * real Express routes with real sessions; each case is red on the code before its fix.
 */
export async function runSalesBalanceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_invoice_balance_less_returns_td_909',
      'v10.0.106: the remaining amount and settlement status of an invoice count its final returns (net + VAT), never a draft or voided return (TD-909)',
      ['td909', 'documents', 'return', 'settlement', 'package8'], invoiceBalanceLessReturnsCase],
    ['reg_proforma_invoice_finalize_date_td_910',
      'v10.0.107: a proforma stored with type invoice takes the finalize day and the next invoice number when it is finalized, like type proforma (TD-910)',
      ['td910', 'documents', 'proforma', 'finalize', 'package8'], proformaInvoiceFinalizeDateCase],
    ['reg_document_edit_version_required_td_972',
      'v10.0.108: PUT /documents/:id without a version is 400 and with a stale version 409 OCC_CONFLICT; the current version saves (TD-972)',
      ['td972', 'documents', 'occ', 'version', 'package8'], documentEditVersionCase],
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

interface Balance { remainingAmount?: number; returnedAmount?: number; paidAmount?: number; settlementStatus?: string }

/** P5-S-02 (TD-909): the invoice kept the VAT-inclusive value of its returns as still to be received */
async function invoiceBalanceLessReturnsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const bank = await createBank('L2 TD-909 bank');
  const party = `P8 party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  // the stock enters through a receipt, so the Kardex holds it and a return can be voided (TD-265 reads the ledger)
  const a = await f.item(0, 400_000);
  const stockIn = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: a, quantity: 10, unit_price: 400_000, location: f.wh }], { buyer_name: `L2 TD-909 supplier ${h.tag}` }));
  if (stockIn.status !== 200) throw new Error(`setup: receipt ${brief(stockIn)}`);

  const balanceOf = async (id: number): Promise<Balance> => {
    const detail = await h.get(`/api/documents/${id}`);
    const body = ((detail.body as { data?: Balance })?.data ?? detail.body) as Balance;
    return body;
  };
  const listBalanceOf = async (id: number, ref: string): Promise<Balance | undefined> => {
    const list = await h.get(`/api/documents?type=invoice&search=${encodeURIComponent(ref)}`);
    const rows = ((list.body as { data?: Array<Balance & { id: number }> })?.data ?? []);
    return rows.find(r => r.id === id);
  };
  const expectBalance = async (id: number, ref: string, label: string, remaining: number, returned: number, status: string) => {
    for (const [where, got] of [['detail', await balanceOf(id)], ['list', await listBalanceOf(id, ref)]] as const) {
      if (got?.remainingAmount !== remaining || got?.returnedAmount !== returned || got?.settlementStatus !== status) {
        wrong.push(`${label} (${where}) shows remaining ${got?.remainingAmount}, returned ${got?.returnedAmount}, ${got?.settlementStatus}; expected ${remaining}, ${returned}, ${status}`);
      }
    }
  };

  // invoice 3 x 900,000 at 10% VAT: payable 2,970,000
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 3, unit_price: 900_000, location: f.wh }], { vatPercent: 10, partyId: customer.id, buyer_name: party }));
  const invoiceId = docIdOf(invoice);
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const ref = String((await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [invoiceId]))[0]?.ref_number);
  const giveBack = (quantity: number, status = 'final') =>
    h.post('/api/documents', f.doc('return', status, [{ itemId: a, quantity, location: f.wh }], { returnOfDocumentId: invoiceId }));

  // 1) a draft return changes nothing
  const draft = await giveBack(1, 'draft');
  if (draft.status !== 200) throw new Error(`setup: draft return ${brief(draft)}`);
  await expectBalance(invoiceId, ref, 'the invoice with a draft return', 2_970_000, 0, 'unpaid');
  const draftVoided = await h.del(`/api/documents/${docIdOf(draft)}`);
  if (draftVoided.status !== 200) throw new Error(`setup: voiding the draft return ${brief(draftVoided)}`);

  // 2) a final return of 1 (990,000 with VAT) lowers the remaining amount
  const one = await giveBack(1);
  if (one.status !== 200) throw new Error(`setup: return ${brief(one)}`);
  await expectBalance(invoiceId, ref, 'the invoice after a return of 1', 1_980_000, 990_000, 'partially_paid');

  // 3) a receipt of the rest settles the invoice, as the customer ledger nets to 0
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 1_980_000, date: f.today,
    partyType: 'customer', partyId: customer.id, partyName: party, documentId: invoiceId,
  });
  if (![200, 201].includes(receipt.status)) throw new Error(`setup: receipt ${brief(receipt)}`);
  await expectBalance(invoiceId, ref, 'the invoice after the return and the receipt', 0, 990_000, 'fully_paid');

  // 4) a voided return no longer counts
  const second = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }], { vatPercent: 10, partyId: customer.id, buyer_name: party }));
  const secondId = docIdOf(second);
  const secondRef = String((await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [secondId]))[0]?.ref_number);
  const full = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: secondId }));
  if (second.status !== 200 || full.status !== 200) throw new Error(`setup: second invoice ${brief(second)}, its return ${brief(full)}`);
  await expectBalance(secondId, secondRef, 'an invoice returned in full', 0, 990_000, 'fully_paid');
  const fullVoided = await h.del(`/api/documents/${docIdOf(full)}`);
  if (fullVoided.status !== 200) throw new Error(`setup: voiding the full return ${brief(fullVoided)}`);
  await expectBalance(secondId, secondRef, 'the invoice after its return is voided', 990_000, 0, 'unpaid');

  return 'an invoice of 2,970,000 with VAT: a draft return changes nothing, a final return of 990,000 leaves 1,980,000 partially settled, a receipt of 1,980,000 settles it; an invoice returned in full is settled and becomes unpaid again when the return is voided, in the detail and the list alike';
}

/** P5-S-03 (TD-910): a proforma recorded by a holder of documents.finalize kept its old date and number */
async function proformaInvoiceFinalizeDateCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10, 400_000);
  const head = async (id: number) => (await h.q(
    `SELECT type, status, ref_number, date::date::text AS day, notes FROM documents WHERE id = $1`, [id],
  ))[0] as { type: string; status: string; ref_number: string; day: string; notes: string | null };

  // a proforma recorded with type invoice, dated a month ago (the administrator holds documents.finalize)
  const created = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }]));
  const id = docIdOf(created);
  if (created.status !== 200) throw new Error(`setup: proforma ${brief(created)}`);
  await h.q(`UPDATE documents SET date = (date - interval '30 days') WHERE id = $1`, [id]);
  const before = await head(id);
  if (before.type !== 'invoice' || before.status !== 'proforma') throw new Error(`setup: the proforma is ${before.type}/${before.status}, expected invoice/proforma`);

  const finalized = await h.put(`/api/documents/${id}/finalize`, {});
  const after = await head(id);
  if (finalized.status !== 200) wrong.push(`finalizing the proforma answered ${brief(finalized)}, expected 200`);
  if (after.day !== f.today) wrong.push(`the finalized invoice is dated ${after.day}, expected the finalize day ${f.today} (proforma date ${before.day})`);
  if (after.ref_number === before.ref_number) wrong.push(`the finalized invoice kept the proforma number ${before.ref_number}, expected the next invoice number`);
  if (!String(after.notes ?? '').includes(proformaInvoiceNote(before.ref_number, null))) wrong.push(`the invoice notes do not name the proforma number: ${after.notes}`);
  const kardexDays = await h.q(`SELECT DISTINCT date::date::text AS day FROM transactions WHERE document_id = $1 AND is_deleted = 0`, [id]);
  if (kardexDays.length !== 1 || kardexDays[0]?.day !== f.today) wrong.push(`the Kardex rows are dated ${JSON.stringify(kardexDays)}, expected ${f.today}`);
  return `a proforma of type invoice dated ${before.day} (number ${before.ref_number}) is finalized as invoice ${after.ref_number} dated ${after.day}, its Kardex on the same day, with the proforma number in its notes`;
}

/** OBS-R1-96 (TD-972): an edit without a version overwrote a concurrent edit silently */
async function documentEditVersionCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10, 400_000);
  const created = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }]));
  const id = docIdOf(created);
  if (created.status !== 200) throw new Error(`setup: proforma ${brief(created)}`);
  const notesOf = async () => String((await h.q(`SELECT notes FROM documents WHERE id = $1`, [id]))[0]?.notes ?? '');

  const missing = await h.put(`/api/documents/${id}`, { notes: 'L2 TD-972 no version' });
  if (missing.status !== 400 || await notesOf() === 'L2 TD-972 no version') wrong.push(`an edit without a version answered ${brief(missing)} and stored notes «${await notesOf()}», expected 400 and nothing stored`);

  const seen = await docVersion(h, id);
  const first = await h.put(`/api/documents/${id}`, { version: seen, notes: 'L2 TD-972 first' });
  if (first.status !== 200) wrong.push(`the first edit with the current version answered ${brief(first)}, expected 200`);
  const stale = await h.put(`/api/documents/${id}`, { version: seen, notes: 'L2 TD-972 stale' });
  if (stale.status !== 409 || codeOf(stale) !== 'OCC_CONFLICT') wrong.push(`a second edit with the same old version answered ${brief(stale)}, expected 409 OCC_CONFLICT`);
  if (await notesOf() !== 'L2 TD-972 first') wrong.push(`after the stale edit the notes are «${await notesOf()}», expected the first edit's`);
  return 'an edit without a version is 400 and stores nothing, an edit at the current version saves, and a second edit at the same old version is 409 OCC_CONFLICT and keeps the first edit';
}
