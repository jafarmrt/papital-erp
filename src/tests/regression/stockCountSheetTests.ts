import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { documents, items, warehouses } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-480 / B06-01: the stock-count sheet reads the book stock of the warehouse it
 * is given by code OR name (unknown location = 422), and a posted count whose shown book stock is stale is refused
 * with 409 (decision t7). On v9.0.54 the sheet asked by warehouse name, every row showed 0 and «copy + submit»
 * zeroed the warehouse.
 */

export async function runStockCountSheetTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_stock_count_sheet_book_stock_td_480';
  if (!shouldRun(id, 'td480', 'audit', 'stocktake', 'inventory', 'package6')) return results;

  const name = 'v9.0.55: stock-count sheet reads the warehouse by code or name, refuses an unknown one, and a stale book stock is refused with 409 (TD-480)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const docIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const code = (await getDefaultWarehouseCode(orm)) as string;
    const [wh] = await orm.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.code, code));
    const a = await createTestItem({ type: 'raw_material', stocks: { [code]: 10 }, weightedAverageCost: 1000 });
    const b = await createTestItem({ type: 'raw_material', stocks: { [code]: 4 }, weightedAverageCost: 2500 });
    itemIds.push(a.id, b.id);

    const wrong: string[] = [];
    const sheet = async (location: string) => request(app)
      .get(`/api/documents/audit-items?location=${encodeURIComponent(location)}`)
      .set('Cookie', admin.cookie);
    const rowOf = (body: unknown, itemId: number) =>
      (Array.isArray(body) ? body : []).find((r: { id?: number }) => r.id === itemId) as { system_stock?: number; location?: string } | undefined;

    for (const loc of [code, wh?.name ?? code, code.toUpperCase(), '']) {
      const res = await sheet(loc);
      const ra = rowOf(res.body, a.id);
      const rb = rowOf(res.body, b.id);
      if (res.status !== 200 || ra?.system_stock !== 10 || rb?.system_stock !== 4 || ra?.location !== code) {
        wrong.push(`location "${loc}": status ${res.status}, A=${ra?.system_stock} B=${rb?.system_stock} location=${ra?.location} (expected 10, 4, ${code})`);
      }
    }
    const unknown = await sheet('no-such-warehouse-td480');
    if (unknown.status !== 422) wrong.push(`unknown location answered ${unknown.status}, expected 422`);

    const stockOf = async (itemId: number) => (await ItemWarehouseStockService.getStocksForItems(orm, [itemId])).get(itemId)?.byCode[code] ?? 0;
    const post = (lines: Array<{ itemId: number; system_stock?: number; physical_stock: number }>) => request(app)
      .post('/api/documents')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({
        docType: 'audit', refNumber: 'auto', date: today, location: code, status: 'final', notes: 'td480',
        items: lines.map(l => ({ ...l, quantity: l.physical_stock, location: code })),
      });

    // the sheet showed A=10, but the stock changed to 12 before posting: 409 and nothing moves
    await orm.transaction(async (tx) => {
      const { DocumentStockEngine } = await import('../../services/documents/documentStockEngine.service.js');
      await DocumentStockEngine.applyStockMovement(tx, {
        itemId: a.id, inOut: 'in', quantity: 2, price: 1000, date: today, documentType: 'receipt',
        documentRef: 'TD480-IN', user: 'td480', notes: 'td480', targetLoc: code,
      } as Parameters<typeof DocumentStockEngine.applyStockMovement>[1]);
    });
    const stale = await post([{ itemId: a.id, system_stock: 10, physical_stock: 10 }, { itemId: b.id, system_stock: 4, physical_stock: 4 }]);
    const staleItems = (stale.body?.details?.items ?? []) as Array<{ itemId: number; shown: number; current: number }>;
    if (stale.status !== 409 || stale.body?.code !== 'AUDIT_BOOK_STOCK_CHANGED') wrong.push(`stale book stock answered ${stale.status} ${stale.body?.code}, expected 409 AUDIT_BOOK_STOCK_CHANGED`);
    if (staleItems.length !== 1 || staleItems[0]?.itemId !== a.id || staleItems[0]?.shown !== 10 || staleItems[0]?.current !== 12) {
      wrong.push(`409 details ${JSON.stringify(staleItems)}, expected only item A shown 10 current 12`);
    }
    if ((await stockOf(a.id)) !== 12 || (await stockOf(b.id)) !== 4) wrong.push(`stock moved after a refused count: A=${await stockOf(a.id)} B=${await stockOf(b.id)}`);

    // reloaded sheet: A=12 is shown and counted 11, B matches: only the one-unit shortage is posted
    const ok = await post([{ itemId: a.id, system_stock: 12, physical_stock: 11 }, { itemId: b.id, system_stock: 4, physical_stock: 4 }]);
    if (ok.status !== 200 && ok.status !== 201) wrong.push(`fresh count answered ${ok.status}: ${JSON.stringify(ok.body).slice(0, 200)}`);
    const [doc] = await orm.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.type, 'audit'), eq(documents.notes, 'td480'), eq(documents.isDeleted, 0)));
    if (doc) docIds.push(doc.id);
    if ((await stockOf(a.id)) !== 11 || (await stockOf(b.id)) !== 4) wrong.push(`after the fresh count A=${await stockOf(a.id)} B=${await stockOf(b.id)}, expected 11 and 4`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'sheet by code, name, upper-case code and empty location showed 10 and 4 with the warehouse code; unknown location 422; stale book stock 409 with item A only and no movement; fresh count posted only the shortage',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (docIds.length > 0) await orm.update(documents).set({ isDeleted: 1 }).where(inArray(documents.id, docIds)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
