import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, customers, roles, users } from '../../db/schema.js';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Closing sweep, decision ت۴۰ items 5 and 6:
 * - OBS-PR-13: the key audit.create opened nothing and leaves the catalog; migration 0123 removes it from every role.
 * - OBS-R1-41: deleting a party asks its own key customers.delete; migration 0123 gives it to every role holding
 *   customers.manage, so no role loses the delete on the day of release.
 * Red on v10.1.59, where customers.manage deleted a party and audit.create was a catalog key.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;

const catalogKeys = () => new Set(PERMISSION_CATALOG.flatMap(c => c.permissions.map(p => p.key)));

export async function runClosingPermissionKeysTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const deleteId = 'reg_customer_delete_key_obs_r1_41';
  if (shouldRun(deleteId, 'obs_r1_41', 'obs_pr_13', 'customers', 'permissions')) {
    const tStart = Date.now();
    const roleIds: number[] = [];
    const userIds: number[] = [];
    const customerIds: number[] = [];
    try {
      const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
      const { createTestRole, createTestUser, createTestCustomer } = await import('../fixtures/factories.js');
      const app = await getTestApp();
      const wrong: string[] = [];
      const keys = catalogKeys();
      if (!keys.has('customers.delete')) wrong.push('the catalog has no customers.delete');
      if (keys.has('audit.create')) wrong.push('the catalog still has audit.create');

      const sessionWith = async (permissions: string[]) => {
        const role = await createTestRole({ permissions });
        roleIds.push(role.id);
        const user = await createTestUser({ role: role.code });
        userIds.push(user.id);
        return loginTestUserWithSession(app, user.username);
      };
      const remove = async (session: { cookie: string; csrfToken: string }) => {
        const party = await createTestCustomer({ phone: `0912${String(Date.now()).slice(-7)}` });
        customerIds.push(party.id);
        return request(app).delete(`/api/customers/${party.id}`).set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken);
      };
      const manager = await remove(await sessionWith(['customers.view', 'customers.manage']));
      if (manager.status !== 403) wrong.push(`customers.manage alone deleted a party: ${manager.status}`);
      const deleter = await remove(await sessionWith(['customers.view', 'customers.delete']));
      if (deleter.status !== 200) wrong.push(`customers.delete could not delete a party: ${deleter.status} ${JSON.stringify(deleter.body).slice(0, 160)}`);

      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id: deleteId, name: 'OBS-R1-41 / OBS-PR-13: deleting a party asks customers.delete; audit.create is no catalog key',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'customers.manage alone -> 403 on DELETE /customers/:id; customers.delete -> 200; audit.create gone from the catalog',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: deleteId, name: 'OBS-R1-41: deleting a party asks customers.delete', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (customerIds.length > 0) await orm.delete(customers).where(inArray(customers.id, customerIds)).catch(() => undefined);
      if (userIds.length > 0) await orm.delete(users).where(inArray(users.id, userIds)).catch(() => undefined);
      if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
    }
  }

  const migrationId = 'reg_closing_permission_migration_obs_pr_13';
  if (shouldRun(migrationId, 'obs_pr_13', 'obs_r1_41', 'migration', 'permissions')) {
    const tStart = Date.now();
    const roleIds: number[] = [];
    try {
      const { createTestRole } = await import('../fixtures/factories.js');
      const both = await createTestRole({ permissions: ['audit.view', 'audit.create', 'customers.view', 'customers.manage'] });
      const viewer = await createTestRole({ permissions: ['customers.view'] });
      const already = await createTestRole({ permissions: ['customers.view', 'customers.manage', 'customers.delete'] });
      roleIds.push(both.id, viewer.id, already.id);
      const file = path.join(process.cwd(), 'drizzle', '0123_closing_permission_keys.sql');
      const statements = fs.readFileSync(file, 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      const run = () => orm.transaction(async (tx) => { for (const s of statements) await tx.execute(sql.raw(s)); });
      await run();
      await run();
      const perms = async (id: number) => {
        const [row] = await orm.select({ p: roles.permissions }).from(roles).where(eq(roles.id, id));
        return (row?.p ?? []) as string[];
      };
      const wrong: string[] = [];
      const b = await perms(both.id);
      if (b.includes('audit.create')) wrong.push(`audit.create left on the role: ${JSON.stringify(b)}`);
      if (b.filter(k => k === 'customers.delete').length !== 1 || !b.includes('audit.view')) wrong.push(`role holding customers.manage: ${JSON.stringify(b)}`);
      if ((await perms(viewer.id)).includes('customers.delete')) wrong.push('a role without customers.manage got customers.delete');
      if ((await perms(already.id)).filter(k => k === 'customers.delete').length !== 1) wrong.push('a role already holding customers.delete got it twice');
      const logs = await orm.select({ id: activityLogs.id }).from(activityLogs)
        .where(and(eq(activityLogs.entityId, String(both.id)), sql`${activityLogs.details}->>'migration' = '0123_closing_permission_keys'`));
      if (logs.length !== 1) wrong.push(`the changed role has ${logs.length} migration audit rows, expected 1`);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({
        id: migrationId, name: 'OBS-PR-13 / OBS-R1-41: migration 0123 removes audit.create and gives customers.delete to customers.manage roles, once',
        layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
        details: 'run twice: audit.create removed, customers.delete added once with one audit row; other roles untouched',
      }));
    } catch (err) {
      results.push(makeTestCase({
        id: migrationId, name: 'OBS-PR-13: migration 0123 permission keys', layer: 'regression', executionType: 'real_database',
        passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (roleIds.length > 0) await deleteTestRoles(inArray(roles.id, roleIds)).catch(() => undefined);
    }
  }
  return results;
}
