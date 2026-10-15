import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import type { PurchaseReport, PurchaseReportRow } from '../../lib/reports/purchaseReport.js';
import type { DashboardSummary, SalesChartSeries } from '../../lib/reports/reportCharts.js';

/**
 * Series 10.1, D-03 PR4 (reports plan §5 and §6.3, owner decisions t14 to t16): the purchase report, the sales chart
 * series and the dashboard sales widget. Through the real Express routes with real sessions; every case is red on the
 * code before this change (404).
 */
export async function runPurchaseReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_purchase_report_totals_d03',
      'v10.1.15: the purchase report counts final receipts and purchases of a supplier at their own date, a foreign one at its own rate, never a voided, draft or proforma receipt, with every breakdown (D-03)',
      ['d03', 'reports', 'purchase', 'currency'], purchaseTotalsCase],
    ['reg_purchase_report_access_d03',
      'v10.1.15: GET /reports/purchases needs reports.purchases, which also opens the supplier and item pick lists, and invalid ranges are refused (D-03)',
      ['d03', 'reports', 'purchase', 'permission'], purchaseAccessCase],
    ['reg_sales_charts_d03',
      'v10.1.15: GET /reports/sales/charts gives the sales trend by period and the category shares with the sales report rule, only to reports.sales (D-03)',
      ['d03', 'reports', 'sales', 'charts'], salesChartsCase],
    ['reg_dashboard_sales_summary_d03',
      'v10.1.15: GET /reports/dashboard-summary gives the month sales only to reports.sales and the receivables only to accounting.reports, and moves with a new invoice (D-03)',
      ['d03', 'reports', 'dashboard', 'permission'], dashboardSummaryCase],
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

/** the category the test item factory gives an item without one */
const DEFAULT_ITEM_CATEGORY = 'دستبند';

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);

async function getOk<T>(h: Harness, url: string, session = h.admin): Promise<T> {
  const res = await h.get(url, session);
  if (res.status !== 200) throw new Error(`GET ${url} answered ${brief(res)}`);
  return res.body as T;
}

const purchases = (h: Harness, query: string, session = h.admin) => getOk<PurchaseReport>(h, `/api/reports/purchases?${query}`, session);

function expectEqual(wrong: string[], label: string, got: unknown, expected: unknown): void {
  if (String(got) !== String(expected)) wrong.push(`${label}: got ${String(got)}, expected ${String(expected)}`);
}

const rowOf = (r: PurchaseReport, key: string): PurchaseReportRow | undefined => r.rows.find(row => row.group.key === key);

