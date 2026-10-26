import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, roles, users } from '../../db/schema.js';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * Closing sweep, decision ت۴۰ items 5 and 6:
 * - OBS-PR-13: the key audit.create opened nothing and leaves the catalog.
 * - OBS-R1-41: deleting a party asks its own key customers.delete.
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

  return results;
}
