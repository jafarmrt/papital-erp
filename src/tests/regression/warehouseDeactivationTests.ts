import request from 'supertest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, items, roles, users, warehouses } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-490 / B06-11 (decision t5 «الف»): deactivating a warehouse checked «no stock»
 * without a lock on the warehouse row and without a last-active-warehouse rule, and nothing could reactivate it. On
 * v9.0.108 a deactivation during an uncommitted receipt answered 200 and left 7 units in an inactive warehouse, the last
 * active warehouse was deactivated, a movement with a resolved inactive warehouse still moved stock and there was no
 * reactivation route.
 */
export async function runWarehouseDeactivationTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_warehouse_deactivation_td_490';
  if (!shouldRun(id, 'td490', 'warehouse', 'deactivate', 'reactivate', 'package6')) return results;

  const name = 'v9.0.109: warehouse deactivation waits for in-flight movements, keeps the last active warehouse and can be undone by the system admin (TD-490)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const warehouseIds: number[] = [];
  const userIds: number[] = [];
  const roleIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
    const { WarehouseService } = await import('../../services/warehouse.service.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    const del = (whId: number) => request(app).delete(`/api/warehouses/${whId}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    const isActive = async (whId: number) => (await orm.select({ a: warehouses.isActive }).from(warehouses).where(eq(warehouses.id, whId)))[0]?.a;

    // 1) a deactivation while a receipt into the warehouse is not committed waits for it and then sees the stock
    const wh = await createTestWarehouse();
    warehouseIds.push(wh.id);
    const item = await createTestItem({ stocks: {} });
    itemIds.push(item.id);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(r => { release = r; });
    let moved!: () => void;
    const movedSignal = new Promise<void>(r => { moved = r; });
    const receipt = orm.transaction(async (tx) => {
      await ItemWarehouseStockService.applyMovement(tx, { itemId: item.id, warehouse: { id: wh.id, code: wh.code, name: wh.name }, inOut: 'in', quantity: 7 });
      moved();
      await gate;
    });
    await movedSignal;
    let deactivationSettled = false;
    const deactivation = del(wh.id).then(r => { deactivationSettled = true; return r; });
    await new Promise(r => setTimeout(r, 400));
    if (deactivationSettled) wrong.push('deactivation answered while a receipt into the warehouse was not committed');
    release();
    await receipt;
    const raced = await deactivation;
    if (raced.status !== 409) wrong.push(`deactivation after a committed receipt of 7 answered ${raced.status}`);
    if ((await isActive(wh.id)) !== 1) wrong.push('warehouse with 7 units was deactivated');

    // 2) a movement with a resolved warehouse that is deactivated meanwhile is refused
    const empty = await createTestWarehouse({ code: `td490_${Date.now()}` });
    warehouseIds.push(empty.id);
    const off = await del(empty.id);
    if (off.status !== 200) wrong.push(`deactivating an empty warehouse answered ${off.status}`);
    let lateMovement = 'accepted';
    try {
      await orm.transaction(tx => ItemWarehouseStockService.applyMovement(tx, { itemId: item.id, warehouse: { id: empty.id, code: empty.code, name: empty.name }, inOut: 'in', quantity: 1 }));
    } catch (err) {
      lateMovement = (err as { code?: string }).code ?? 'error';
    }
    if (lateMovement !== 'WAREHOUSE_INACTIVE') wrong.push(`movement into an inactive warehouse: ${lateMovement}`);

    // 3) the last active warehouse is not deactivated (other warehouses switched off inside a rolled-back transaction)
    let lastActive = 'accepted';
    try {
      await orm.transaction(async (tx) => {
        await tx.update(warehouses).set({ isActive: 0 }).where(and(eq(warehouses.isActive, 1), inArray(warehouses.id, (await tx.select({ id: warehouses.id }).from(warehouses)).map(w => w.id).filter(x => x !== empty.id && x !== wh.id))));
        await tx.update(warehouses).set({ isActive: 1 }).where(eq(warehouses.id, empty.id));
        await tx.update(warehouses).set({ isActive: 0 }).where(eq(warehouses.id, wh.id));
        await WarehouseService.deactivateWarehouse(empty.id, tx);
        throw new Error('rollback');
      });
    } catch (err) {
      lastActive = (err as { code?: string }).code ?? (err instanceof Error ? err.message : 'error');
    }
    if (lastActive !== 'WAREHOUSE_LAST_ACTIVE') wrong.push(`deactivating the last active warehouse: ${lastActive}`);

    // 4) creating the inactive code again points to reactivation; the list shows inactive warehouses on request
    const again = await request(app).post('/api/warehouses').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send({ name: 'td490', code: empty.code });
    if (again.status !== 409 || !String(again.body?.error ?? again.body?.message ?? '').includes('دوباره فعال')) wrong.push(`re-creating an inactive code answered ${again.status} ${JSON.stringify(again.body).slice(0, 160)}`);
    const listed = await request(app).get('/api/warehouses?includeInactive=1').set('Cookie', admin.cookie);
    if (!(Array.isArray(listed.body) && listed.body.some((w: { id: number }) => w.id === empty.id))) wrong.push(`includeInactive list answered ${listed.status} without the inactive warehouse`);
    const defaultList = await request(app).get('/api/warehouses').set('Cookie', admin.cookie);
    if (Array.isArray(defaultList.body) && defaultList.body.some((w: { id: number }) => w.id === empty.id)) wrong.push('default list shows an inactive warehouse');

    // 5) reactivation: system admin only, audited, once
    const role = await createTestRole({ permissions: ['warehouse.view', 'warehouse.manage'] });
    roleIds.push(role.id);
    const keeper = await createTestUser({ role: role.code });
    userIds.push(keeper.id);
    const keeperSession = await loginTestUserWithSession(app, keeper.username);
    const reactivate = (s: { cookie: string; csrfToken: string }) => request(app).post(`/api/warehouses/${empty.id}/reactivate`).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken);
    const byKeeper = await reactivate(keeperSession);
    if (byKeeper.status !== 403) wrong.push(`reactivation by a warehouse manager answered ${byKeeper.status}`);
    const byAdmin = await reactivate(admin);
    if (byAdmin.status !== 200 || (await isActive(empty.id)) !== 1) wrong.push(`reactivation by the system admin answered ${byAdmin.status}`);
    const [log] = await orm.select().from(activityLogs).where(and(eq(activityLogs.entity, 'انبار'), eq(activityLogs.entityId, String(empty.id)), eq(activityLogs.action, 'RESTORE'))).orderBy(desc(activityLogs.id)).limit(1);
    const details = (log?.details ?? {}) as { before?: { isActive?: number }; after?: { isActive?: number } };
    if (!log || details.before?.isActive !== 0 || details.after?.isActive !== 1) wrong.push(`reactivation audit ${JSON.stringify(log?.details ?? null)}`);
    const twice = await reactivate(admin);
    if (twice.status !== 409) wrong.push(`reactivating an active warehouse answered ${twice.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'race refused with 409, last warehouse kept, inactive movement refused, reactivation audited',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    if (warehouseIds.length > 0) await orm.update(warehouses).set({ isActive: 0 }).where(inArray(warehouses.id, warehouseIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
