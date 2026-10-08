import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { postDoc, runReservationCases } from './stockReservationTests.js';

/**
 * Package 7 (inventory planning), PR D: the reserved items report and the reorder alerts. Each case is red on the code
 * before its fix.
 */
export async function runReservedItemsReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_reserved_items_cost_basis_td_823',
      'v9.0.399: every reservation is valued at the item cost in IRR, a foreign proforma included, and no sale price is reported (TD-823)',
      ['td823', 'reservation', 'package7'], costBasisCase],
    ['reg_reserved_items_reader_scope_td_829',
      'v9.0.400: the report gives cost and value only to item cost readers and a proforma buyer only to documents.view; other readers see quantities and sources (TD-829)',
      ['td829', 'reservation', 'security', 'package7'], readerScopeCase],
    ['reg_reorder_alert_free_stock_td_843',
      'v9.0.404: the reorder alert compares free stock (stock minus reservations) with the reorder point and shows open purchases as in transit only (TD-843)',
      ['td843', 'reservation', 'reorder', 'package7'], reorderFreeStockCase],
  ]);
}

type ReportEntry = Record<string, unknown> & { sourceType?: string; reservedQty?: number };
type ReportSummary = Record<string, unknown> & { itemId?: number; reservations?: ReportEntry[] };

/** A finalized project that reserves `qty` of the item, written straight to the table */
async function reservingProject(h: Harness, itemId: number, qty: number): Promise<number> {
  const [row] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, $2, 'in_progress', 1, $3::jsonb) RETURNING id`,
    [`P7-RPT-${h.tag}-${Math.floor(Math.random() * 1e6)}`, `ERP-TEST-MARKER P7 report ${h.tag}`,
      JSON.stringify({ isFinalized: true, finalizedAt: '2026-01-01T00:00:00Z', reservedItems: [{ itemId, reservedQty: qty, unit: 'عدد' }] })],
  );
  return Number(row.id);
}

/**
 * B07-07 (TD-823): WAC 400,000; a USD proforma 2 × 100 at 600,000 counted 200, a rial proforma 1 × 900,000 counted its sale
 * price and a project 3 its cost, summed as 2,100,200 "rials". At cost the item's reservations are 6 × 400,000.
 */
async function costBasisCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(20, 400_000);
  const usd = await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 2, unit_price: 100, location: f.wh }], { currency: 'USD', exchangeRate: 600_000 }));
  if (usd.status !== 200) throw new Error(`setup: the USD proforma answered ${brief(usd)}`);
  const irr = await postDoc(h, f, 'invoice', 'proforma', a, 1, 900_000);
  if (irr.status !== 200) throw new Error(`setup: the rial proforma answered ${brief(irr)}`);
  const projectId = await reservingProject(h, a, 3);
  try {
    const report = await h.get('/api/inventory/reserved-items');
    const summaries = ((report.body as { itemSummaries?: ReportSummary[] })?.itemSummaries ?? []);
    const summary = summaries.find(s => Number(s.itemId) === a);
    if (report.status !== 200 || !summary) {
      wrong.push(`the report answered ${brief(report)} without the item's summary`);
      return 'no summary';
    }
    const entries = summary.reservations ?? [];
    if (entries.length !== 3) wrong.push(`the item has ${entries.length} reservations, expected 3 (two proformas and a project)`);
    for (const e of entries) {
      const qty = Number(e.reservedQty);
      if (Number(e.unitCost) !== 400_000 || Number(e.totalCost) !== qty * 400_000) {
        wrong.push(`${String(e.sourceType)} ${qty}: unit cost ${String(e.unitCost)}, total ${String(e.totalCost)}; expected 400000 and ${qty * 400_000}`);
      }
      if ('unitPrice' in e || 'totalValue' in e) wrong.push(`${String(e.sourceType)} ${qty} still reports a sale price or value (${String(e.unitPrice)} / ${String(e.totalValue)})`);
    }
    if (Number(summary.totalReservedCost) !== 2_400_000) wrong.push(`the item's reservations are worth ${String(summary.totalReservedCost)}, expected 2400000 (6 × 400000)`);
    if (Number(summary.weightedAverageCost) !== 400_000) wrong.push(`the summary's cost is ${String(summary.weightedAverageCost)}, expected 400000`);
    if ('sellPrice' in summary || 'buyPrice' in summary) wrong.push('the summary still carries buyPrice / sellPrice');
    return `entries ${entries.map(e => `${String(e.sourceType)}:${String(e.reservedQty)}=${String(e.totalCost)}`).join(', ')}; item total ${String(summary.totalReservedCost)}`;
  } finally {
    await h.q('UPDATE production_projects SET is_deleted = 1 WHERE id = $1', [projectId]);
  }
}

/**
 * B07-13 (TD-829): a role with only documents.create, documents.view, reports.view or warehouse.in got the item WAC, the
 * proforma price and the buyer of every customer's proforma.
 */
