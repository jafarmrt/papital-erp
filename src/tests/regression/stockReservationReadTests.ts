import type { TestCaseResult } from '../types.js';
import type { Harness, ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createProject, globalSection, postDoc, reservedOf, runReservationCases } from './stockReservationTests.js';

/**
 * Package 7 (inventory planning), PR B: how the reservation report is read. A bad stored row or a failed read never turns
 * into "no reservation", and a read for some items reads only what may reach them. Each case is red on the code before
 * its fix.
 */
export async function runStockReservationReadTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return runReservationCases(shouldRun, [
    ['reg_reservation_fail_closed_td_821',
      'v9.0.394: a malformed or unmatched reservation row is skipped and listed instead of breaking every exit, and every reader that allows an exit or shows stock fails closed (TD-821)',
      ['td821', 'reservation', 'failclosed', 'package7'], failClosedCase],
    ['reg_reservation_scoped_reads_td_831',
      'v9.0.395: the exit gate, the item list and the online shop read only the proformas, projects and items of the items they ask for (TD-831)',
      ['td831', 'reservation', 'performance', 'package7'], scopedReadsCase],
  ]);
}

/** B07-05 (TD-821): one bad row in one project broke every exit (500) while the item list and the online shop saw no reservation at all */
async function failClosedCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10);
  const b = await f.item(10);
  const other = await f.item(10);
  const proforma = await postDoc(h, f, 'invoice', 'proforma', a, 6);
  if (proforma.status !== 200) throw new Error(`setup: the sales proforma answered ${brief(proforma)}`);
  // a finalized project with a numeric code nobody has and a row whose code and name are numbers but whose id is item b
  const [bad] = await h.q(
    `INSERT INTO production_projects (project_code, title, status, version, inventory_control)
     VALUES ($1, 'P7 broken rows', 'in_progress', 1, $2::jsonb) RETURNING id`,
    [`P7-BR-${h.tag}`, JSON.stringify({ isFinalized: true, finalizedAt: '2026-01-01T00:00:00Z', reservedItems: [
      { itemCode: 987654321, reservedQty: 3, unit: 'عدد' },
      { itemId: b, itemCode: 12345, itemName: 777, category: 5, reservedQty: 2, unit: 'عدد' },
    ] })],
  );
  try {
    const sale = await postDoc(h, f, 'invoice', 'final', other, 1);
    if (sale.status !== 200) wrong.push(`a final invoice of an unrelated item answered ${brief(sale)}, expected 200`);
    if ((await reservedOf(b)).project !== 2) wrong.push(`the row with item b's id reserves ${(await reservedOf(b)).project}, expected 2`);

    const list = await h.get(`/api/items?search=${encodeURIComponent(h.tag)}&limit=50`);
    const rows = Array.isArray((list.body as { data?: unknown })?.data) ? (list.body as { data: Array<Record<string, unknown>> }).data : [];
    const reservedA = Number(rows.find(r => Number(r.id) === a)?.reserved_stock);
    if (list.status !== 200 || reservedA !== 6) wrong.push(`GET /items answered ${list.status} with item a reserved ${reservedA}, expected 200 and 6`);

    const { orm } = await import('../../db/drizzle.js');
    const { shopSellableStocks } = await import('../../services/woocommerce/shopWarehouse.js');
    const shop = await shopSellableStocks(orm, [a]);
    if (shop.sellable.get(a) !== 4) wrong.push(`the online shop sees ${shop.sellable.get(a)} sellable units of item a, expected 4`);

    const report = await h.get('/api/inventory/reserved-items');
    // a proforma may share the project's numeric id, so the source type is matched too
    const entries = ((report.body as { allReservationEntries?: Array<{ sourceType?: string; sourceId?: number; itemId?: number }> })?.allReservationEntries ?? [])
      .filter(e => e.sourceType === 'project' && Number(e.sourceId) === Number(bad.id));
    if (report.status !== 200 || entries.length !== 1 || Number(entries[0].itemId) !== b) {
      wrong.push(`the reservation report answered ${report.status} with the broken project's entries ${JSON.stringify(entries)}, expected only item b's row`);
    }

    const { findProjectReservationIssues } = await import('../../services/projects/projectReservationHealth.js');
    const kinds = (await findProjectReservationIssues()).filter(i => i.projectId === Number(bad.id)).map(i => i.kind);
    if (kinds.join(',') !== 'reservation_row_unmatched') wrong.push(`the health check lists the broken project as ${JSON.stringify(kinds)}, expected reservation_row_unmatched`);

    // a reader that fails is an error, never "no reservation": the reserved stock map and the item list pass it on
    const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
    const original = ItemStockReservationService.getReservedStockDetails;
    ItemStockReservationService.getReservedStockDetails = async () => { throw new Error('simulated reservation read failure'); };
    try {
      const mapResult = await ItemStockReservationService.getReservedStocksMap({ itemIds: [a] }).then(() => 'resolved', () => 'rejected');
      if (mapResult !== 'rejected') wrong.push('the reserved stock map resolved while the reservation read failed, expected it to reject');
      const failedList = await h.get(`/api/items?search=${encodeURIComponent(h.tag)}&limit=50`);
      if (failedList.status < 500) wrong.push(`GET /items answered ${failedList.status} while the reservation read failed, expected an error`);
    } finally {
      ItemStockReservationService.getReservedStockDetails = original;
    }
  } finally {
    await h.q(`UPDATE production_projects SET is_deleted = 1 WHERE id = $1`, [bad.id]);
  }
  return 'a project with a numeric-code row nobody has and a numeric-name row with an item id: unrelated sales pass, the id row reserves 2, the item list and the online shop still see the proforma of 6, the unmatched row is listed by the health check, and a failing read is an error';
}

