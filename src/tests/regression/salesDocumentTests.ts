import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 8 (documents and invoices), PR B: the money of sales documents (zero-price invoices, voiding an invoice that has
 * returns or receipts, the VAT and amount of a sales return), through the real Express routes with real sessions. Each case
 * reproduces a finding of the package 8 review and is red on the code before its fix.
 */
export async function runSalesDocumentTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_zero_price_invoice_voucher_td_772',
      'v9.0.243: a final sales invoice with zero gross gets a voucher that moves its Kardex cost from inventory to cost of sales (TD-772)',
      ['td772', 'documents', 'voucher', 'cogs', 'package8'], zeroPriceInvoiceCase],
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

interface VoucherRow { accountId: number; code: string; debit: number; credit: number }

/** Active rows of the active voucher(s) issued for a document, and how many such vouchers there are */
async function documentVoucher(h: Harness, docId: number): Promise<{ count: number; rows: VoucherRow[] }> {
  const vouchers = await h.q(`SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [docId]);
  const rows = await h.q(
    `SELECT i.account_id AS "accountId", a.code, i.debit::float8 AS debit, i.credit::float8 AS credit
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 ORDER BY i.id`,
    [docId],
  );
  return { count: vouchers.length, rows: rows as unknown as VoucherRow[] };
}

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
const rowsText = (rows: VoucherRow[]) => rows.map(r => `${r.code} ${r.debit}/${r.credit}`).join(', ') || 'none';

/** B08-03 (TD-772): a final invoice at price 0 left stock at WAC but had no voucher */
async function zeroPriceInvoiceCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const cogs = await AccountMappingService.getCostOfGoodsSoldAccount();
  const finished = await AccountMappingService.getInventoryFinishedGoodsAccount();
  if (!cogs || !finished) throw new Error('the cost of sales or finished goods account is not mapped');

  const expectCostOnly = async (docId: number, cost: number, label: string) => {
    const { count, rows } = await documentVoucher(h, docId);
    const debitCogs = rows.filter(r => r.accountId === cogs.id).reduce((s, r) => s + r.debit, 0);
    const creditStock = rows.filter(r => r.accountId === finished.id).reduce((s, r) => s + r.credit, 0);
    const others = rows.filter(r => r.accountId !== cogs.id && r.accountId !== finished.id);
    if (count !== 1 || Math.abs(debitCogs - cost) > 0.001 || Math.abs(creditStock - cost) > 0.001 || others.length > 0) {
      wrong.push(`${label}: ${count} voucher(s) with rows ${rowsText(rows)}, expected one voucher with cost of sales ${cost} debit and finished goods ${cost} credit only`);
    }
  };

  // 1) a final invoice of 2 units at price 0, WAC 50,000: Dr cost of sales 100,000 / Cr finished goods 100,000
  const a = await f.item(10, 50_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 2, unit_price: 0, location: f.wh }]));
  if (invoice.status !== 200) wrong.push(`a zero-price final invoice answered ${brief(invoice)}, expected 200`);
  else await expectCostOnly(docIdOf(invoice), 100_000, 'zero-price final invoice');

  // 2) a zero-price proforma finalized into an invoice gets the same voucher
  const b = await f.item(10, 30_000);
  const proforma = await h.post('/api/documents', f.doc('proforma', 'proforma', [{ itemId: b, quantity: 1, unit_price: 0, location: f.wh }]));
  const proformaId = docIdOf(proforma);
  const finalized = await h.put(`/api/documents/${proformaId}/finalize`, {});
  if (proforma.status !== 200 || finalized.status !== 200) wrong.push(`a zero-price proforma and its finalize answered ${brief(proforma)} and ${brief(finalized)}, expected 200 and 200`);
  else await expectCostOnly(proformaId, 30_000, 'finalized zero-price proforma');

  return 'a final invoice of 2 units at price 0 and WAC 50,000, and a finalized zero-price proforma, each get one voucher: Dr cost of sales / Cr finished goods at the Kardex cost, with no revenue or customer row';
}
