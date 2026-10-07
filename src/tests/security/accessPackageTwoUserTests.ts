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

  if (shouldRun('sec_deleted_username_new_identity_td_519', 'security', 'td519', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_deleted_username_new_identity_td_519',
      name: 'v9.0.170: a deleted user\'s username never revives that account; restoring the same person is a separate action (TD-519)',
      details: 'POST /users with the username of a deleted user is 409 USERNAME_OF_DELETED_USER naming that user, and the deleted row keeps its name, role and password; POST /users/:id/restore brings back the same id and name with the chosen role, a temporary password that must be changed and a new token version; restoring an active user is 409 USER_NOT_DELETED; a non-admin users.manage holder neither restores a former system admin nor gives a restored user a role beyond its own keys (403)',
    }, async (h, wrong) => {
      const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
      const prefix = `td519_${h.tag}`;
      try {
        const weak = await createTestRole({ code: `${prefix}_weak`, permissions: ['customers.view'] });
        const strong = await createTestRole({ code: `${prefix}_strong`, permissions: ['accounting.view', 'accounting.vouchers'] });
        const first = await createTestUser({ username: `${prefix}_ali`, fullName: 'علی رضایی', role: strong.code });
        const removed = await h.del(`/api/users/${first.id}`);
        if (removed.status !== 200) wrong.push(`deleting the first user returned ${removed.status}, not 200`);
        const [deletedRow] = await h.q('SELECT password, token_version FROM users WHERE id = $1', [first.id]);

        // 1) a new person with the same username
        const again = await h.post('/api/users', { username: `${prefix}_ali`, password: 'Passw0rd!x', full_name: 'علی محمدی', role: weak.code });
        const deletedUser = (again.body?.details as { deletedUser?: { id?: number } } | undefined)?.deletedUser;
        if (again.status !== 409 || codeOf(again) !== 'USERNAME_OF_DELETED_USER') wrong.push(`creating a user with a deleted user's username returned ${again.status} ${codeOf(again)}, not 409 USERNAME_OF_DELETED_USER`);
        if (deletedUser?.id !== first.id) wrong.push(`the refusal named user ${String(deletedUser?.id)}, not the deleted user ${first.id}`);
        if (!String(again.body?.error ?? '').includes('علی رضایی')) wrong.push(`the refusal did not name the deleted user: ${String(again.body?.error)}`);
        const [stillDeleted] = await h.q('SELECT is_deleted, full_name, role, password FROM users WHERE id = $1', [first.id]);
        if (Number(stillDeleted?.is_deleted) !== 1) wrong.push('the deleted account was revived');
        if (stillDeleted?.full_name !== 'علی رضایی' || stillDeleted?.role !== strong.code || stillDeleted?.password !== deletedRow?.password) {
          wrong.push(`the deleted account changed: ${String(stillDeleted?.full_name)} / ${String(stillDeleted?.role)}`);
        }
        const other = await h.post('/api/users', { username: `${prefix}_ali2`, password: 'Passw0rd!x', full_name: 'علی محمدی', role: weak.code });
        if (other.status !== 200 || Number(other.body?.id) === first.id) wrong.push(`a new username returned ${other.status} with id ${String(other.body?.id)}`);

        // 2) restoring the same person
        const restore = await h.post(`/api/users/${first.id}/restore`, { role: weak.code, password: 'Tempor4ry!' });
        if (restore.status !== 200 || Number(restore.body?.id) !== first.id) wrong.push(`restoring returned ${restore.status} with id ${String(restore.body?.id)}`);
        const [back] = await h.q('SELECT is_deleted, full_name, role, must_reset_password, token_version FROM users WHERE id = $1', [first.id]);
        if (Number(back?.is_deleted) !== 0 || back?.full_name !== 'علی رضایی' || back?.role !== weak.code) {
          wrong.push(`the restored account is ${String(back?.is_deleted)} / ${String(back?.full_name)} / ${String(back?.role)}`);
        }
        if (Number(back?.must_reset_password) !== 1) wrong.push('the restored account does not have to change its temporary password');
        if (Number(back?.token_version) !== Number(deletedRow?.token_version) + 1) wrong.push(`token version ${String(back?.token_version)}, not ${Number(deletedRow?.token_version) + 1}`);
        const twice = await h.post(`/api/users/${first.id}/restore`, { role: weak.code, password: 'Tempor4ry!' });
        if (twice.status !== 409 || codeOf(twice) !== 'USER_NOT_DELETED') wrong.push(`restoring an active user returned ${twice.status} ${codeOf(twice)}, not 409 USER_NOT_DELETED`);

        // 3) a non-admin users.manage holder
        const manager = await h.sessionWith(['users.manage', 'customers.view']);
        const formerAdmin = await createTestUser({ username: `${prefix}_adm`, role: 'admin' });
        await h.del(`/api/users/${formerAdmin.id}`);
        const adminBack = await h.post(`/api/users/${formerAdmin.id}/restore`, { role: weak.code, password: 'Tempor4ry!' }, manager);
        if (adminBack.status !== 403) wrong.push(`a users.manage holder restoring a former system admin returned ${adminBack.status}, not 403`);
        const weakUser = await createTestUser({ username: `${prefix}_w`, role: weak.code });
        await h.del(`/api/users/${weakUser.id}`);
        const stronger = await h.post(`/api/users/${weakUser.id}/restore`, { role: strong.code, password: 'Tempor4ry!' }, manager);
        if (stronger.status !== 403 || codeOf(stronger) !== 'GRANT_BEYOND_OWN_PERMISSIONS') wrong.push(`restoring with a stronger role returned ${stronger.status} ${codeOf(stronger)}, not 403 GRANT_BEYOND_OWN_PERMISSIONS`);
        const within = await h.post(`/api/users/${weakUser.id}/restore`, { role: weak.code, password: 'Tempor4ry!' }, manager);
        if (within.status !== 200) wrong.push(`restoring with a role within its keys returned ${within.status}, not 200`);
      } finally {
        await orm.delete(users).where(like(users.username, `${prefix}%`));
        await orm.delete(roles).where(like(roles.code, `${prefix}%`));
      }
    });
  }

  if (shouldRun('sec_role_delete_counts_active_users_td_535', 'security', 'td535', 'roles', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_role_delete_counts_active_users_td_535',
      name: 'v9.0.171: a role whose only user was deleted can be deleted, and that user is restored with a new role (TD-535)',
      details: 'DELETE /roles/:id is refused while an active user holds the role; once that user is deleted the role is deleted (it used to say «assigned to 1 user»); restoring the deleted user then takes another existing role',
    }, async (h, wrong) => {
      const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
      const prefix = `td535_${h.tag}`;
      try {
        const temp = await createTestRole({ code: `${prefix}_temp`, permissions: ['customers.view'] });
        const next = await createTestRole({ code: `${prefix}_next`, permissions: ['customers.view'] });
        const only = await createTestUser({ username: `${prefix}_u`, role: temp.code });

        const whileActive = await h.del(`/api/roles/${temp.id}`);
        if (whileActive.status !== 400) wrong.push(`deleting a role with an active user returned ${whileActive.status}, not 400`);
        const removed = await h.del(`/api/users/${only.id}`);
        if (removed.status !== 200) wrong.push(`deleting the user returned ${removed.status}, not 200`);
        const afterDelete = await h.del(`/api/roles/${temp.id}`);
        if (afterDelete.status !== 200) wrong.push(`deleting a role whose only user was deleted returned ${afterDelete.status} ${String(afterDelete.body?.error ?? '')}, not 200`);
        if ((await h.q('SELECT 1 FROM roles WHERE id = $1', [temp.id])).length > 0) wrong.push('the role is still there');

        const restore = await h.post(`/api/users/${only.id}/restore`, { role: next.code, password: 'Tempor4ry!' });
        if (restore.status !== 200) wrong.push(`restoring the user with another role returned ${restore.status}, not 200`);
        const [back] = await h.q('SELECT role, is_deleted FROM users WHERE id = $1', [only.id]);
        if (back?.role !== next.code || Number(back?.is_deleted) !== 0) wrong.push(`the restored user is ${String(back?.role)} / ${String(back?.is_deleted)}`);
      } finally {
        await orm.delete(users).where(like(users.username, `${prefix}%`));
        await orm.delete(roles).where(like(roles.code, `${prefix}%`));
      }
    });
  }

  return results;
}