/** A rial receipt, a foreign purchase, a voided receipt, a draft and a purchase proforma of one supplier */
async function purchaseTotalsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
  const name = `D03 supplier ${h.tag}`;
  const supplier = await createTestCustomer({ name, partyType: 'supplier' });
  const category = `D03 purchase category ${h.tag}`;
  const a = Number((await createTestItem({ type: 'raw_material', code: `D03P-${h.tag}`, name: `D03 material A ${h.tag}`, category, stocks: { [f.wh]: 10 }, weightedAverageCost: 100_000 } as never)).id);
  const b = await f.item(10, 50_000);
  const buy = (type: string, status: string, lines: Array<{ itemId: number; quantity: number; unit_price: number; discount?: number }>, extra: Record<string, unknown> = {}) =>
    h.post('/api/documents', f.doc(type, status, lines.map(l => ({ ...l, location: f.wh })), { partyId: supplier.id, buyer_name: name, ...extra }));

  const receipt = await buy('receipt', 'final', [{ itemId: a, quantity: 4, unit_price: 100_000 }, { itemId: b, quantity: 2, unit_price: 50_000, discount: 20_000 }]);
  if (receipt.status !== 200) throw new Error(`setup: receipt ${brief(receipt)}`);
  const euro = await buy('receipt', 'final', [{ itemId: b, quantity: 1, unit_price: 10 }], { currency: 'EUR', exchangeRate: 500_000 });
  if (euro.status !== 200) throw new Error(`setup: foreign receipt ${brief(euro)}`);
  const voided = await buy('receipt', 'final', [{ itemId: a, quantity: 1, unit_price: 100_000 }]);
  if (voided.status !== 200) throw new Error(`setup: receipt to void ${brief(voided)}`);
  const voidRes = await h.del(`/api/documents/${docIdOf(voided)}`);
  if (voidRes.status !== 200) throw new Error(`setup: voiding ${brief(voidRes)}`);
  const draft = await buy('receipt', 'draft', [{ itemId: a, quantity: 1, unit_price: 100_000 }]);
  if (draft.status !== 200) throw new Error(`setup: draft receipt ${brief(draft)}`);
  const proforma = await buy('receipt', 'proforma', [{ itemId: a, quantity: 1, unit_price: 100_000 }]);
  if (proforma.status !== 200) throw new Error(`setup: purchase proforma ${brief(proforma)}`);

  const base = `from=${f.today}&to=${f.today}&partyId=${supplier.id}`;

  // 1) by supplier, all currencies in rials: a 4 x 100,000; b 2 x 50,000 less 20,000; b 10 EUR x 500,000
  const bySupplier = await purchases(h, base);
  const t = bySupplier.totals;
  expectEqual(wrong, 'gross', t.gross, 5_500_000);
  expectEqual(wrong, 'discount', t.discount, 20_000);
  expectEqual(wrong, 'net', t.net, 5_480_000);
  expectEqual(wrong, 'document count', t.documentCount, 2);
  expectEqual(wrong, 'quantity without an item filter', t.quantity, null);
  expectEqual(wrong, 'supplier rows', bySupplier.rows.map(r => r.group.label).join(','), name);
  expectEqual(wrong, 'top supplier', bySupplier.topSuppliers.map(s => s.key).join(','), `p${supplier.id}`);
  expectEqual(wrong, 'top items', bySupplier.topItems.map(i => i.key).join(','), `${b},${a}`);

  // 2) by item: quantity and the average purchase price of each item
  const byItem = await purchases(h, `${base}&groupBy=item`);
  expectEqual(wrong, 'item rows', byItem.rows.map(r => r.group.key).join(','), `${b},${a}`);
  expectEqual(wrong, 'item A quantity', rowOf(byItem, String(a))?.quantity, 4);
  expectEqual(wrong, 'item A average price', rowOf(byItem, String(a))?.averageUnitPrice, 100_000);
  expectEqual(wrong, 'item B net', rowOf(byItem, String(b))?.net, 5_080_000);
  expectEqual(wrong, 'item B documents', rowOf(byItem, String(b))?.documentCount, 2);

  // 3) one currency, a category filter, an item filter, a period and two breakdowns
  expectEqual(wrong, 'EUR net', (await purchases(h, `${base}&currency=EUR`)).totals.net, 10);
  expectEqual(wrong, 'IRR net', (await purchases(h, `${base}&currency=IRR`)).totals.net, 480_000);
  const byCategory = await purchases(h, `${base}&groupBy=category&category=${encodeURIComponent(category)}`);
  expectEqual(wrong, 'category rows', byCategory.rows.map(r => r.group.label).join(','), category);
  expectEqual(wrong, 'category net', byCategory.totals.net, 400_000);
  const oneItem = await purchases(h, `${base}&itemId=${b}`);
  expectEqual(wrong, 'quantity with an item filter', oneItem.totals.quantity, 3);
  const byPeriod = await purchases(h, `${base}&groupBy=period&period=quarter`);
  expectEqual(wrong, 'one quarter row', `${byPeriod.rows.length}/${byPeriod.rows[0]?.net}`, '1/5480000');
  const twoWays = await purchases(h, `${base}&groupBy=supplier&thenBy=item`);
  expectEqual(wrong, 'supplier x item rows', twoWays.rows.map(r => r.then?.key).join(','), `${b},${a}`);
  const compared = await purchases(h, `${base}&compare=previous`);
  expectEqual(wrong, 'previous net of a row', compared.rows[0]?.previousNet, 0);
  expectEqual(wrong, 'change without a base', compared.rows[0]?.changePercent, null);

  // 4) paging and the export
  const firstPage = await purchases(h, `${base}&groupBy=item&limit=1`);
  expectEqual(wrong, 'paged rows', `${firstPage.rows.length}/${firstPage.total}`, '1/2');
  expectEqual(wrong, 'export rows', (await purchases(h, `${base}&groupBy=item&limit=1&export=true`)).rows.length, 2);

  // 5) a foreign purchase without a rate leaves the rial view and is counted
  await h.q(`UPDATE documents SET exchange_rate = NULL WHERE id = $1`, [docIdOf(euro)]);
  const unconverted = await purchases(h, base);
  expectEqual(wrong, 'net without the unconverted purchase', unconverted.totals.net, 480_000);
  expectEqual(wrong, 'unconverted documents', unconverted.unconvertedDocuments, 1);
  return 'one supplier: 5,500,000 gross, 20,000 discount, 5,480,000 net over two documents; voided, draft and proforma receipts left out; item, EUR, IRR, category, item filter, quarter, supplier x item, comparison, paging, export and a purchase without a rate all as expected';
}

