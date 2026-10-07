import { inArray, like } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M4 — دارنده غیرمدیر «مدیریت کاربران» و «مدیریت نقش‌ها» دسترسی خودش را بالا نمی‌برد (TD-520،
 * یافته B02-05، تصمیم ت۳ الف)، از مسیرهای واقعی Express با ورود واقعی. هر آزمون روی کد پیشین قرمز است.
 */

const codeOf = (res: { body?: { code?: unknown; error?: { code?: unknown } } }): string =>
  String(res.body?.code ?? res.body?.error?.code ?? '');

async function roleRow(h: Harness, code: string): Promise<{ id: number; permissions: string[] }> {
  const [row] = await h.q('SELECT id, permissions FROM roles WHERE code = $1', [code]);
  if (!row) throw new Error(`role ${code} not found`);
  return { id: Number(row.id), permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : [] };
}

export async function runAccessPackageTwoUserTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_role_grant_boundary_td_520', 'security', 'td520', 'roles', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_role_grant_boundary_td_520',
      name: 'v9.0.112: a non-admin roles.manage holder neither edits its own role nor grants permissions it does not hold (TD-520)',
      details: 'a role with only roles.manage: editing its own role (adding accounting.vouchers, users.manage, settings.manage) is 403 OWN_ROLE_CHANGE_REFUSED and nothing changes; a new role or another role gets only keys the holder has (403 GRANT_BEYOND_OWN_PERMISSIONS otherwise); removing keys and renaming another role still work; the system admin is not limited',
    }, async (h, wrong) => {
      const { createTestRole } = await import('../fixtures/factories.js');
      const prefix = `td520r_${h.tag}`;
      try {
        const manager = await h.sessionWith(['roles.manage']);
        const own = await roleRow(h, manager.role);

        // 1) own role
        const selfEdit = await h.put(`/api/roles/${own.id}`, { permissions: ['roles.manage', 'accounting.vouchers', 'users.manage', 'settings.manage'] }, manager);
        if (selfEdit.status !== 403 || codeOf(selfEdit) !== 'OWN_ROLE_CHANGE_REFUSED') wrong.push(`editing its own role returned ${selfEdit.status} ${codeOf(selfEdit)}, not 403 OWN_ROLE_CHANGE_REFUSED`);
        const after = await roleRow(h, manager.role);
        if (after.permissions.join(',') !== own.permissions.join(',')) wrong.push(`its own role changed to ${after.permissions.join(',')}`);

        // 2) a new role
        const beyond = await h.post('/api/roles', { name: `نقش ۵۲۰ الف ${h.tag}`, code: `${prefix}_a`, permissions: ['accounting.view'] }, manager);
        if (beyond.status !== 403 || codeOf(beyond) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`creating a role with accounting.view returned ${beyond.status} ${codeOf(beyond)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        if ((await h.q('SELECT 1 FROM roles WHERE code = $1', [`${prefix}_a`])).length > 0) wrong.push('the refused role was stored');
        const within = await h.post('/api/roles', { name: `نقش ۵۲۰ ب ${h.tag}`, code: `${prefix}_b`, permissions: ['roles.manage'] }, manager);
        if (within.status !== 200) wrong.push(`creating a role with its own key returned ${within.status}, not 200`);

        // 3) another role
        const other = await createTestRole({ code: `${prefix}_c`, permissions: ['customers.view'] });
        const grant = await h.put(`/api/roles/${other.id}`, { permissions: ['customers.view', 'accounting.vouchers'] }, manager);
        if (grant.status !== 403 || codeOf(grant) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`adding accounting.vouchers to another role returned ${grant.status} ${codeOf(grant)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        const rename = await h.put(`/api/roles/${other.id}`, { name: `نقش ۵۲۰ ج تازه ${h.tag}` }, manager);
        if (rename.status !== 200) wrong.push(`renaming another role returned ${rename.status}, not 200`);
        const remove = await h.put(`/api/roles/${other.id}`, { permissions: [] }, manager);
        if (remove.status !== 200) wrong.push(`removing a key from another role returned ${remove.status}, not 200`);
        const byAdmin = await h.put(`/api/roles/${other.id}`, { permissions: ['accounting.vouchers'] });
        if (byAdmin.status !== 200) wrong.push(`the system admin adding accounting.vouchers returned ${byAdmin.status}, not 200`);
      } finally {
        await orm.delete(roles).where(like(roles.code, `${prefix}%`));
      }
    });
  }

  if (shouldRun('sec_user_grant_boundary_td_520', 'security', 'td520', 'users', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_user_grant_boundary_td_520',
      name: 'v9.0.112: a non-admin users.manage holder neither changes its own role nor gives or takes over a stronger role (TD-520)',
      details: 'a role with users.manage and customers.view: moving itself to cfo_accountant is 403 OWN_ROLE_CHANGE_REFUSED; creating a user or moving one to a role with keys it lacks, and changing the password of or deleting a user whose role has keys it lacks, are 403 GRANT_BEYOND_OWN_PERMISSIONS; a user of a weaker role is created, edited and deleted; the system admin is not limited',
    }, async (h, wrong) => {
      const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
      const prefix = `td520u_${h.tag}`;
      const createdUsers: number[] = [];
      try {
        const manager = await h.sessionWith(['users.manage', 'customers.view']);
        const weak = await createTestRole({ code: `${prefix}_weak`, permissions: ['customers.view'] });
        const strong = await createTestRole({ code: `${prefix}_strong`, permissions: ['accounting.view', 'accounting.vouchers'] });

        // 1) its own role
        const self = await h.put(`/api/users/${manager.userId}`, { full_name: 'مدیر کاربران ۵۲۰', role: 'cfo_accountant' }, manager);
        if (self.status !== 403 || codeOf(self) !== 'OWN_ROLE_CHANGE_REFUSED') wrong.push(`moving itself to cfo_accountant returned ${self.status} ${codeOf(self)}, not 403 OWN_ROLE_CHANGE_REFUSED`);
        const [me] = await h.q('SELECT role FROM users WHERE id = $1', [manager.userId]);
        if (me?.role !== manager.role) wrong.push(`its own role changed to ${String(me?.role)}`);

        // 2) creating users
        const strongNew = await h.post('/api/users', { username: `${prefix}_s`, password: 'Passw0rd!x', full_name: 'کاربر قوی', role: strong.code }, manager);
        if (strongNew.status !== 403 || codeOf(strongNew) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`creating a user with a stronger role returned ${strongNew.status} ${codeOf(strongNew)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        const weakNew = await h.post('/api/users', { username: `${prefix}_w`, password: 'Passw0rd!x', full_name: 'کاربر ساده', role: weak.code }, manager);
        if (weakNew.status !== 200) wrong.push(`creating a user with a weaker role returned ${weakNew.status}, not 200`);
        else createdUsers.push(Number(weakNew.body.id));

        // 3) a stronger account
        const strongUser = await createTestUser({ role: strong.code });
        createdUsers.push(strongUser.id);
        const takeover = await h.put(`/api/users/${strongUser.id}`, { password: 'Taken0ver!', full_name: 'کاربر قوی', role: strong.code }, manager);
        if (takeover.status !== 403 || codeOf(takeover) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`changing the password of a stronger user returned ${takeover.status} ${codeOf(takeover)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        const removeStrong = await h.del(`/api/users/${strongUser.id}`, manager);
        if (removeStrong.status !== 403) wrong.push(`deleting a stronger user returned ${removeStrong.status}, not 403`);

        // 4) a weaker account
        const weakUser = await createTestUser({ role: weak.code });
        createdUsers.push(weakUser.id);
        const promote = await h.put(`/api/users/${weakUser.id}`, { full_name: 'کاربر ساده', role: strong.code }, manager);
        if (promote.status !== 403 || codeOf(promote) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`moving a user to a stronger role returned ${promote.status} ${codeOf(promote)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        const reset = await h.put(`/api/users/${weakUser.id}`, { password: 'Reset0nly!', full_name: 'کاربر ساده', role: weak.code }, manager);
        if (reset.status !== 200) wrong.push(`changing the password of a weaker user returned ${reset.status}, not 200`);
        const removeWeak = await h.del(`/api/users/${weakUser.id}`, manager);
        if (removeWeak.status !== 200) wrong.push(`deleting a weaker user returned ${removeWeak.status}, not 200`);

        // 5) the system admin
        const byAdmin = await h.put(`/api/users/${strongUser.id}`, { full_name: 'کاربر قوی', role: weak.code });
        if (byAdmin.status !== 200) wrong.push(`the system admin moving a user returned ${byAdmin.status}, not 200`);
      } finally {
        await orm.delete(users).where(like(users.username, `${prefix}%`));
        if (createdUsers.length > 0) await orm.delete(users).where(inArray(users.id, createdUsers));
        await orm.delete(roles).where(like(roles.code, `${prefix}%`));
      }
    });
  }

  return results;
}
