import request from 'supertest';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transactions, warehouses } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-482 / B06-03: the Kardex ledger reads '' and 'default' as the default warehouse,
 * so a warehouse coded «default» shared its rows with the default warehouse and reconciliation, repair and rebuild moved
 * its stock there. On v9.0.107 `POST /warehouses {code:"default"}` answered 200, a void of a row without a warehouse
 * wrote the alias 'default' on its reversal, and the health check did not list such a warehouse.
 */
export async function runWarehouseReservedCodeTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_warehouse_reserved_code_td_482';
  if (!shouldRun(id, 'td482', 'warehouse', 'default', 'package6')) return results;

  const name = 'v9.0.108: a warehouse code «default» is refused, a reversal names a real warehouse and a legacy «default» warehouse is listed by the health check (TD-482)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const legacyWarehouseIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { findReservedCodeWarehouses, buildReservedWarehouseCodeHealthTest } = await import('../../services/inventory/reservedWarehouseCode.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];

    // a) creating a warehouse with a ledger alias code
    for (const code of ['default', ' Default ']) {
      const res = await request(app).post('/api/warehouses').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
        .send({ name: `td482 ${code}`, code });
      if (res.status !== 422) wrong.push(`POST /warehouses code «${code}» answered ${res.status}`);
    }
    const created = await orm.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, 'default'));
    if (created.length > 0) wrong.push(`a warehouse coded default exists after the refused requests (${created.length})`);

    // b) voiding a document whose Kardex row has no warehouse (a legacy row)
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const today = await businessTodayIsoDate();
    const a = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(a.id);
    const docId = await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td482', buyerName: 'td482',
      location: main, items: [{ itemId: a.id, quantity: 4, unit_price: 100, location: main }],
    });
    await orm.update(transactions).set({ location: '' }).where(eq(transactions.documentId, docId));
    await DocumentService.deleteDocument(docId, 'td482');
    const [reversal] = await orm.select({ location: transactions.location }).from(transactions)
      .where(and(eq(transactions.documentId, docId), isNotNull(transactions.reversalOfId)));
    if (!reversal || reversal.location !== main) wrong.push(`reversal of a row without a warehouse has location «${reversal?.location}», expected «${main}»`);

    // c) a warehouse coded «default» from before this version is listed, not changed
    const [legacy] = await orm.insert(warehouses).values({ name: 'td482 legacy default', code: 'default', isActive: 1 }).returning();
    legacyWarehouseIds.push(legacy.id);
    const health = buildReservedWarehouseCodeHealthTest(await findReservedCodeWarehouses());
    if (health.status !== 'warning' || !health.items?.some(r => r.id === legacy.id)) wrong.push(`health check ${health.status} without warehouse ${legacy.id}`);
    const [after] = await orm.select({ code: warehouses.code, isActive: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, legacy.id));
    if (after?.code !== 'default' || after?.isActive !== 1) wrong.push(`the legacy warehouse was changed: ${JSON.stringify(after)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `default refused with 422; reversal at ${main}; legacy warehouse ${legacy.id} listed unchanged`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    // the legacy row is a test fixture without stock; it is removed so later health checks stay clean
    if (legacyWarehouseIds.length > 0) await orm.delete(warehouses).where(inArray(warehouses.id, legacyWarehouseIds)).catch(() => undefined);
    await orm.delete(warehouses).where(eq(warehouses.code, 'default')).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
