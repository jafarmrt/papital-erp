import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-496 / B06-17 (decision t6): the «وضعیت انبار» warehouse chart shows the number of
 * items with stock in each warehouse. On v9.0.95 it had only the sum of quantities, so 10 pairs + 3 metres + 50 pieces
 * showed as «۶۳ قلم» for three items.
 */
export async function runWarehouseItemCountTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_warehouse_item_count_td_496';
  if (!shouldRun(id, 'td496', 'dashboard', 'warehouse', 'package6')) return results;

  const name = 'v9.0.96: the warehouse chart counts items with stock per warehouse, never adds quantities of different units (TD-496)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { invalidateDashboardBiCache } = await import('../../routes/dashboard.routes.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wh = await createTestWarehouse();
    for (const [unit, qty] of [['جفت', 10], ['متر', 3], ['عدد', 50]] as const) {
      const it = await createTestItem({ unit, stocks: { [wh.code]: qty } });
      itemIds.push(it.id);
    }
    const empty = await createTestItem({ unit: 'عدد', stocks: { [wh.code]: 0 } });
    itemIds.push(empty.id);

    invalidateDashboardBiCache();
    const bi = await request(app).get('/api/dashboard-bi-stats').set('Cookie', admin.cookie);
    const count = Number(bi.body?.locationItemCounts?.[wh.code]);
    if (bi.status !== 200 || count !== 3) {
      throw new Error(`warehouse ${wh.code}: status ${bi.status}, item count ${bi.body?.locationItemCounts?.[wh.code]}, quantity sum ${bi.body?.locations?.[wh.code]}; expected 3 items`);
    }
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `3 items with stock (quantity sum ${bi.body?.locations?.[wh.code]})`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
