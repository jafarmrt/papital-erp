import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { accounts, items, journalVoucherItems, journalVouchers, roles, users } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Package 6 (inventory and Kardex), TD-487 / B06-08 (decision t3): the Kardex rebuild only rebuilds quantities and
 * reports a WAC that differs from the Kardex replay; it never changes the WAC. «اصلاح بهای میانگین» is a separate action
 * with its own permission (inventory.wac_correct, granted to no role; admin always) that sets the WAC to the replay and, in
 * the same transaction, issues a draft voucher for the value difference against 7012. On v9.0.76 the rebuild changed the
 * WAC (150 -> 100 on 10 units) without any voucher, ignored fixWAC:false, and anyone with inventory.reconcile ran it.
 */
export async function runKardexWacCorrectionTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_kardex_wac_correction_td_487';
  if (!shouldRun(id, 'td487', 'rebuild', 'wac', 'kardex', 'inventory', 'package6')) return results;

  const name = 'v9.0.77: the Kardex rebuild keeps WAC and reports the difference; WAC correction is a separate permission with a draft voucher against 7012 (TD-487)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const userIds: number[] = [];
  const roleIds: number[] = [];
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const a = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(a.id);
    await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td487', buyerName: 'td487',
      location: main, items: [{ itemId: a.id, quantity: 10, unit_price: 100, location: main }],
    });
    // a WAC that no longer matches the Kardex (what B06-02 / B06-09 produced)
    await orm.update(items).set({ weightedAverageCost: money(150) }).where(eq(items.id, a.id));

    const wrong: string[] = [];
    const wacOf = async () => Number((await orm.select({ w: items.weightedAverageCost }).from(items).where(eq(items.id, a.id)))[0]?.w);
    const vouchersOf = () => orm.select({ id: journalVouchers.id, status: journalVouchers.status }).from(journalVouchers)
      .where(and(eq(journalVouchers.referenceModule, 'inventory_wac_correction'), eq(journalVouchers.referenceId, a.id), eq(journalVouchers.isDeleted, 0)));
    const post = (session: { cookie: string; csrfToken: string }, path: string, body: Record<string, unknown>) =>
      request(app).post(path).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken).send(body);

    // 1) the rebuild keeps the WAC and reports the replay
    const rebuilt = await post(admin, '/api/inventory/rebuild-from-ledger', { itemId: a.id, fixWAC: true });
    if (rebuilt.status !== 200) wrong.push(`rebuild answered ${rebuilt.status}`);
    if ((await wacOf()) !== 150) wrong.push(`rebuild changed the WAC to ${await wacOf()}`);
    if (rebuilt.body?.data?.replayWac !== 100 || rebuilt.body?.data?.wacDiffers !== true || rebuilt.body?.data?.valueDifference !== -500) {
      wrong.push(`rebuild report ${JSON.stringify({ r: rebuilt.body?.data?.replayWac, d: rebuilt.body?.data?.wacDiffers, v: rebuilt.body?.data?.valueDifference })}`);
    }
    const all = await post(admin, '/api/inventory/rebuild-from-ledger', {});
    const listed = (all.body?.data?.wacDifferences ?? []).find((d: { itemId: number }) => d.itemId === a.id);
    if (!listed || listed.replayWac !== 100 || (await wacOf()) !== 150) wrong.push(`rebuild of all items listed ${JSON.stringify(listed)} WAC ${await wacOf()}`);

    // 2) inventory.reconcile alone may not correct the WAC
    const reconcileRole = await createTestRole({ permissions: ['inventory.reconcile', 'warehouse.view'] });
    roleIds.push(reconcileRole.id);
    const keeper = await createTestUser({ role: reconcileRole.code });
    userIds.push(keeper.id);
    const keeperSession = await loginTestUserWithSession(app, keeper.username);
    const refused = await post(keeperSession, '/api/inventory/correct-wac', { itemId: a.id });
    if (refused.status !== 403) wrong.push(`correct-wac with inventory.reconcile only answered ${refused.status}`);

    // 3) the correction sets the replay WAC and issues one draft voucher: Dr 7012 500 / Cr raw materials 500
    const corrected = await post(admin, '/api/inventory/correct-wac', { itemId: a.id });
    if (corrected.status !== 200) wrong.push(`correct-wac answered ${corrected.status}: ${JSON.stringify(corrected.body).slice(0, 200)}`);
    if ((await wacOf()) !== 100) wrong.push(`WAC after the correction ${await wacOf()}`);
    const vouchers = await vouchersOf();
    if (vouchers.length !== 1 || vouchers[0].status !== 'draft') wrong.push(`correction vouchers ${JSON.stringify(vouchers)}`);
    else {
      const lines = await orm.select({ code: accounts.code, debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
        .from(journalVoucherItems).innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
        .where(and(eq(journalVoucherItems.voucherId, vouchers[0].id), eq(journalVoucherItems.isDeleted, 0)));
      const key = lines.map(l => `${l.code}:${Number(l.debit)}/${Number(l.credit)}`).sort().join(',');
      if (key !== ['1401:0/500', '7012:500/0'].join(',')) wrong.push(`correction voucher lines ${key}`);
    }

    // 4) a matching WAC is not corrected again
    const again = await post(admin, '/api/inventory/correct-wac', { itemId: a.id });
    if (again.status !== 422 || again.body?.details?.code !== 'WAC_ALREADY_MATCHES_KARDEX') wrong.push(`second correction answered ${again.status} ${again.body?.details?.code}`);
    if ((await vouchersOf()).length !== 1) wrong.push('a second correction voucher was issued');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'rebuild kept WAC 150 and reported replay 100 (value -500); inventory.reconcile alone 403 on correct-wac; correction set WAC 100 with draft voucher Dr 7012 500 / Cr 1401 500; repeat 422',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
    if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
  }
  return results;
}
