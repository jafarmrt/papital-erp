import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transactions, warehouses } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Package 6 (inventory and Kardex), TD-494 / B06-15: business errors of the warehouse transfer and the Kardex rebuild
 * are typed (422 / 404, never 500), the transfer resolves its warehouses with the shared resolver (code or name, any
 * case), and the running Kardex of a missing item is 404 instead of a made-up item. On v9.0.67 an upper-case code, a
 * warehouse name, a missing item and a negative rebuild all answered 500 and the running Kardex returned a fake item.
 */

const MISSING_ITEM_ID = 2_000_000_000;

export async function runInventoryBusinessErrorsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_inventory_business_errors_td_494';
  if (!shouldRun(id, 'td494', 'transfer', 'rebuild', 'kardex', 'inventory', 'package6')) return results;

  const name = 'v9.0.68: transfer and Kardex rebuild business errors are 422/404, warehouses resolve by code or name, missing item Kardex is 404 (TD-494)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const txIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const [mainRow] = await orm.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.code, main));
    const wh2 = await createTestWarehouse();
    const a = await createTestItem({ type: 'raw_material', stocks: { [main]: 10 }, weightedAverageCost: 1000 });
    itemIds.push(a.id);

    const wrong: string[] = [];
    const post = (path: string, body: Record<string, unknown>) => request(app).post(path)
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const transfer = (fromLocation: string, toLocation: string, itemId = a.id) =>
      post('/api/inventory/transfer', { itemId, fromLocation, toLocation, quantity: 1, date: today });
    const expect = (label: string, status: number, res: request.Response) => {
      if (res.status !== status) wrong.push(`${label}: ${res.status} (expected ${status}) ${JSON.stringify(res.body?.error ?? res.body?.message ?? '').slice(0, 120)}`);
    };

    expect('transfer with an upper-case source code', 200, await transfer(main.toUpperCase(), wh2.code));
    expect('transfer with warehouse names', 200, await transfer(mainRow?.name ?? main, wh2.name));
    expect('transfer from an unknown warehouse', 422, await transfer('no-such-warehouse-td494', wh2.code));
    expect('transfer to an unknown warehouse', 422, await transfer(main, 'no-such-warehouse-td494'));
    expect('transfer between the code and the name of one warehouse', 422, await transfer(main, mainRow?.name ?? main));
    expect('transfer of a missing item', 404, await transfer(main, wh2.code, MISSING_ITEM_ID));
    expect('rebuild of a missing item', 404, await post('/api/inventory/rebuild-from-ledger', { itemId: MISSING_ITEM_ID }));
    expect('running Kardex of a missing item', 404, await request(app).get(`/api/inventory/item-kardex/${MISSING_ITEM_ID}`).set('Cookie', admin.cookie));

    // a Kardex history that goes negative cannot be rebuilt: 422 with its own code
    const b = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 1000 });
    itemIds.push(b.id);
    const [neg] = await orm.insert(transactions).values({
      itemId: b.id, type: 'out', quantity: 2, unitPrice: money(1000), totalPrice: money(2000), date: `${today} 00:00:00`,
      documentType: 'remittance', documentRef: 'TD494-NEG', location: main, notes: 'td494', createdBy: 'td494', isDeleted: 0,
    }).returning({ id: transactions.id });
    txIds.push(neg.id);
    const negative = await post('/api/inventory/rebuild-from-ledger', { itemId: b.id });
    expect('rebuild of a negative Kardex history', 422, negative);
    if (negative.status === 422 && negative.body?.details?.code !== 'KARDEX_REBUILD_NEGATIVE_BALANCE') wrong.push(`negative rebuild code ${negative.body?.details?.code}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'upper-case code and names accepted; unknown and same warehouse 422; missing item 404 in transfer, rebuild and running Kardex; negative rebuild 422 KARDEX_REBUILD_NEGATIVE_BALANCE',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (txIds.length > 0) await orm.update(transactions).set({ isDeleted: 1 }).where(inArray(transactions.id, txIds)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
