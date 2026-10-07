import request from 'supertest';
import pg from 'pg';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { documents, itemOpeningVoucherItems, items, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { ItemWarehouseStockService } from '../../services/inventory/itemWarehouseStock.service.js';
import { createTestDocument, createTestItem } from '../fixtures/factories.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 5 (items and pricing), PR E: item list and Excel import performance (B05-17).
 */
export async function runItemPerformanceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'perf_item_list_and_excel_opening_td_663';
  if (!shouldRun(id, 'td663', 'performance', 'items', 'excel', 'package5')) return [];
  const name = 'v9.0.206: the item list reads reservations of its own page only, and an Excel import reads its items once and issues one opening voucher for all its new items (TD-663)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const documentIds: number[] = [];
  try {
    const details = await listAndImportCase(itemIds, documentIds);
    return [makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    if (documentIds.length > 0) await orm.update(documents).set({ isDeleted: 1 }).where(inArray(documents.id, documentIds)).catch(() => undefined);
  }
}

async function listAndImportCase(itemIds: number[], documentIds: number[]): Promise<string> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const wrong: string[] = [];
  const stamp = Date.now().toString(36).toUpperCase();

  // a) a page of two items: only those two items' stocks are read, and the reservation of a page item still shows
  const offPage = await createTestItem({ type: 'product', code: `PF${stamp}-0`, name: `کالای بیرون صفحه ${stamp}`, currentStock: 10 });
  const reserved = await createTestItem({ type: 'product', code: `PF${stamp}-1`, name: `کالای رزرو ${stamp}`, currentStock: 10 });
  const plain = await createTestItem({ type: 'product', code: `PF${stamp}-2`, name: `کالای ساده ${stamp}`, currentStock: 10 });
  itemIds.push(offPage.id, reserved.id, plain.id);
  const proforma = await createTestDocument({ type: 'invoice', status: 'proforma' }, [{ itemId: reserved.id, quantity: 3, unitPrice: 1000 }]);
  documentIds.push(proforma.document.id);
  const original = ItemWarehouseStockService.getStocksForItems;
  const sizes: number[] = [];
  ItemWarehouseStockService.getStocksForItems = (async (tx, ids) => {
    sizes.push(ids.length);
    return original.call(ItemWarehouseStockService, tx, ids);
  }) as typeof original;
  let list: request.Response;
  try {
    list = await request(app).get('/api/items?type=product&limit=2&page=1').set('Cookie', admin.cookie);
  } finally {
    ItemWarehouseStockService.getStocksForItems = original;
  }
  const rows = (Array.isArray(list.body?.data) ? list.body.data : []) as Array<{ id: number; reserved_stock?: number }>;
  const reservedRow = rows.find(r => r.id === reserved.id);
  const plainRow = rows.find(r => r.id === plain.id);
  if (list.status !== 200 || !reservedRow || !plainRow) throw new Error(`list answered ${list.status} with ids ${rows.map(r => r.id).join(',')}`);
  if (reservedRow.reserved_stock !== 3 || plainRow.reserved_stock !== 0) wrong.push(`reserved stock ${reservedRow.reserved_stock} / ${plainRow.reserved_stock}, expected 3 / 0`);
  if (sizes.length === 0 || Math.max(...sizes) > 2) wrong.push(`a 2-item page read the stocks of ${Math.max(0, ...sizes)} items (calls ${sizes.join(',')})`);

  // b) an Excel import reads its items once per file: the SQL statements of a 2-row and a 6-row import differ only by
  //    what each row writes. Statements are counted over every connection of the pool.
  const importRows = async (codes: string[]) => {
    let statements = 0;
    const clientQuery = pg.Client.prototype.query;
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      statements++;
      return (clientQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof clientQuery;
    try {
      const res = await request(app).post('/api/items/unified-import').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
        .send({ rows: codes.map((code, i) => ({ 'کد کالا': code, 'نام کالا': `کالای اکسل افتتاحیه ${code}`, 'نوع کالا': 'ماده اولیه', 'موجودی کل': i + 2, 'میانگین موزون بها': 10000 * (i + 1), 'قیمت عمده': 5000 })) });
      const created = await orm.select({ id: items.id, code: items.code }).from(items).where(and(inArray(items.code, codes), eq(items.isDeleted, 0)));
      itemIds.push(...created.map(r => r.id));
      if (res.status !== 200 || created.length !== codes.length) throw new Error(`import answered ${res.status} ${JSON.stringify(res.body?.errors ?? res.body)} and created ${created.length} items`);
      return { statements, created };
    } finally {
      pg.Client.prototype.query = clientQuery;
    }
  };
  const small = await importRows([1, 2].map(i => `PY${stamp}-10${i}`));
  const markRes = await orm.execute(sql`SELECT COALESCE(MAX(id), 0)::int AS id FROM journal_vouchers`);
  const markId = Number((markRes.rows?.[0] as { id?: number } | undefined)?.id ?? 0);
  const codes = [1, 2, 3, 4, 5, 6].map(i => `PX${stamp}-10${i}`);
  const large = await importRows(codes);
  const created = large.created;
  const perRow = (large.statements - small.statements) / 4;
  // v9.0.205 ran about 38 statements for each new item row with stock and a price (the code, case and name lookups and a
  // voucher for each item among them)
  if (perRow > 25) wrong.push(`each extra import row ran ${perRow.toFixed(1)} SQL statements (2 rows ${small.statements}, 6 rows ${large.statements}), at most 25 expected`);

  // c) the six new items with stock share one opening voucher, one debit row per item
  const openings = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
    .where(and(gt(journalVouchers.id, markId), eq(journalVouchers.referenceModule, 'item_opening'), eq(journalVouchers.isDeleted, 0)));
  if (openings.length !== 1) {
    wrong.push(`the import issued ${openings.length} opening vouchers, expected 1`);
  } else {
    const voucherId = openings[0].id;
    const links = await orm.select({ itemId: itemOpeningVoucherItems.itemId, amount: itemOpeningVoucherItems.amount })
      .from(itemOpeningVoucherItems).where(eq(itemOpeningVoucherItems.voucherId, voucherId));
    const expected = new Map(created.map(r => [r.id, (codes.indexOf(r.code) + 2) * 10000 * (codes.indexOf(r.code) + 1)]));
    const linkText = links.map(l => `${l.itemId}:${l.amount.toNumber()}`).sort().join(',');
    const expectedText = [...expected].map(([itemId, amount]) => `${itemId}:${amount}`).sort().join(',');
    if (linkText !== expectedText) wrong.push(`opening voucher items ${linkText}, expected ${expectedText}`);
    const debitRows = await orm.select({ debit: journalVoucherItems.debit }).from(journalVoucherItems)
      .where(and(eq(journalVoucherItems.voucherId, voucherId), eq(journalVoucherItems.isDeleted, 0), gt(journalVoucherItems.debit, journalVoucherItems.credit)));
    if (debitRows.length !== 6) wrong.push(`the opening voucher has ${debitRows.length} debit rows, expected 6`);
  }
  const { findOpeningVoucherMismatches } = await import('../../services/inventory/itemOpeningValue.js');
  const mismatches = (await findOpeningVoucherMismatches()).filter(m => created.some(c => c.id === Number(m.itemId)));
  if (mismatches.length > 0) wrong.push(`health check lists the imported items: ${JSON.stringify(mismatches)}`);

  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return `2-item page read stocks of ${Math.max(...sizes)} items (reserved 3 shown); ${perRow.toFixed(1)} SQL statements per extra Excel row; 6 new Excel items -> 1 opening voucher with 6 debit rows, values match the opening Kardex rows`;
}
