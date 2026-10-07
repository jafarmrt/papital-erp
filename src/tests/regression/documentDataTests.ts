import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 8 (documents and invoices), PR E: the data of a document (who reads its treasury rows). Through the real
 * Express routes with real sessions. Each case reproduces a finding of the package 8 review and is red on the code before
 * its fix.
 */
export async function runDocumentDataTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_document_settlements_by_permission_td_781',
      'v9.0.286: a document gives its treasury rows (number, method, tracking number, bank account, description) only to treasury readers; other readers get the paid amount, the balance and the settlement status (TD-781)',
      ['td781', 'documents', 'treasury', 'settlements', 'package8'], settlementsByPermissionCase],
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

/** B08-12 (TD-781): every document reader (sales, workflow) saw the receipts' tracking number and bank */
async function settlementsByPermissionCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const bank = await createBank('P8 TD-781 bank');
  const party = `P8 party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const item = await f.item(10, 1_000);
  const sale = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: item, quantity: 1, unit_price: 2_000_000, location: f.wh }]));
  const invoiceId = docIdOf(sale);
  if (sale.status !== 200 || !invoiceId) throw new Error(`setup: invoice ${brief(sale)}`);
  const tracking = `TRK-${h.tag}`;
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 500_000, date: f.today, trackingNumber: tracking,
    description: 'P8 TD-781 private note', partyType: 'customer', partyId: customer.id, partyName: party, documentId: invoiceId,
  });
  if (![200, 201].includes(receipt.status)) throw new Error(`setup: receipt ${brief(receipt)}`);
  const [{ ref }] = await h.q(`SELECT ref_number AS ref FROM documents WHERE id = $1`, [invoiceId]) as Array<{ ref: string }>;

  type DocBody = { settlements?: Array<{ trackingNumber?: string; bankAccountId?: number }>; paidAmount?: number; remainingAmount?: number; settlementStatus?: string };
  const views = [
    ['by id', `/api/documents/${invoiceId}`],
    ['by ref', `/api/documents/by-ref/${encodeURIComponent(ref)}?type=invoice`],
  ] as const;
  const readers: Array<[string, string[], boolean]> = [
    ['documents.view', ['documents.view'], false],
    ['documents.create', ['documents.create'], false],
    ['workflow.view', ['workflow.view'], false],
    ['documents.view + accounting.treasury', ['documents.view', 'accounting.treasury'], true],
    ['documents.view + accounting.view', ['documents.view', 'accounting.view'], true],
  ];
  for (const [label, keys, seesRows] of readers) {
    const session = await h.sessionWith(keys);
    for (const [viewName, url] of views) {
      const res = await h.get(url, session);
      const body = res.body as DocBody;
      if (res.status !== 200) {
        // the by-ref lookup is not open to every document reader (TD-890); only a 200 is checked
        if (viewName === 'by id') wrong.push(`${label} read the invoice ${viewName} with ${brief(res)}, expected 200`);
        continue;
      }
      const rows = Array.isArray(body?.settlements) ? body.settlements : null;
      if (seesRows) {
        if (!rows || rows.length !== 1 || rows[0]?.trackingNumber !== tracking || Number(rows[0]?.bankAccountId) !== Number(bank.id)) {
          wrong.push(`${label} read the invoice ${viewName} without its receipt row (${JSON.stringify(rows)}), expected one row with ${tracking}`);
        }
      } else if (rows !== null || JSON.stringify(body).includes(tracking)) {
        wrong.push(`${label} read the invoice ${viewName} with its treasury rows (${JSON.stringify(rows)}), expected none`);
      }
      if (Number(body?.paidAmount) !== 500_000 || Number(body?.remainingAmount) !== 1_500_000 || body?.settlementStatus !== 'partially_paid') {
        wrong.push(`${label} read the invoice ${viewName} with paid ${body?.paidAmount}, remaining ${body?.remainingAmount}, status ${body?.settlementStatus}, expected 500000 / 1500000 / partially_paid`);
      }
    }
  }
  return `invoice ${ref} with receipt ${tracking}: documents.view, documents.create and workflow.view see paid 500000 / remaining 1500000 / partially_paid and no rows; treasury readers see the row`;
}