async function purchaseAccessCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const query = `from=${f.today}&to=${f.today}`;
  const none = await h.sessionWith(['documents.view']);
  const denied = await h.get(`/api/reports/purchases?${query}`, none);
  if (denied.status !== 403) wrong.push(`a user without reports.purchases got ${brief(denied)}, expected 403`);
  const salesOnly = await h.sessionWith(['reports.sales']);
  const salesDenied = await h.get(`/api/reports/purchases?${query}`, salesOnly);
  if (salesDenied.status !== 403) wrong.push(`a reports.sales holder got ${brief(salesDenied)} from the purchase report, expected 403`);

  const reader = await h.sessionWith(['reports.purchases']);
  await purchases(h, query, reader);
  for (const url of ['/api/customers/options?partyType=supplier', '/api/items/options']) {
    const res = await h.get(url, reader);
    if (res.status !== 200) wrong.push(`${url} answered ${brief(res)} to a reports.purchases holder, expected 200`);
  }
  const refused = async (q: string, code: string) => {
    const res = await h.get(`/api/reports/purchases?${q}`, reader);
    if (res.status !== 422 || (res.body as { code?: string })?.code !== code) wrong.push(`${q} answered ${brief(res)}, expected 422 ${code}`);
  };
  await refused('from=2026-10-10&to=2026-10-01', 'REPORT_RANGE_INVALID');
  await refused(`${query}&groupBy=item&thenBy=item`, 'REPORT_DIMENSIONS_SAME');
  await refused('from=1990-01-01&to=2026-01-01&groupBy=period&period=month', 'REPORT_PERIODS_TOO_MANY');
  for (const extra of ['unknown=1', 'channel=online', 'groupBy=customer']) {
    const res = await h.get(`/api/reports/purchases?${query}&${extra}`, reader);
    if (res.status !== 400) wrong.push(`${extra} answered ${brief(res)}, expected 400`);
  }
  return 'documents.view or reports.sales alone: 403; reports.purchases reads the report and the supplier and item pick lists; an inverted range, two equal breakdowns and too many periods are 422; an unknown key, a sales channel and a sales breakdown are 400';
}

