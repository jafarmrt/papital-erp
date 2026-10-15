import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import type { SalesReport, SalesReportRow } from '../../lib/reports/salesReport.js';

/** the online channel's label as the report shows it */
const ONLINE_CHANNEL_LABEL = 'فروشگاه برخط';

/**
 * Series 10.1, D-03 PR1 (reports plan §2, owner decisions t2 to t6): the sales report of the management reports page.
 * Through the real Express routes with real sessions; every case is red on the code before the report (404).
 */
export async function runSalesReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_sales_report_totals_d03',
      'v10.1.8: the sales report counts final invoices at their own date less final returns at theirs, a foreign invoice at its own rate, never a voided invoice or a proforma, with Kardex cost and every breakdown (D-03)',
      ['d03', 'reports', 'sales', 'return', 'currency'], salesTotalsCase],
    ['reg_sales_report_access_d03',
      'v10.1.8: GET /reports/sales needs reports.sales; cost and gross profit only for item cost readers, the ledger line only for ledger readers, and invalid ranges are refused (D-03)',
      ['d03', 'reports', 'sales', 'permission'], salesAccessCase],
    ['reg_sales_report_ledger_check_d03',
      'v10.1.8: the ledger line of the sales report moves with an invoice and its return like the report, and a manual voucher on the sales revenue account shows as the difference (D-03)',
      ['d03', 'reports', 'sales', 'ledger'], salesLedgerCase],
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

async function report(h: Harness, query: string, session = h.admin): Promise<SalesReport> {
  const res = await h.get(`/api/reports/sales?${query}`, session);
  if (res.status !== 200) throw new Error(`GET /api/reports/sales?${query} answered ${brief(res)}`);
  return res.body as SalesReport;
}

function expectEqual(wrong: string[], label: string, got: unknown, expected: unknown): void {
  if (String(got) !== String(expected)) wrong.push(`${label}: got ${String(got)}, expected ${String(expected)}`);
}

const rowOf = (r: SalesReport, key: string): SalesReportRow | undefined => r.rows.find(row => row.group.key === key);