async function readerScopeCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10, 123_456);
  const buyer = `P8 party ${h.tag}`;
  const proforma = await postDoc(h, f, 'invoice', 'proforma', a, 2, 777_000);
  if (proforma.status !== 200) throw new Error(`setup: the proforma answered ${brief(proforma)}`);

  const expectations: Array<[string[], boolean, boolean]> = [
    [['documents.create'], false, false],
    [['reports.view'], false, false],
    [['documents.view'], false, true],
    [['warehouse.in'], true, false],
    [['products.view'], true, false],
    [['accounting.view', 'reports.view'], true, false],
  ];
  const seen: string[] = [];
  for (const [keys, cost, withBuyer] of expectations) {
    const session = await h.sessionWith(keys);
    const res = await h.get('/api/inventory/reserved-items', session);
    const body = res.body as { itemSummaries?: ReportSummary[]; summaryMetrics?: Record<string, unknown>; access?: { cost?: boolean; buyer?: boolean } };
    const summary = (body?.itemSummaries ?? []).find(s => Number(s.itemId) === a);
    const entry = summary?.reservations?.find(e => e.sourceType === 'proforma');
    if (res.status !== 200 || !summary || !entry) {
      wrong.push(`${keys.join('+')}: the report answered ${brief(res)} without the proforma`);
      continue;
    }
    const text = JSON.stringify(summary);
    const hasCost = 'unitCost' in entry || 'totalCost' in entry || 'weightedAverageCost' in summary || 'totalReservedCost' in summary
      || 'totalReservedCost' in (body.summaryMetrics ?? {}) || text.includes('123456');
    const hasBuyer = text.includes(buyer);
    if (hasCost !== cost) wrong.push(`${keys.join('+')}: cost ${hasCost ? 'shown' : 'hidden'}, expected ${cost ? 'shown' : 'hidden'}`);
    if (hasBuyer !== withBuyer) wrong.push(`${keys.join('+')}: the buyer is ${hasBuyer ? 'shown' : 'hidden'}, expected ${withBuyer ? 'shown' : 'hidden'}`);
    if (text.includes('777000')) wrong.push(`${keys.join('+')}: the proforma sale price 777000 is in the report`);
    if (body.access?.cost !== cost || body.access?.buyer !== withBuyer) wrong.push(`${keys.join('+')}: access ${JSON.stringify(body.access)}, expected cost ${cost} and buyer ${withBuyer}`);
    if (Number(entry.reservedQty) !== 2) wrong.push(`${keys.join('+')}: the proforma reserves ${String(entry.reservedQty)}, expected 2`);
    seen.push(`${keys.join('+')}: cost ${hasCost}, buyer ${hasBuyer}`);
  }
  const outsider = await h.sessionWith(['crm.view']);
  const denied = await h.get('/api/inventory/reserved-items', outsider);
  if (denied.status !== 403) wrong.push(`crm.view alone answered ${denied.status}, expected 403`);
  return seen.join('; ');
}

type AlertRow = Record<string, unknown> & { id?: number };

/**
 * Decision t7 (TD-843): A 10 in stock with 8 reserved by a sales proforma has 2 free against a reorder point of 5 and got no
 * alert; B 3 in stock with 4 on a draft receipt and 1 on a purchase proforma is alerted with 5 in transit and its deficit
 * still 2; C 10 in stock fully reserved by a finalized project is «بی موجودی».
 */
async function reorderFreeStockCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const [a, b, c] = [await f.item(10), await f.item(3), await f.item(10)];
  await h.q('UPDATE items SET reorder_point = 5 WHERE id = ANY($1::int[])', [[a, b, c]]);
  const setup: Array<[string, string, number, number]> = [['invoice', 'proforma', a, 8], ['receipt', 'draft', b, 4], ['receipt', 'proforma', b, 1]];
  for (const [type, status, itemId, qty] of setup) {
    const res = await postDoc(h, f, type, status, itemId, qty);
    if (res.status !== 200) throw new Error(`setup: ${type}/${status} answered ${brief(res)}`);
  }
  const projectId = await reservingProject(h, c, 10);
  try {
    const all = await h.get('/api/items/reorder-alerts');
    const zero = await h.get('/api/items/reorder-alerts?zero_stock=true');
    if (all.status !== 200 || zero.status !== 200) throw new Error(`the alerts answered ${brief(all)} / ${brief(zero)}`);
    const rows = Array.isArray(all.body) ? (all.body as AlertRow[]) : [];
    const zeroIds = (Array.isArray(zero.body) ? (zero.body as AlertRow[]) : []).map(r => Number(r.id));
    const row = (id: number) => rows.find(r => Number(r.id) === id);
    const expected: Array<[string, number, Record<string, number | boolean>]> = [
      ['A', a, { current_stock: 10, reserved_qty: 8, free_stock: 2, in_transit_qty: 0, deficit: 3, is_zero_stock: false }],
      ['B', b, { current_stock: 3, reserved_qty: 0, free_stock: 3, in_transit_qty: 5, deficit: 2, is_zero_stock: false }],
      ['C', c, { current_stock: 10, reserved_qty: 10, free_stock: 0, in_transit_qty: 0, deficit: 5, is_zero_stock: true }],
    ];
    for (const [label, id, fields] of expected) {
      const r = row(id);
      if (!r) { wrong.push(`${label} (stock ${fields.current_stock}, free ${fields.free_stock}, reorder point 5) has no alert`); continue; }
      for (const [key, value] of Object.entries(fields)) {
        if (r[key] !== value && Number(r[key]) !== value) wrong.push(`${label}: ${key} ${String(r[key])}, expected ${String(value)}`);
      }
    }
    if (!zeroIds.includes(c)) wrong.push('the out-of-stock filter leaves out C, whose whole stock is reserved');
    if (zeroIds.includes(a) || zeroIds.includes(b)) wrong.push('the out-of-stock filter lists A or B, which have free stock');
    return expected.map(([label, id]) => `${label}: free ${String(row(id)?.free_stock)}, in transit ${String(row(id)?.in_transit_qty)}, deficit ${String(row(id)?.deficit)}`).join('; ');
  } finally {
    await h.q('UPDATE production_projects SET is_deleted = 1 WHERE id = $1', [projectId]);
  }
}