/** Rows each SELECT returned while fn ran, by table read (from "items" / from "documents" / from "document_items" / from "production_projects") */
async function rowsReadDuring(fn: () => Promise<unknown>): Promise<Record<string, number>> {
  const { pool } = await import('../../db/drizzle.js');
  type QueryFn = (...args: unknown[]) => Promise<{ rowCount?: number | null; rows?: unknown[] }>;
  const target = pool as unknown as { query: QueryFn };
  const original = target.query;
  const counts: Record<string, number> = {};
  target.query = async (...args: unknown[]) => {
    const result = await original.apply(pool, args);
    const first = args[0] as string | { text?: string } | undefined;
    const text = typeof first === 'string' ? first : String(first?.text ?? '');
    const table = /^\s*select[\s\S]*?\bfrom\s+"([a-z_]+)"/i.exec(text)?.[1];
    if (table) counts[table] = (counts[table] ?? 0) + (result?.rows?.length ?? 0);
    return result;
  };
  try {
    await fn();
  } finally {
    target.query = original;
  }
  return counts;
}

/** B07-15 (TD-831): every exit read all proformas, all projects and (with any project control) all items */
async function scopedReadsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const target = await f.item(10);
  const crowd: number[] = [];
  for (let i = 0; i < 25; i++) crowd.push(await f.item(5));
  for (let i = 0; i < 20; i++) {
    const res = await postDoc(h, f, 'invoice', 'proforma', crowd[i], 1);
    if (res.status !== 200) throw new Error(`setup: proforma ${i} answered ${brief(res)}`);
  }
  for (let i = 0; i < 6; i++) {
    const [it] = await h.q(`SELECT code, name FROM items WHERE id = $1`, [crowd[i]]);
    await createProject(h, { isFinalized: true, manualPurchaseItems: [], sections: globalSection([{ itemCode: it.code, name: it.name, unit: 'عدد', requiredQty: 1 }]) });
  }
  const own = await postDoc(h, f, 'invoice', 'proforma', target, 2);
  if (own.status !== 200) throw new Error(`setup: the target's proforma answered ${brief(own)}`);

  const { ItemStockReservationService } = await import('../../services/items/itemStockReservation.service.js');
  let view = 0;
  const scoped = await rowsReadDuring(async () => {
    const report = await ItemStockReservationService.getReservedStockDetails(undefined, true, { itemIds: [target] });
    view = Number(report.itemSummaries.find(s => Number(s.itemId) === target)?.totalReservedQty ?? 0);
  });
  if (view !== 2) wrong.push(`the scoped report gives the target ${view} reserved, expected 2`);
  const reads = `items ${scoped.items ?? 0}, documents ${scoped.documents ?? 0}, document lines ${scoped.document_items ?? 0}, projects ${scoped.production_projects ?? 0}`;
  if ((scoped.items ?? 0) > 2 || (scoped.documents ?? 0) > 2 || (scoped.document_items ?? 0) > 2) {
    wrong.push(`a report scoped to one item read ${reads} rows, expected at most 2 of each (one item, its one proforma)`);
  }

  const { orm } = await import('../../db/drizzle.js');
  const { shopSellableStocks } = await import('../../services/woocommerce/shopWarehouse.js');
  let sellable = 0;
  const shopReads = await rowsReadDuring(async () => { sellable = (await shopSellableStocks(orm, [target])).sellable.get(target) ?? 0; });
  if (sellable !== 8) wrong.push(`the online shop sees ${sellable} sellable units of the target, expected 8`);
  if ((shopReads.items ?? 0) > 2 || (shopReads.documents ?? 0) > 2) {
    wrong.push(`the online shop sync of one item read items ${shopReads.items ?? 0} and documents ${shopReads.documents ?? 0} rows, expected at most 2 of each`);
  }
  return `with 25 other items, 20 other proformas and 6 finalized projects, a report for one item read ${reads} rows and the online shop sync of that item read as few`;
}
