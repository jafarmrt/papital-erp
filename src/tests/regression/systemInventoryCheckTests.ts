import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-495 / B06-16: the system reconciliation scan reported the inventory layer with a
 * constant `status: 'ok'` (category misspelled «کالاهها») even when the stock integrity report had discrepancies.
 * On v9.0.108 an item whose warehouse stock has no Kardex rows still left `inventory_kardex` «ok».
 */
export async function runSystemInventoryCheckTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_system_inventory_check_td_495';
  if (!shouldRun(id, 'td495', 'reconciliation', 'inventory', 'package6')) return results;

  const name = 'v9.0.109: the system reconciliation scan warns on stock integrity discrepancies instead of a constant ok (TD-495)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];

    // stock in item_warehouse_stocks without any Kardex row: a three-way discrepancy
    const it = await createTestItem({ stocks: { '': 5 } });
    itemIds.push(it.id);

    const res = await request(app).get('/api/system/reconciliation-check').set('Cookie', admin.cookie);
    const check = (Array.isArray(res.body?.checks) ? res.body.checks : [])
      .find((c: { id?: string }) => c.id === 'inventory_kardex') as { status?: string; category?: string; details?: string } | undefined;
    if (res.status !== 200 || !check) wrong.push(`scan answered ${res.status} without inventory_kardex`);
    else {
      if (check.status !== 'warning') wrong.push(`inventory_kardex status ${check.status} with a discrepant item; expected warning`);
      if (check.category !== 'انبارداری و کالاها') wrong.push(`category «${check.category}»`);
      if (/[0-9]/.test(String(check.details))) wrong.push(`details carry Latin digits: ${check.details}`);
    }

    // the healthy case is decided by the same summary fields
    const mod: Record<string, unknown> = await import('../../services/system/systemReconciliation.service.js');
    const inventoryKardexCheck = mod.inventoryKardexCheck as
      | ((count: number, summary: { discrepancyItems: number; negativeStockItems: number }) => { status: string })
      | undefined;
    if (typeof inventoryKardexCheck !== 'function') wrong.push('inventoryKardexCheck is missing');
    else {
      const healthy = inventoryKardexCheck(3, { discrepancyItems: 0, negativeStockItems: 0 });
      if (healthy.status !== 'ok') wrong.push(`clean summary gave ${healthy.status}`);
      const negative = inventoryKardexCheck(3, { discrepancyItems: 0, negativeStockItems: 1 });
      if (negative.status !== 'warning') wrong.push(`negative Kardex balance gave ${negative.status}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `inventory_kardex: ${check?.status}`,
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