/** Invoice 1 (rial), its partial return, a foreign invoice, a voided invoice and a proforma of one customer */
async function salesTotalsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
  const party = `D03 sales party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const category = `D03 category ${h.tag}`;
  const a = Number((await createTestItem({ type: 'product', code: `D03A-${h.tag}`, name: `D03 item A ${h.tag}`, category, stocks: { [f.wh]: 10 }, weightedAverageCost: 400_000 })).id);
  const b = await f.item(10, 200_000);
  const sale = (lines: Array<{ itemId: number; quantity: number; unit_price: number; discount?: number }>, extra: Record<string, unknown> = {}) =>
    h.post('/api/documents', f.doc('invoice', 'final', lines.map(l => ({ ...l, location: f.wh })), { partyId: customer.id, buyer_name: party, ...extra }));

  const one = await sale([{ itemId: a, quantity: 3, unit_price: 900_000 }, { itemId: b, quantity: 2, unit_price: 500_000, discount: 100_000 }], { vatPercent: 10 });
  if (one.status !== 200) throw new Error(`setup: invoice 1 ${brief(one)}`);
  const back = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: docIdOf(one) }));
  if (back.status !== 200) throw new Error(`setup: return ${brief(back)}`);
  const euro = await sale([{ itemId: b, quantity: 1, unit_price: 10 }], { currency: 'EUR', exchangeRate: 500_000 });
  if (euro.status !== 200) throw new Error(`setup: foreign invoice ${brief(euro)}`);
  const voided = await sale([{ itemId: a, quantity: 1, unit_price: 900_000 }]);
  if (voided.status !== 200) throw new Error(`setup: invoice to void ${brief(voided)}`);
  const voidRes = await h.del(`/api/documents/${docIdOf(voided)}`);
  if (voidRes.status !== 200) throw new Error(`setup: voiding ${brief(voidRes)}`);
  const proforma = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }], { partyId: customer.id, buyer_name: party }));
  if (proforma.status !== 200) throw new Error(`setup: proforma ${brief(proforma)}`);
  // the foreign invoice came from the online shop
  await h.q(`INSERT INTO woocommerce_order_logs (wc_order_id, erp_document_id, status) VALUES ($1, $2, 'processed')`, [`D03-${h.tag}-${docIdOf(euro)}`, docIdOf(euro)]);

  const base = `from=${f.today}&to=${f.today}&partyId=${customer.id}`;

  // 1) by item, all currencies in rials: b 2 x 500,000 less 100,000 + 10 EUR x 500,000; a 3 x 900,000 less a return of 900,000
  const byItem = await report(h, `${base}&groupBy=item`);
  const t = byItem.totals;
  expectEqual(wrong, 'gross', t.gross, 8_700_000);
  expectEqual(wrong, 'discount', t.discount, 100_000);
  expectEqual(wrong, 'net', t.net, 8_600_000);
  expectEqual(wrong, 'returns', t.returnAmount, 900_000);
  expectEqual(wrong, 'net after returns', t.netAfterReturns, 7_700_000);
  expectEqual(wrong, 'invoice count', t.invoiceCount, 2);
  expectEqual(wrong, 'return count', t.returnCount, 1);
  expectEqual(wrong, 'VAT', t.vat, 360_000);
  expectEqual(wrong, 'return VAT', t.returnVat, 90_000);
  // Kardex cost: a 3 x 400,000 less 1 x 400,000 returned, b 3 x 200,000
  expectEqual(wrong, 'cost', t.cost, 1_400_000);
  expectEqual(wrong, 'gross profit', t.grossProfit, 6_300_000);
  expectEqual(wrong, 'quantity without an item filter', t.quantity, null);
  expectEqual(wrong, 'item rows', byItem.rows.map(r => r.group.key).join(','), `${b},${a}`);
  const rowA = rowOf(byItem, String(a));
  expectEqual(wrong, 'item A quantity', rowA?.quantity, 3);
  expectEqual(wrong, 'item A returned quantity', rowA?.returnQuantity, 1);
  expectEqual(wrong, 'item A net after returns', rowA?.netAfterReturns, 1_800_000);
  expectEqual(wrong, 'item B invoices', rowOf(byItem, String(b))?.invoiceCount, 2);
  expectEqual(wrong, 'ledger line with a party filter', byItem.ledgerUnavailable, 'filtered');
  expectEqual(wrong, 'top customer', byItem.topCustomers.map(c => c.label).join(','), party);
  expectEqual(wrong, 'top items', byItem.topItems.map(i => i.key).join(','), `${b},${a}`);

  // 2) one currency: only its documents at their own amounts, the rial Kardex cost at the document rate
  const inEuro = await report(h, `${base}&currency=EUR`);
  expectEqual(wrong, 'EUR net', inEuro.totals.netAfterReturns, 10);
  expectEqual(wrong, 'EUR cost', inEuro.totals.cost, 0.4);
  const inRial = await report(h, `${base}&currency=IRR`);
  expectEqual(wrong, 'IRR net after returns', inRial.totals.netAfterReturns, 2_700_000);

  // 3) channel, period, two breakdowns, a category filter and the comparison
  const byChannel = await report(h, `${base}&groupBy=channel`);
  expectEqual(wrong, 'online channel', rowOf(byChannel, 'online')?.netAfterReturns, 5_000_000);
  expectEqual(wrong, 'direct channel', rowOf(byChannel, 'direct')?.netAfterReturns, 2_700_000);
  expectEqual(wrong, 'online label', rowOf(byChannel, 'online')?.group.label, ONLINE_CHANNEL_LABEL);
  const byPeriod = await report(h, `${base}&groupBy=period&period=quarter`);
  expectEqual(wrong, 'one quarter row', byPeriod.rows.length, 1);
  expectEqual(wrong, 'quarter net', byPeriod.rows[0]?.netAfterReturns, 7_700_000);
  const twoWays = await report(h, `${base}&groupBy=customer&thenBy=item`);
  expectEqual(wrong, 'customer x item rows', twoWays.rows.map(r => `${r.group.label}/${r.then?.key}`).join(','), `${party}/${b},${party}/${a}`);
  const byCategory = await report(h, `${base}&groupBy=category&category=${encodeURIComponent(category)}`);
  expectEqual(wrong, 'category rows', byCategory.rows.map(r => r.group.label).join(','), category);
  expectEqual(wrong, 'category net', byCategory.totals.netAfterReturns, 1_800_000);
  expectEqual(wrong, 'VAT with a category filter', byCategory.totals.vat, null);
  const oneItem = await report(h, `${base}&itemId=${a}&groupBy=customer`);
  expectEqual(wrong, 'quantity with an item filter', oneItem.totals.quantity, 3);
  const compared = await report(h, `${base}&compare=previous`);
  expectEqual(wrong, 'comparison of one day', `${compared.comparison?.range.to}`, new Date(Date.parse(`${f.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
  expectEqual(wrong, 'previous net of a row', compared.rows[0]?.previousNetAfterReturns, 0);
  expectEqual(wrong, 'change without a base', compared.rows[0]?.changePercent, null);

  // 4) paging, a page past the end and the export
  const firstPage = await report(h, `${base}&limit=1`);
  expectEqual(wrong, 'paged rows', `${firstPage.rows.length}/${firstPage.total}`, '1/2');
  const pastEnd = await report(h, `${base}&page=5&limit=1`);
  expectEqual(wrong, 'page past the end', `${pastEnd.rows.length}/${pastEnd.total}`, '0/2');
  const exported = await report(h, `${base}&limit=1&export=true`);
  expectEqual(wrong, 'export rows', exported.rows.length, 2);

  // 5) a foreign invoice without a rate leaves the rial view and is counted
  await h.q(`UPDATE documents SET exchange_rate = NULL WHERE id = $1`, [docIdOf(euro)]);
  const unconverted = await report(h, base);
  expectEqual(wrong, 'net without the unconverted invoice', unconverted.totals.netAfterReturns, 2_700_000);
  expectEqual(wrong, 'unconverted documents', unconverted.unconvertedDocuments, 1);
  return 'one customer: 8,700,000 gross, 100,000 discount, a 900,000 return, 7,700,000 net after returns and 6,300,000 gross profit; EUR and IRR views, channel, quarter, customer x item, category, item filter, comparison, paging, export and an invoice without a rate all as expected';
}