async function salesChartsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createTestCustomer, createTestItem } = await import('../fixtures/factories.js');
  const party = `D03 chart party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const category = `D03 chart category ${h.tag}`;
  const a = Number((await createTestItem({ type: 'product', code: `D03C-${h.tag}`, name: `D03 chart item ${h.tag}`, category, stocks: { [f.wh]: 10 }, weightedAverageCost: 100_000 } as never)).id);
  const b = await f.item(10, 100_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [
    { itemId: a, quantity: 2, unit_price: 300_000, location: f.wh },
    { itemId: b, quantity: 1, unit_price: 200_000, location: f.wh },
  ], { partyId: customer.id, buyer_name: party }));
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const back = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: docIdOf(invoice) }));
  if (back.status !== 200) throw new Error(`setup: return ${brief(back)}`);

  const query = `from=${f.today}&to=${f.today}&partyId=${customer.id}`;
  const none = await h.sessionWith(['reports.purchases']);
  const denied = await h.get(`/api/reports/sales/charts?${query}`, none);
  if (denied.status !== 403) wrong.push(`a user without reports.sales got ${brief(denied)}, expected 403`);
  const reader = await h.sessionWith(['reports.sales']);
  const series = await getOk<SalesChartSeries>(h, `/api/reports/sales/charts?${query}`, reader);
  // 600,000 + 200,000 less a return of 300,000
  expectEqual(wrong, 'total', series.total, 500_000);
  expectEqual(wrong, 'period of a one-day range', series.period, 'month');
  expectEqual(wrong, 'trend', series.trend.map(bar => bar.value).join(','), '500000');
  const sales = await getOk<{ totals: { netAfterReturns: string } }>(h, `/api/reports/sales?${query}`);
  expectEqual(wrong, 'trend equals the sales report', series.total, sales.totals.netAfterReturns);
  expectEqual(wrong, 'category labels', series.categories.map(bar => bar.label).join(','), `${category},${DEFAULT_ITEM_CATEGORY}`);
  expectEqual(wrong, 'category values', series.categories.map(bar => bar.value).join(','), '300000,200000');
  expectEqual(wrong, 'category shares', series.categories.map(bar => bar.percent).join(','), '60,40');
  const badKey = await h.get(`/api/reports/sales/charts?${query}&groupBy=item`, reader);
  if (badKey.status !== 400) wrong.push(`a breakdown key answered ${brief(badKey)}, expected 400`);
  const inverted = await h.get('/api/reports/sales/charts?from=2026-10-10&to=2026-10-01', reader);
  if (inverted.status !== 422) wrong.push(`an inverted range answered ${brief(inverted)}, expected 422`);
  return 'reports.purchases alone: 403; reports.sales gets a 500,000 one-month trend equal to the sales report and the shares 60% / 40% of the category and the items without one';
}

async function dashboardSummaryCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const url = '/api/reports/dashboard-summary';
  const none = await h.sessionWith(['documents.view']);
  const denied = await h.get(url, none);
  if (denied.status !== 403) wrong.push(`a user without either key got ${brief(denied)}, expected 403`);
  const salesOnly = await getOk<DashboardSummary>(h, url, await h.sessionWith(['reports.sales']));
  if (!salesOnly.sales || salesOnly.receivables !== null) wrong.push(`reports.sales got sales ${String(Boolean(salesOnly.sales))} and receivables ${JSON.stringify(salesOnly.receivables)}, expected only sales`);
  const agingOnly = await getOk<DashboardSummary>(h, url, await h.sessionWith(['accounting.reports']));
  if (agingOnly.sales !== null || !agingOnly.receivables) wrong.push(`accounting.reports got sales ${JSON.stringify(agingOnly.sales)} and receivables ${String(Boolean(agingOnly.receivables))}, expected only receivables`);
  expectEqual(wrong, 'six trend months', salesOnly.sales?.trend.length, 6);

  const { createTestCustomer } = await import('../fixtures/factories.js');
  const party = `D03 dashboard party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const before = await getOk<DashboardSummary>(h, url);
  const item = await f.item(10, 100_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: item, quantity: 2, unit_price: 450_000, location: f.wh }], { partyId: customer.id, buyer_name: party }));
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const after = await getOk<DashboardSummary>(h, url);
  const delta = (x: string | undefined, y: string | undefined) => Number(x ?? 0) - Number(y ?? 0);
  expectEqual(wrong, 'month sales growth', delta(after.sales?.netAfterReturns, before.sales?.netAfterReturns), 900_000);
  const lastBar = (s: DashboardSummary) => s.sales?.trend[s.sales.trend.length - 1]?.value;
  expectEqual(wrong, 'current month bar growth', delta(lastBar(after), lastBar(before)), 900_000);
  expectEqual(wrong, 'receivables growth', delta(after.receivables?.total, before.receivables?.total), 900_000);
  expectEqual(wrong, 'over 90 days unchanged', delta(after.receivables?.over90, before.receivables?.over90), 0);
  return 'no key: 403; reports.sales gets only the month sales with six trend months, accounting.reports only the receivables; a 900,000 invoice raises the month sales, its trend bar and the receivables by 900,000 and leaves the over-90 part';
}
