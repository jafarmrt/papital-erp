import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import type { StockImportResult, StockImportRow } from '../../lib/historyImport/stockHistoryImport.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestCustomer, createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { brief, ok } from './receiptsOnInvoicesV11Tests.js';
import { stockDoc } from './stockPathsV11Tests.js';

/**
 * v11 history import, tool 2 (the 1405 replay from Excel): opening stock, purchase and production receipts, consumption,
 * waste and transfers posted at once, day by day, through the services a hand entry uses. Real Express routes and services
 * on PostgreSQL, each scenario in its own schema with the standard chart of accounts. Red before this change: the route did
 * not exist (404).
 */

const URL = '/api/inventory/history-import';
const IN = 'ورود به انبار';
const OUT = 'خروج دستی';

type Admin = Awaited<ReturnType<typeof sandboxAdminClient>>;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const footprint = async () => ({
  kardex: await count(sql`SELECT count(*)::int AS n FROM transactions`),
  documents: await count(sql`SELECT count(*)::int AS n FROM documents`),
  lines: await count(sql`SELECT count(*)::int AS n FROM document_items`),
  stocks: await count(sql`SELECT coalesce(sum(current_stock), 0)::int AS n FROM item_warehouse_stocks`),
  vouchers: await count(sql`SELECT count(*)::int AS n FROM journal_vouchers`),
  openings: await count(sql`SELECT count(*)::int AS n FROM item_opening_voucher_items`),
  audit: await count(sql`SELECT count(*)::int AS n FROM activity_logs`),
  outbox: await count(sql`SELECT count(*)::int AS n FROM outbox_events`),
  counters: await count(sql`SELECT coalesce(sum(last_ref_number), 0)::int AS n FROM document_ref_counters`),
  voucherSeq: await count(sql`SELECT last_value::bigint AS n FROM journal_voucher_number_seq`),
});
const sameFootprint = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k} ${a[k]} -> ${b[k]}`);

async function stockOf(itemId: number): Promise<Record<string, number>> {
  const res = await orm.execute(sql`SELECT warehouse_code AS code, current_stock::float AS qty FROM item_warehouse_stocks WHERE item_id = ${itemId}`);
  const byCode: Record<string, number> = {};
  for (const r of res.rows as Array<{ code: string; qty: number }>) if (Number(r.qty) !== 0) byCode[r.code] = Number(r.qty);
  return byCode;
}

const post = async (client: Admin, rows: StockImportRow[], commit: boolean) => {
  const res = await client.post(URL, { commit, rows });
  // a post that recorded nothing answers 409 with its rows, so its key is released
  if (commit && res.status === 409 && res.body?.code === 'HISTORY_IMPORT_NOT_POSTED') return res.body.details as StockImportResult;
  if (!ok(res)) throw new Error(`the import (${commit ? 'post' : 'preview'}) returned ${brief(res)}`);
  return res.body as StockImportResult;
};
const rowOf = (result: StockImportResult, rowNo: number, sheet = IN) => result.rows.find(r => r.rowNo === rowNo && r.sheet === sheet);
const fresh = (type: 'product' | 'raw_material') => createTestItem({ type, stocks: {}, weightedAverageCost: 0 });

export async function runHistoryImportStockV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const posting = 'reg_history_import_stock_v11';
  if (shouldRun(posting, 'v11', 'history_import', 'inventory', 'stock')) {
    await runCase(results, posting, 'v11 history import (tool 2): a preview of opening stock, a purchase of two lines, a same-day consumption listed first, a production receipt, a transfer and a waste runs every row through the real services and keeps nothing (no Kardex row, document, stock, voucher, audit row or number); the post keeps them all day by day (in before out), one receipt for the two purchase lines, and one draft opening voucher on 1 Farvardin worth the opening rows', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const other = await createTestWarehouse();
      const material = await fresh('raw_material');
      const material2 = await fresh('raw_material');
      const product = await fresh('product');
      const supplier = await createTestCustomer({ partyType: 'supplier' });

      // the Excel order is not the day order: the consumption of 1405-01-10 is listed before that day's purchase
      const rows: StockImportRow[] = [
        { rowNo: 2, sheet: OUT, date: '1405-01-10', kind: 'consumption', itemCode: material.code, quantity: '25', slipRef: '۱۲', description: 'کارگاه' },
        { rowNo: 2, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: material.code, quantity: '10', unitCost: '1000' },
        { rowNo: 3, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: product.code, quantity: '5', unitCost: '50000' },
        { rowNo: 4, sheet: IN, date: '1405/01/10', kind: 'purchase', itemCode: material.code, quantity: '20', unitCost: '1200', supplierId: supplier.id, slipRef: 'خ۱' },
        { rowNo: 5, sheet: IN, date: '1405-01-10', kind: 'purchase', itemCode: material2.code, quantity: '3', unitCost: '500', supplierId: supplier.id, slipRef: 'خ۱' },
        { rowNo: 6, sheet: IN, date: '1405-01-15', kind: 'production', itemCode: product.code, quantity: '2', unitCost: '60000' },
        { rowNo: 3, sheet: OUT, date: '1405-01-25', kind: 'waste', itemCode: product.code, quantity: '1', warehouse: other.code },
        { rowNo: 4, sheet: OUT, date: '1405-01-20', kind: 'transfer', itemCode: product.code, quantity: '3', toWarehouse: other.code, description: 'به نمایش' },
      ];

      const before = await footprint();
      const preview = await post(admin, rows, false);
      const after = await footprint();
      if (preview.committed || preview.okCount !== rows.length || preview.errorCount !== 0) problems.push(`the preview read ${JSON.stringify(preview).slice(0, 800)}, expected every row ok and nothing committed`);
      const moved = sameFootprint(before, after);
      if (moved.length > 0) problems.push(`the preview left a trace: ${moved.join(', ')}`);
      if (preview.rows.some(r => r.created)) problems.push('the preview sent placeholder numbers');

      const posted = await post(admin, rows, true);
      if (!posted.committed || posted.okCount !== rows.length) problems.push(`the post read ${JSON.stringify(posted).slice(0, 800)}, expected every row committed`);
      const end = await footprint();
      if (end.documents - before.documents !== 5) problems.push(`the post made ${end.documents - before.documents} documents, expected 5 (one receipt for both purchase lines, a remittance, a production receipt, a transfer, a waste)`);
      if (end.vouchers - before.vouchers !== 5) problems.push(`the post made ${end.vouchers - before.vouchers} vouchers, expected 5 (receipt, remittance, production receipt, waste, the opening; a transfer has none)`);
      const m = await stockOf(material.id);
      const m2 = await stockOf(material2.id);
      const p = await stockOf(product.id);
      if (m[main] !== 5 || Object.keys(m).length !== 1) problems.push(`the material ends at ${JSON.stringify(m)}, expected 5 in ${main} (10 + 20 - 25)`);
      if (m2[main] !== 3) problems.push(`the second material ends at ${JSON.stringify(m2)}, expected 3`);
      if (p[main] !== 4 || p[other.code] !== 2) problems.push(`the product ends at ${JSON.stringify(p)}, expected 4 in ${main} and 2 in ${other.code}`);
      if (rowOf(posted, 4)?.created?.[0] !== rowOf(posted, 5)?.created?.[0]) problems.push(`the two purchase lines went to ${JSON.stringify([rowOf(posted, 4)?.created, rowOf(posted, 5)?.created])}, expected one receipt`);
      const receipt = (await orm.execute(sql`SELECT d.party_id AS "partyId", d.notes, to_char(d.date, 'YYYY-MM-DD') AS day FROM documents d
        JOIN document_items di ON di.document_id = d.id WHERE d.type = 'receipt' AND di.item_id = ${material2.id} AND d.is_deleted = 0`)).rows as Array<{ partyId: number; notes: string; day: string }>;
      if (receipt.length !== 1 || Number(receipt[0].partyId) !== supplier.id || receipt[0].day !== '2026-03-30' || !String(receipt[0].notes).includes('خ۱')) problems.push(`the receipt reads ${JSON.stringify(receipt)}, expected the supplier, 1405-01-10 (2026-03-30) and the Excel slip in its notes`);
      const opening = (await orm.execute(sql`SELECT t.document_ref AS ref, to_char(t.date, 'YYYY-MM-DD') AS day, t.unit_price::float AS price FROM transactions t
        WHERE t.item_id = ${material.id} AND t.document_type = 'audit' AND t.is_deleted = 0`)).rows as Array<{ ref: string; day: string; price: number }>;
      if (opening.length !== 1 || opening[0].ref !== 'ثبت موجودی افتتاحیه' || opening[0].day !== '2026-03-21' || opening[0].price !== 1000) problems.push(`the material's opening Kardex row reads ${JSON.stringify(opening)}, expected the opening reference on 1405-01-01 (2026-03-21) at 1000`);
      const vouchers = (await orm.execute(sql`SELECT jv.status, jv.date, (SELECT sum(ji.credit)::float FROM journal_voucher_items ji WHERE ji.voucher_id = jv.id) AS credit
        FROM journal_vouchers jv WHERE jv.id IN (SELECT voucher_id FROM item_opening_voucher_items WHERE item_id IN (${material.id}, ${product.id})) AND jv.is_deleted = 0`)).rows as Array<{ status: string; date: string; credit: number }>;
      if (vouchers.length !== 1 || vouchers[0].status !== 'draft' || fin(vouchers[0].credit).toNumber() !== 260_000 || !String(vouchers[0].date).startsWith('2026-03-21')) problems.push(`the opening vouchers read ${JSON.stringify(vouchers)}, expected one draft dated 1405-01-01 worth 260,000 (10 x 1000 + 5 x 50000)`);
      const drafts = await count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND status <> 'draft' AND voucher_number > ${before.voucherSeq}`);
      if (drafts !== 0) problems.push(`${drafts} imported vouchers are not drafts`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a preview keeps nothing; the post records every row day by day through the hand-entry services';
    }));
  }

  const refusals = 'reg_history_import_stock_refusals_v11';
  if (shouldRun(refusals, 'v11', 'history_import', 'inventory', 'stock')) {
    await runCase(results, refusals, 'v11 history import (tool 2): a consumption beyond the day\'s stock, an opening of an item that has moved, a row before an item\'s last movement and a purchase without cost and an unknown code are refused with their reason, and a post with any refused row keeps nothing; a row like another of the file waits until accepted; the import needs warehouse.history_import', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const material = await fresh('raw_material');
      const moved = await fresh('raw_material');
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      // `moved` already has a receipt on 1405-02-01 in the books
      await stockDoc(admin, { docType: 'receipt', date: '2026-04-21', location: main, partyId: supplier.id, items: [{ itemId: moved.id, quantity: 4, unit_price: 700 }] });

      const rows: StockImportRow[] = [
        { rowNo: 2, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: material.code, quantity: '10', unitCost: '1000' },
        { rowNo: 3, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: moved.code, quantity: '5', unitCost: '900' },
        { rowNo: 4, sheet: IN, date: '1405-01-20', kind: 'purchase', itemCode: moved.code, quantity: '2', unitCost: '800', supplierId: supplier.id },
        { rowNo: 5, sheet: IN, date: '1405-01-05', kind: 'purchase', itemCode: material.code, quantity: '2', supplierId: supplier.id },
        { rowNo: 2, sheet: OUT, date: '1405-01-03', kind: 'consumption', itemCode: material.code, quantity: '12' },
        { rowNo: 3, sheet: OUT, date: '1405-01-04', kind: 'consumption', itemCode: material.code, quantity: '1' },
        { rowNo: 4, sheet: OUT, date: '1405-01-04', kind: 'consumption', itemCode: material.code, quantity: '1', slipRef: 'دیگر' },
        { rowNo: 6, sheet: IN, date: '1405-01-06', kind: 'production', itemCode: 'NO-SUCH-CODE-1405', quantity: '1', unitCost: '10' },
      ];
      const before = await footprint();
      const result = await post(admin, rows, true);
      const after = await footprint();
      if (result.committed) problems.push('a file with refused rows was committed');
      const moves = sameFootprint(before, after);
      if (moves.length > 0) problems.push(`a refused post left a trace: ${moves.join(', ')}`);
      if (rowOf(result, 2)?.status !== 'ok') problems.push(`the good opening reads ${JSON.stringify(rowOf(result, 2))}`);
      if (rowOf(result, 3)?.status !== 'error' || !String(rowOf(result, 3)?.message).includes('گردش دارد')) problems.push(`the opening of a moved item reads ${JSON.stringify(rowOf(result, 3))}, expected refused because it has moved`);
      if (rowOf(result, 4)?.status !== 'error') problems.push(`a purchase before the item's last movement reads ${JSON.stringify(rowOf(result, 4))}, expected refused by the date rule`);
      if (rowOf(result, 5)?.status !== 'error' || !String(rowOf(result, 5)?.message).includes('قیمت واحد')) problems.push(`a purchase without cost reads ${JSON.stringify(rowOf(result, 5))}`);
      if (rowOf(result, 6)?.status !== 'error' || rowOf(result, 6)?.unknownCode !== 'NO-SUCH-CODE-1405') problems.push(`a row with an unknown code reads ${JSON.stringify(rowOf(result, 6))}, expected refused naming the code`);
      if (rowOf(result, 2, OUT)?.status !== 'error') problems.push(`a consumption of 12 of 10 reads ${JSON.stringify(rowOf(result, 2, OUT))}, expected refused`);
      if (rowOf(result, 3, OUT)?.status !== 'ok' || rowOf(result, 4, OUT)?.status !== 'duplicate') problems.push(`two equal consumptions read ${JSON.stringify([rowOf(result, 3, OUT), rowOf(result, 4, OUT)])}, expected the second held as a duplicate`);

      const accepted = [rows[0], rows[5], { ...rows[6], duplicateAccepted: true }];
      const fixed = await post(admin, accepted, true);
      if (!fixed.committed || fixed.okCount !== accepted.length) problems.push(`the fixed file read ${JSON.stringify(fixed).slice(0, 600)}, expected committed`);
      const m = await stockOf(material.id);
      if (m[main] !== 8) problems.push(`after the fixed file the material holds ${JSON.stringify(m)}, expected 8 (10 - 1 - 1)`);

      const keeper = await sandboxClientWith(['warehouse.view', 'warehouse.in', 'warehouse.out']);
      const refused = await keeper.post(URL, { commit: false, rows: [rows[0]] });
      if (refused.status !== 403) problems.push(`a warehouse keeper without the import permission got ${brief(refused)}, expected 403`);
      const importer = await sandboxClientWith(['warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.history_import']);
      const allowed = await importer.post(URL, { commit: false, rows: [{ ...rows[0], itemCode: moved.code }] });
      if (!ok(allowed)) problems.push(`a holder of the import permission got ${brief(allowed)}`);
      // a production receipt and a transfer need what their hand forms ask, which this importer does not hold
      const other = await createTestWarehouse();
      const formRows: StockImportRow[] = [
        { rowNo: 7, sheet: IN, date: '1405-01-06', kind: 'production', itemCode: material.code, quantity: '1', unitCost: '10' },
        { rowNo: 5, sheet: OUT, date: '1405-01-06', kind: 'transfer', itemCode: material.code, quantity: '1', toWarehouse: other.code },
      ];
      const forms = (await importer.post(URL, { commit: false, rows: formRows })).body as StockImportResult;
      for (const [rowNo, sheet] of [[7, IN], [5, OUT]] as const) {
        const r = forms?.rows?.find(x => x.rowNo === rowNo && x.sheet === sheet);
        if (r?.status !== 'error' || !String(r?.message).includes('مجوز')) problems.push(`row ${rowNo} of ${sheet} by an importer without its form's permission reads ${JSON.stringify(r)}, expected refused`);
      }

      // an opening is dated 1 Farvardin only, and never stacks on stock the Kardex does not hold
      const late = await post(admin, [{ rowNo: 8, sheet: IN, date: '1405-01-05', kind: 'opening', itemCode: (await fresh('raw_material')).code, quantity: '1', unitCost: '10' }], false);
      if (rowOf(late, 8)?.status !== 'error' || !String(rowOf(late, 8)?.message).includes('فقط با تاریخ')) problems.push(`an opening on 1405-01-05 reads ${JSON.stringify(late.rows)}, expected refused`);
      const held = await createTestItem({ type: 'raw_material', stocks: { [main]: 7 }, weightedAverageCost: 900 });
      const stacked = await post(admin, [{ rowNo: 9, sheet: IN, date: '1405-01-01', kind: 'opening', itemCode: held.code, quantity: '10', unitCost: '1000' }], false);
      if (rowOf(stacked, 9)?.status !== 'error' || !String(rowOf(stacked, 9)?.message).includes('در کاردکس نیست')) problems.push(`an opening of an item holding stock without Kardex rows reads ${JSON.stringify(stacked.rows)}, expected refused`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'refused rows post nothing, duplicates wait for acceptance, the import needs its permission and each form\'s';
    }));
  }

  return results;
}
