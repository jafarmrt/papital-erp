import { and, eq, inArray, ne } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (احراز هویت، دسترسی و سجل) — آزمون‌های امنیتی از مسیرهای واقعی Express با ورود واقعی (کوکی و CSRF).
 * هر آزمون روی کد پیشین قرمز است.
 */

export async function runAccessPackageTwoTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_last_admin_role_change_td_524', 'security', 'td524', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_last_admin_role_change_td_524',
      name: 'v9.0.75: the last active system admin cannot be moved out of the admin role by an edit, also under concurrent edits (TD-524)',
      details: 'with every other admin set aside, an admin demoting themself gets 409 with a Persian message and stays admin; demoting another admin works while one remains; two admins demoting themselves at the same time leave exactly one admin',
    }, async (h, wrong) => {
      const a = await h.sessionWith('admin');
      // مدیران دیگر (seed و باقی‌مانده آزمون‌ها) کنار گذاشته و در پایان دقیقاً برگردانده می‌شوند
      const others = await orm.select({ id: users.id }).from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isDeleted, 0), ne(users.id, a.userId)));
      const otherIds = others.map(r => r.id);
      const plainRole = (await h.sessionWith(['daily_logs.view'])).role;
      const roleOf = async (userId: number) => (await orm.select({ role: users.role }).from(users).where(eq(users.id, userId)))[0]?.role;
      if (otherIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, otherIds));
      try {
        // ۱) تنها مدیر نقش خود را عوض نمی‌کند
        const alone = await h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (alone.status !== 409) wrong.push(`the only admin demoting themself got ${alone.status}, not 409`);
        else if (!/[؀-ۿ]/.test(String(alone.body?.error ?? alone.body?.message ?? ''))) wrong.push('the 409 message is not Persian');
        if (await roleOf(a.userId) !== 'admin') wrong.push('the only admin lost the admin role');

        // ۲) مدیر دیگری را تا وقتی خودش مدیر است کنار می‌گذارد
        const b = await h.sessionWith('admin');
        const demoteB = await h.put(`/api/users/${b.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (demoteB.status !== 200) wrong.push(`demoting a second admin got ${demoteB.status}, not 200`);
        const againAlone = await h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a);
        if (againAlone.status !== 409) wrong.push(`after the second admin was demoted, demoting the last one got ${againAlone.status}, not 409`);

        // ۳) دو مدیر هم‌زمان خود را کنار می‌گذارند: دقیقاً یکی می‌ماند
        const c = await h.sessionWith('admin');
        const [ra, rc] = await Promise.all([
          h.put(`/api/users/${a.userId}`, { full_name: 'td524', role: plainRole }, a),
          h.put(`/api/users/${c.userId}`, { full_name: 'td524', role: plainRole }, c),
        ]);
        const statuses = [ra.status, rc.status].sort().join(',');
        if (statuses !== '200,409') wrong.push(`concurrent self-demotions returned ${statuses}, not one 200 and one 409`);
        const remaining = [await roleOf(a.userId), await roleOf(c.userId)].filter(r => r === 'admin').length;
        if (remaining !== 1) wrong.push(`${remaining} admins remained after concurrent self-demotions, not 1`);
      } finally {
        if (otherIds.length > 0) await orm.update(users).set({ isDeleted: 0 }).where(inArray(users.id, otherIds));
      }
    });
  }

  if (shouldRun('sec_synthetic_username_refused_td_521', 'security', 'td521', 'users', 'package2')) {
    await runCase(results, {
      id: 'sec_synthetic_username_refused_td_521',
      name: 'v9.0.76: a username starting with test_, e2e_ or testuser_ is refused with 422, an existing one is listed and reported by the health check (TD-521)',
      details: 'POST /api/users refuses test_x, E2E_shop and TestUser_x with a Persian 422 and creates nothing; tester-like names still work; a legacy test_ user appears in GET /api/users and list-simple and in the synthetic_test_users health check',
    }, async (h, wrong) => {
      const { findActiveSyntheticUsers, buildSyntheticUsersHealthTest } = await import('../../services/users/syntheticUserHealth.js');
      const { createTestRole } = await import('../fixtures/factories.js');
      const role = await createTestRole({ permissions: ['daily_logs.view'] });
      const created: string[] = [];
      const legacy = `test_legacy_${h.tag}`;
      try {
        for (const username of [`test_x${h.tag}`, `E2E_shop${h.tag}`, `TestUser_x${h.tag}`]) {
          const res = await h.post('/api/users', { username, password: 'Passw0rd!x', full_name: 'td521', role: role.code });
          if (res.status === 200) created.push(username);
          if (res.status !== 422) wrong.push(`creating ${username} returned ${res.status}, not 422`);
          else if (!/[؀-ۿ]/.test(String(res.body?.error ?? res.body?.message ?? ''))) wrong.push(`the refusal of ${username} is not Persian`);
          if ((await orm.select({ id: users.id }).from(users).where(eq(users.username, username))).length > 0) wrong.push(`${username} was stored although refused`);
        }
        const tester = `tester${h.tag}`;
        const okRes = await h.post('/api/users', { username: tester, password: 'Passw0rd!x', full_name: 'td521', role: role.code });
        if (okRes.status === 200) created.push(tester);
        else wrong.push(`creating ${tester} returned ${okRes.status}, not 200`);

        await orm.insert(users).values({ username: legacy, password: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva', fullName: 'td521 legacy', role: role.code });
        created.push(legacy);
        for (const url of ['/api/users', '/api/users/list-simple']) {
          const res = await h.get(url);
          const names = (Array.isArray(res.body) ? res.body : []).map((u: { username: string }) => u.username);
          if (!names.includes(legacy)) wrong.push(`${url} hides the active user ${legacy}`);
        }
        const health = buildSyntheticUsersHealthTest(await findActiveSyntheticUsers());
        if (health.status !== 'warning' || !health.items?.some(i => i.code === legacy)) wrong.push(`the synthetic_test_users health check does not report ${legacy}`);
      } finally {
        if (created.length > 0) await orm.delete(users).where(inArray(users.username, created));
        await orm.delete(roles).where(eq(roles.id, role.id));
      }
    });
  }

  if (shouldRun('sec_session_endpoints_same_origin_td_528', 'security', 'td528', 'csrf', 'login', 'logout', 'package2')) {
    await runCase(results, {
      id: 'sec_session_endpoints_same_origin_td_528',
      name: 'v9.0.77: a forged cross-site form cannot log a user out of every device or log them into another account (TD-528)',
      details: 'logout and login from Origin https://evil.example and from Origin null get 403 and the two sessions stay valid; logout with a valid session but no CSRF header gets 403; a same-host Origin and a non-browser client without Origin still log in; a logout with the session CSRF header ends both sessions',
    }, async (h, wrong) => {
      const request = (await import('supertest')).default;
      const { loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
      const { TEST_PASSWORD } = await import('../fixtures/factories.js');
      const app = h.app as Parameters<typeof request>[0];
      const victim = await h.sessionWith(['daily_logs.view']);
      const [row] = await orm.select({ username: users.username }).from(users).where(eq(users.id, victim.userId));
      const phone = await loginTestUserWithSession(app, row.username);
      const alive = async (cookie: string) => (await request(app).get('/api/auth/me').set('Cookie', cookie)).body?.authenticated === true;
      const form = (url: string) => request(app).post(url).type('form');

      for (const url of ['/api/logout', '/api/auth/logout']) {
        for (const origin of ['https://evil.example', 'null']) {
          const res = await form(url).set('Cookie', victim.cookie).set('Origin', origin).send({});
          if (res.status !== 403) wrong.push(`forged ${url} from Origin ${origin} returned ${res.status}, not 403`);
        }
        const refererOnly = await form(url).set('Cookie', victim.cookie).set('Referer', 'https://evil.example/page').send({});
        if (refererOnly.status !== 403) wrong.push(`forged ${url} with only a cross-site Referer returned ${refererOnly.status}, not 403`);
        const noCsrf = await request(app).post(url).set('Cookie', victim.cookie).send({});
        if (noCsrf.status !== 403) wrong.push(`${url} with a valid session and no CSRF header returned ${noCsrf.status}, not 403`);
      }
      if (!(await alive(victim.cookie)) || !(await alive(phone.cookie))) wrong.push('a refused logout still ended a session');

      const creds = { username: row.username, password: TEST_PASSWORD };
      const forgedLogin = await form('/api/login').set('Origin', 'https://evil.example').send(creds);
      if (forgedLogin.status !== 403) wrong.push(`forged login from another site returned ${forgedLogin.status}, not 403`);
      if (forgedLogin.headers['set-cookie']) wrong.push('the forged login set a session cookie');
      const sameHost = await request(app).post('/api/login').set('Host', 'erp.example.ir').set('Origin', 'https://erp.example.ir').send(creds);
      if (sameHost.status !== 200) wrong.push(`login from the same host returned ${sameHost.status}, not 200`);
      const forgedSetup = await form('/api/setup').set('Origin', 'https://evil.example').send({});
      if (forgedSetup.status !== 403) wrong.push(`forged setup from another site returned ${forgedSetup.status}, not 403`);

      const legit = await request(app).post('/api/auth/logout').set('Cookie', victim.cookie).set('x-csrf-token', victim.csrfToken).send({});
      if (legit.status !== 200) wrong.push(`logout with the session CSRF header returned ${legit.status}, not 200`);
      if (await alive(phone.cookie)) wrong.push('a real logout did not end the other session');
    });
  }

  if (shouldRun('sec_role_permission_dependencies_td_880', 'security', 'td880', 'roles', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_role_permission_dependencies_td_880',
      name: 'v9.0.86: a saved role always holds what its permissions require, e.g. edit invoices brings view invoices (TD-880)',
      details: 'POST and PUT /api/roles add the catalog requirements in catalog order and audit them; an edit without a permission list leaves the stored list as it was; a legacy key outside the catalog is kept; GET /api/permissions returns requires',
    }, async (h, wrong) => {
      const ids: number[] = [];
      const stored = async (id: number) => (await orm.select({ p: roles.permissions }).from(roles).where(eq(roles.id, id)))[0]?.p as string[] | undefined;
      const same = (a: string[] | undefined, b: string[]) => JSON.stringify(a) === JSON.stringify(b);
      try {
        const created = await h.post('/api/roles', { name: `نقش آزمون ${h.tag}`, code: `td880_${h.tag}`, permissions: ['documents.edit', 'accounting.treasury_no_voucher'] });
        if (created.status !== 200) throw new Error(`creating the role returned ${created.status}`);
        const id = Number(created.body?.id);
        ids.push(id);
        const expected = ['documents.edit', 'accounting.treasury_no_voucher', 'documents.view', 'accounting.view', 'accounting.treasury'];
        if (!same(await stored(id), expected)) wrong.push(`create stored ${JSON.stringify(await stored(id))}, not ${JSON.stringify(expected)}`);

        const edited = await h.put(`/api/roles/${id}`, { name: `نقش آزمون ${h.tag}`, permissions: ['customers.manage'] });
        if (edited.status !== 200) wrong.push(`editing the role returned ${edited.status}`);
        if (!same(await stored(id), ['customers.manage', 'customers.view'])) wrong.push(`edit stored ${JSON.stringify(await stored(id))}, not customers.manage with customers.view`);

        await orm.update(roles).set({ permissions: ['crm.manage', 'legacy.key'] }).where(eq(roles.id, id));
        await h.put(`/api/roles/${id}`, { name: `نام تازه ${h.tag}` });
        if (!same(await stored(id), ['crm.manage', 'legacy.key'])) wrong.push(`an edit without permissions changed the list to ${JSON.stringify(await stored(id))}`);
        await h.put(`/api/roles/${id}`, { name: `نام تازه ${h.tag}`, permissions: ['crm.manage', 'legacy.key'] });
        if (!same(await stored(id), ['crm.manage', 'legacy.key', 'crm.view'])) wrong.push(`an edit with a legacy key stored ${JSON.stringify(await stored(id))}`);
        const [log] = await h.q(`SELECT details FROM activity_logs WHERE entity = 'نقش و دسترسی' AND entity_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [String(id)]);
        if (!same((log?.details as { addedByRequirement?: string[] } | undefined)?.addedByRequirement, ['crm.view'])) wrong.push('the audit row does not list the permission added by requirement');

        const catalog = await h.get('/api/permissions');
        const editKey = (Array.isArray(catalog.body) ? catalog.body : []).flatMap((g: { permissions: Array<{ key: string; requires?: string[] }> }) => g.permissions).find((p: { key: string }) => p.key === 'documents.edit');
        if (!same(editKey?.requires, ['documents.view'])) wrong.push('GET /api/permissions does not say documents.edit requires documents.view');
      } finally {
        if (ids.length > 0) await orm.delete(roles).where(inArray(roles.id, ids));
      }
    });
  }

  if (shouldRun('sec_permission_only_checks_td_881', 'security', 'td881', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_permission_only_checks_td_881',
      name: 'v9.0.87: can() and requirePermission ask catalog permissions only, never a role code (TD-881)',
      details: 'requirePermission refuses a mistyped key, a role code or no key when the router is built, and authorizePermission is the same guard; can() passes the system admin and a role holding the key, refuses a role without it and a missing user, and throws on a role code',
    }, async (h, wrong) => {
      const guards = await import('../../middleware/authorize.js') as Record<string, unknown>;
      const requirePermission = guards.requirePermission as ((...keys: string[]) => unknown) | undefined;
      const can = guards.can as ((user: { role?: string } | undefined, ...keys: string[]) => Promise<boolean>) | undefined;
      if (typeof requirePermission !== 'function' || typeof can !== 'function') throw new Error('can() or requirePermission() is missing');
      if (guards.authorizePermission !== requirePermission) wrong.push('authorizePermission is not the strict guard');
      for (const bad of [['customers.mange'], ['manager'], ['customers.view', 'sales_manager'], []]) {
        let threw = false;
        try { requirePermission(...bad); } catch { threw = true; }
        if (!threw) wrong.push(`requirePermission(${bad.join(', ')}) built a guard`);
      }
      try { requirePermission('customers.view', 'crm.view'); } catch { wrong.push('requirePermission refused catalog keys'); }

      const s = await h.sessionWith(['customers.view']);
      if (!(await can({ role: s.role }, 'customers.view'))) wrong.push('can() refused a role holding the key');
      if (!(await can({ role: s.role }, 'crm.view', 'customers.view'))) wrong.push('can() refused a role holding one of the keys');
      if (await can({ role: s.role }, 'customers.manage')) wrong.push('can() passed a role without the key');
      if (!(await can({ role: 'admin' }, 'settings.manage'))) wrong.push('can() refused the system admin');
      if (await can(undefined, 'customers.view')) wrong.push('can() passed a missing user');
      let threw = false;
      try { await can({ role: s.role }, s.role); } catch { threw = true; }
      if (!threw) wrong.push('can() accepted a role code');
    });
  }

  if (shouldRun('sec_route_guards_permission_only_td_516', 'security', 'td516', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_route_guards_permission_only_td_516',
      name: 'v9.0.97: no route guard lets a role code through; taking a tick off a seed role takes the access away (TD-516)',
      details: 'the route table names no role code except the system-admin-only maintenance routes; seed roles without the ticks get 403 where their code used to pass (customer delete, settings save); the new keys open warehouses, fiscal closing and pending-material delete; the legacy «*» opens nothing; a role with every catalog key gets 403 on a maintenance route',
    }, async (h, wrong) => {
      const { buildRouteGuardTable } = await import('../../lib/routeGuardTable.js');
      const { routeAccessPolicyViolations } = await import('./routeAccessPolicy.js');
      const { PERMISSION_KEYS } = await import('../../lib/permissions/permissionCatalog.js');
      const { invalidateRoleCache } = await import('../../lib/memoryCache.js');
      const { createTestRole } = await import('../fixtures/factories.js');
      const roleCodeViolations = routeAccessPolicyViolations(buildRouteGuardTable(h.app as Parameters<typeof buildRouteGuardTable>[0]), new Set(PERMISSION_KEYS))
        .filter(v => /role code|SYSTEM_ADMIN_ONLY_ROUTES/.test(v));
      if (roleCodeViolations.length > 0) wrong.push(`${roleCodeViolations.length} route guard(s) still name a role code: ${roleCodeViolations.slice(0, 5).join(' | ')}`);

      // ۱) نقش‌های پیش‌فرض بی تیک: کدشان دیگر از گارد نمی‌گذرد
      const seedCodes = ['sales_manager', 'manager'];
      const saved = await orm.select({ code: roles.code, permissions: roles.permissions }).from(roles).where(inArray(roles.code, seedCodes));
      if (saved.length !== seedCodes.length) throw new Error('the seed roles sales_manager and manager are missing from the test database');
      try {
        await orm.update(roles).set({ permissions: [] }).where(inArray(roles.code, seedCodes));
        seedCodes.forEach(c => invalidateRoleCache(c));
        const sales = await h.sessionWith('sales_manager');
        const manager = await h.sessionWith('manager');
        const del = await h.del('/api/customers/999999999', sales);
        if (del.status !== 403) wrong.push(`sales_manager without customers.* deleting a customer got ${del.status}, not 403`);
        const save = await h.post('/api/settings', {}, manager);
        if (save.status !== 403) wrong.push(`manager without settings.manage saving settings got ${save.status}, not 403`);
      } finally {
        for (const r of saved) await orm.update(roles).set({ permissions: r.permissions }).where(eq(roles.code, r.code));
        seedCodes.forEach(c => invalidateRoleCache(c));
      }

      // ۲) مجوزهای تازه کارهای پیشین «فقط مدیر سیستم» و گاردهای بی‌کلید را باز می‌کنند
      const passes: Array<[string[], 'get' | 'put' | 'post' | 'del', string]> = [
        [['warehouse.view', 'warehouse.manage'], 'put', '/api/warehouses/999999999'],
        [['accounting.view', 'accounting.fiscal_close'], 'post', '/api/accounting/fiscal-closing/execute'],
        [['pending_materials.view', 'pending_materials.delete'], 'del', '/api/pending-materials/999999999'],
        [['audit_logs.view'], 'get', '/api/activity-logs'],
      ];
      for (const [perms, method, url] of passes) {
        const s = await h.sessionWith(perms);
        const res = method === 'get' ? await h.get(url, s) : method === 'del' ? await h.del(url, s) : await h[method](url, {}, s);
        if (res.status === 403 || res.status === 401) wrong.push(`${perms.join(' + ')} got ${res.status} on ${method.toUpperCase()} ${url}`);
      }

      // ۳) «*» قدیمی چیزی نمی‌دهد و همه کلیدهای فهرست هم کار نگهداری را باز نمی‌کنند
      const star = await createTestRole({ permissions: ['*'] });
      try {
        const s = await h.sessionWith(star.code);
        const list = await h.get('/api/customers', s);
        if (list.status !== 403) wrong.push(`a role holding only «*» listed customers with ${list.status}, not 403`);
      } finally {
        await orm.delete(roles).where(eq(roles.id, star.id));
      }
      const everything = await h.sessionWith([...PERMISSION_KEYS]);
      const health = await h.get('/api/system/health', everything);
      if (health.status !== 403) wrong.push(`a role with every catalog key got ${health.status} on the system health route, not 403`);
      else if (!/[؀-ۿ]/.test(String(health.body?.error ?? ''))) wrong.push('the system-admin-only refusal is not Persian');
      const adminHealth = await h.get('/api/system/health');
      if (adminHealth.status !== 200) wrong.push(`the system admin got ${adminHealth.status} on the system health route`);
    });
  }

  if (shouldRun('sec_role_code_access_migration_td_516', 'security', 'td516', 'permissions', 'package2', 'migration')) {
    await runCase(results, {
      id: 'sec_role_code_access_migration_td_516',
      name: 'v9.0.97: migration 0062 turns what a seed role passed only by its code into ticks, expands «*» and logs every change (TD-516)',
      details: 'manager missing settings.manage gets it and the new pending_materials.delete; warehouse_keeper missing documents.edit gets it; a seed role that already holds a guard key and a custom role with a seed code are untouched; a «*» role gets every catalog key and loses «*»; one activity_logs row per changed role with before, after, added keys and routes',
    }, async (h, wrong) => {
      const { runMigrationRolledBack } = await import('./workflowLifecycleTests.js');
      const { PERMISSION_KEYS } = await import('../../lib/permissions/permissionCatalog.js');
      const managerBefore = PERMISSION_KEYS.filter(k => k !== 'settings.manage' && k !== 'pending_materials.delete');
      const keeperBefore = ['products.view', 'products.create', 'products.edit', 'warehouse.view', 'warehouse.in', 'warehouse.out', 'customers.view'];
      const starCode = `td516_star_${h.tag}`;
      const outcome = await runMigrationRolledBack('0062_role_code_guards_to_permissions.sql', async (q) => {
        await q(`UPDATE roles SET permissions = $1::jsonb, is_system = 1 WHERE code = 'manager'`, [JSON.stringify(managerBefore)]);
        await q(`UPDATE roles SET permissions = $1::jsonb, is_system = 1 WHERE code = 'warehouse_keeper'`, [JSON.stringify(keeperBefore)]);
        await q(`UPDATE roles SET permissions = '["customers.view","customers.manage","documents.view","documents.create","documents.edit"]'::jsonb, is_system = 1 WHERE code = 'sales_manager'`);
        await q(`UPDATE roles SET permissions = '[]'::jsonb, is_system = 0 WHERE code = 'accountant'`);
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ('td516 star', $1, '["legacy.key","*"]'::jsonb, 0)`, [starCode]);
      }, async (q) => ({
        roles: await q(`SELECT code, permissions FROM roles WHERE code IN ('manager', 'warehouse_keeper', 'sales_manager', 'accountant', $1)`, [starCode]),
        logs: await q(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0062_role_code_guards_to_permissions' ORDER BY id`),
        ids: await q(`SELECT id, code FROM roles WHERE code IN ('manager', 'warehouse_keeper', 'sales_manager', 'accountant', $1)`, [starCode]),
      }));
      const permsOf = (code: string) => (outcome.roles.find(r => r.code === code)?.permissions ?? null) as string[] | null;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(permsOf('manager'), [...managerBefore, 'pending_materials.delete', 'settings.manage'])) wrong.push(`manager after 0062: ${JSON.stringify(permsOf('manager'))}`);
      if (!same(permsOf('warehouse_keeper'), [...keeperBefore, 'documents.edit'])) wrong.push(`warehouse_keeper after 0062: ${JSON.stringify(permsOf('warehouse_keeper'))}`);
      if (!same(permsOf('sales_manager'), ['customers.view', 'customers.manage', 'documents.view', 'documents.create', 'documents.edit'])) wrong.push('sales_manager, which holds every guard key, was changed');
      if (!same(permsOf('accountant'), [])) wrong.push('a custom role coded accountant was changed');
      if (!same(permsOf(starCode), ['legacy.key', ...PERMISSION_KEYS])) wrong.push(`the «*» role after 0062: ${JSON.stringify(permsOf(starCode))}`);

      const idOf = (code: string) => String(outcome.ids.find(r => r.code === code)?.id);
      const logged = outcome.logs.map(l => l.entity_id as string).sort();
      const expected = [idOf('manager'), idOf('warehouse_keeper'), idOf(starCode)].sort();
      if (!same(logged, expected)) wrong.push(`activity_logs rows for roles ${logged.join(', ')}, expected ${expected.join(', ')}`);
      const managerLog = outcome.logs.find(l => l.entity_id === idOf('manager'))?.details as Record<string, unknown> | undefined;
      if (!same(managerLog?.addedPermissions, ['pending_materials.delete', 'settings.manage'])) wrong.push(`manager log addedPermissions: ${JSON.stringify(managerLog?.addedPermissions)}`);
      if (!same(managerLog?.routes, ['DELETE /api/pending-materials/:id', 'POST /api/settings'])) wrong.push(`manager log routes: ${JSON.stringify(managerLog?.routes)}`);
      if (!same(managerLog?.beforePermissions, managerBefore)) wrong.push('manager log beforePermissions differ from the stored ones');
    });
  }

  return results;
}