async function salesAccessCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const query = `from=${f.today}&to=${f.today}`;
  const none = await h.sessionWith(['documents.view']);
  const denied = await h.get(`/api/reports/sales?${query}`, none);
  if (denied.status !== 403) wrong.push(`a user without reports.sales got ${brief(denied)}, expected 403`);

  const reader = await h.sessionWith(['reports.sales']);
  const plain = await report(h, query, reader);
  expectEqual(wrong, 'cost visible without a cost key', plain.costVisible, false);
  expectEqual(wrong, 'total cost without a cost key', plain.totals.cost, null);
  expectEqual(wrong, 'gross profit without a cost key', plain.totals.grossProfit, null);
  expectEqual(wrong, 'ledger without a ledger key', plain.ledgerUnavailable, 'no_access');

  const costReader = await h.sessionWith(['reports.sales', 'products.view']);
  expectEqual(wrong, 'cost visible with products.view', (await report(h, query, costReader)).costVisible, true);
  const ledgerReader = await h.sessionWith(['reports.sales', 'accounting.reports']);
  const withLedger = await report(h, query, ledgerReader);
  if (!withLedger.ledger) wrong.push(`a ledger reader got no ledger line (${String(withLedger.ledgerUnavailable)})`);

  const refused = async (q: string, code: string) => {
    const res = await h.get(`/api/reports/sales?${q}`, reader);
    if (res.status !== 422 || (res.body as { code?: string })?.code !== code) wrong.push(`${q} answered ${brief(res)}, expected 422 ${code}`);
  };
  await refused('from=2026-10-10&to=2026-10-01', 'REPORT_RANGE_INVALID');
  await refused(`${query}&groupBy=item&thenBy=item`, 'REPORT_DIMENSIONS_SAME');
  await refused('from=1990-01-01&to=2026-01-01&groupBy=period&period=month', 'REPORT_PERIODS_TOO_MANY');
  const badKey = await h.get(`/api/reports/sales?${query}&unknown=1`, reader);
  if (badKey.status !== 400) wrong.push(`an unknown query key answered ${brief(badKey)}, expected 400`);
  return 'no reports.sales: 403; reports.sales alone: no cost, no gross profit, no ledger line; products.view adds the cost and accounting.reports the ledger line; an inverted range, two equal breakdowns and too many periods are 422';
}

async function salesLedgerCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const query = `from=${f.today}&to=${f.today}&groupBy=channel`;
  const before = await report(h, query);
  if (!before.ledger) throw new Error(`setup: no ledger line for the administrator (${String(before.ledgerUnavailable)})`);
  const codes = before.ledger.accounts.map(acc => acc.code);
  if (!codes.includes('5001') || !codes.includes('5101')) wrong.push(`ledger accounts ${codes.join(',')}, expected 5001 and 5101 among them`);

  const a = await f.item(10, 300_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 2, unit_price: 700_000, discount: 50_000, location: f.wh }]));
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const back = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: docIdOf(invoice) }));
  if (back.status !== 200) throw new Error(`setup: return ${brief(back)}`);
  const after = await report(h, query);
  const delta = (x: string | undefined, y: string | undefined) => Number(x ?? 0) - Number(y ?? 0);
  // 1,400,000 less 50,000 discount, less a return of one unit at its net 675,000
  expectEqual(wrong, 'report growth', delta(after.totals.netAfterReturns, before.totals.netAfterReturns), 675_000);
  expectEqual(wrong, 'ledger growth', delta(after.ledger?.ledgerTotal, before.ledger.ledgerTotal), 675_000);
  expectEqual(wrong, 'difference after the invoice', after.ledger?.difference, before.ledger.difference);

  const [revenue] = await h.q(`SELECT id FROM accounts WHERE code = '5001' AND is_deleted = 0`);
  const [cash] = await h.q(`SELECT id FROM accounts WHERE code = '1001' AND is_deleted = 0`);
  const manual = await h.post('/api/accounting/vouchers', {
    date: f.today, status: 'draft', description: `D03 manual sale ${h.tag}`,
    items: [{ accountId: Number(cash?.id), debit: 30_000, credit: 0 }, { accountId: Number(revenue?.id), debit: 0, credit: 30_000 }],
  });
  if (manual.status !== 201) throw new Error(`setup: manual voucher ${brief(manual)}`);
  const withManual = await report(h, query);
  expectEqual(wrong, 'draft growth by the manual voucher', delta(withManual.ledger?.draft, after.ledger?.draft), 30_000);
  expectEqual(wrong, 'difference after the manual voucher', delta(withManual.ledger?.difference, after.ledger?.difference), -30_000);
  return 'an invoice of 1,350,000 net and a return of 675,000 raise the report and the ledger by 675,000 alike; a manual draft voucher of 30,000 on 5001 lowers the difference by 30,000';
}
