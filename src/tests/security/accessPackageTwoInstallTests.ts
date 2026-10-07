import path from 'path';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';
import { createScratchCluster, querySql, REPO_ROOT, runCommand, type ScratchCluster } from '../recovery/scratchDatabase.js';

/**
 * بسته ۲ (مدل مجوز)، M5 — داده پایه و نصب تازه. هر آزمون یک پایگاه‌داده خالی جدا می‌سازد (نقش مالک بی CREATEDB، مثل
 * install.sh) و کارهای داده‌ای بوت سرور (`prepareDatabaseAtBoot`) را در فرایند جدا روی آن اجرا می‌کند، چون استخر
 * برنامه به پایگاه‌داده آزمون بسته است.
 */

async function bootDatabase(cluster: ScratchCluster, env: Record<string, string>): Promise<void> {
  const run = await runCommand(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['src/tests/recovery/bootDatabaseCli.ts'], {
    env: { ...process.env, ALLOW_SEED_IN_PRODUCTION: '', ...env, DATABASE_URL: cluster.appUrl, ERP_TEST_SCHEMA_ISOLATION: '0' },
  });
  if (run.code !== 0) throw new Error(`boot data steps failed (${run.code}): ${run.output.slice(-1500)}`);
}

async function withScratchCluster(label: string, fn: (cluster: ScratchCluster) => Promise<void>): Promise<void> {
  const cluster = await createScratchCluster(label);
  try {
    await fn(cluster);
  } finally {
    await cluster.teardown();
  }
}

export async function runAccessPackageTwoInstallTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_seed_keeps_admin_edits_td_591', 'security', 'td591', 'seed', 'install', 'package2')) {
    await runCase(results, {
      id: 'sec_seed_keeps_admin_edits_td_591',
      name: 'v9.0.116: the boot seed inserts only what is missing and never undoes an admin edit (TD-591)',
      details: 'on an empty database booted twice in development mode: between the boots the admin keeps a role coded manager without products.delete, changes a category prefix and unit, deletes a category, changes a standard account nature, changes one default setting and deletes another; after the second boot every edit is still there and no role was added',
    }, async (_h, wrong) => {
      await withScratchCluster('seed591', async cluster => {
        const q = (sql: string, params: unknown[] = []) => querySql(cluster.appUrl, sql, params);
        await bootDatabase(cluster, { NODE_ENV: 'development' });

        const [account] = await q(`SELECT code FROM accounts WHERE is_deleted = 0 AND is_system = 1 AND nature = 'debit' ORDER BY code LIMIT 1`);
        const [categoryCount] = await q('SELECT COUNT(*)::int AS n FROM categories');
        if (!account || Number(categoryCount.n) === 0) {
          wrong.push(`the first boot left no debit standard account (${account?.code}) or no category (${categoryCount.n})`);
          return;
        }

        // a role with a former seed code whose admin took products.delete away (the seed until v9.0.132 put it back)
        const role = { code: 'manager' };
        const kept = ['products.view', 'customers.view'];
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ('مدیر عمومی', 'manager', $1::jsonb, 0)
                 ON CONFLICT (code) DO UPDATE SET permissions = EXCLUDED.permissions`, [JSON.stringify(kept)]);
        const [rolesBefore] = await q('SELECT COUNT(*)::int AS n FROM roles');
        await q(`UPDATE categories SET prefix = 'SX', default_unit = 'عدد' WHERE name = 'گوشواره میخی'`);
        await q(`DELETE FROM categories WHERE name = 'سایر اقلام'`);
        await q(`UPDATE accounts SET nature = 'both' WHERE code = $1 AND is_deleted = 0`, [account.code]);
        await q(`UPDATE app_settings SET value = '77' WHERE key = 'fast_moving_days'`);
        await q(`DELETE FROM app_settings WHERE key = 'dead_stock_days'`);

        await bootDatabase(cluster, { NODE_ENV: 'development' });

        const [roleAfter] = await q(`SELECT permissions FROM roles WHERE code = $1`, [role.code]);
        if (JSON.stringify(roleAfter?.permissions) !== JSON.stringify(kept)) wrong.push(`role ${role.code} permissions became ${JSON.stringify(roleAfter?.permissions)}`);
        const [rolesAfter] = await q('SELECT COUNT(*)::int AS n FROM roles');
        if (Number(rolesAfter.n) !== Number(rolesBefore.n)) wrong.push(`the second boot changed the role count from ${rolesBefore.n} to ${rolesAfter.n}`);
        const [cat] = await q(`SELECT prefix, default_unit FROM categories WHERE name = 'گوشواره میخی'`);
        if (cat?.prefix !== 'SX' || cat?.default_unit !== 'عدد') wrong.push(`category prefix and unit were rewritten to ${cat?.prefix} / ${cat?.default_unit}`);
        const [deleted] = await q(`SELECT COUNT(*)::int AS n FROM categories WHERE name = 'سایر اقلام'`);
        if (Number(deleted.n) !== 0) wrong.push('a deleted default category came back');
        const [acc] = await q(`SELECT nature FROM accounts WHERE code = $1 AND is_deleted = 0`, [account.code]);
        if (acc?.nature !== 'both') wrong.push(`account ${account.code} nature was rewritten to ${acc?.nature}`);
        const settings = await q(`SELECT key, value FROM app_settings WHERE key IN ('fast_moving_days', 'dead_stock_days')`);
        const byKey = new Map(settings.map(s => [String(s.key), String(s.value)]));
        if (byKey.get('fast_moving_days') !== '77') wrong.push(`fast_moving_days became ${byKey.get('fast_moving_days')}`);
        if (byKey.has('dead_stock_days')) wrong.push(`a deleted default setting came back (dead_stock_days = ${byKey.get('dead_stock_days')})`);
      });
    });
  }

  if (shouldRun('sec_fresh_install_admin_only_td_526', 'security', 'td526', 'seed', 'install', 'package2')) {
    await runCase(results, {
      id: 'sec_fresh_install_admin_only_td_526',
      name: 'v9.0.117: a fresh production install has only the system admin role and gets its base data at boot (TD-526)',
      details: 'an empty database booted in production mode without any seed flag: roles hold exactly the system admin row (one audit row records it); the 22 standard categories, the whole standard chart of accounts and the default settings are there before any request; a second boot changes no count',
    }, async (_h, wrong) => {
      const { DEFAULT_CATEGORIES } = await import('../../data/defaultCategories.js');
      const { STANDARD_CHART_OF_ACCOUNTS } = await import('../../data/standardChartOfAccounts.js');
      const { SYSTEM_ADMIN_ROLE } = await import('../../lib/permissions/permissionCatalog.js');
      await withScratchCluster('fresh526', async cluster => {
        const q = (sql: string, params: unknown[] = []) => querySql(cluster.appUrl, sql, params);
        const counts = async () => {
          const [row] = await q(`SELECT
            (SELECT COUNT(*)::int FROM roles) AS roles,
            (SELECT COUNT(*)::int FROM categories) AS categories,
            (SELECT COUNT(*)::int FROM accounts WHERE is_deleted = 0) AS accounts,
            (SELECT COUNT(*)::int FROM app_settings WHERE key IN ('invoice_start_number', 'company_name', 'currency', 'display_timezone', 'pricing_strategies', 'project_workflow_presets')) AS settings`);
          return row as { roles: number; categories: number; accounts: number; settings: number };
        };
        await bootDatabase(cluster, { NODE_ENV: 'production' });

        const roleRows = await q('SELECT code, is_system FROM roles ORDER BY id');
        if (roleRows.length !== 1 || roleRows[0].code !== SYSTEM_ADMIN_ROLE || Number(roleRows[0].is_system) !== 1) {
          wrong.push(`roles after a fresh boot: ${JSON.stringify(roleRows)} (expected only the system admin)`);
        }
        const [audit] = await q(`SELECT COUNT(*)::int AS n FROM activity_logs WHERE details->>'migration' = '0066_system_admin_role'`);
        if (Number(audit.n) !== 1) wrong.push(`${audit.n} audit rows record the system admin role (expected 1)`);
        const categories = await q('SELECT name, prefix, default_unit FROM categories ORDER BY id');
        const expected = DEFAULT_CATEGORIES.map(c => `${c.name}|${c.prefix}|${c.defaultUnit}`).sort();
        const got = categories.map(c => `${c.name}|${c.prefix}|${c.default_unit}`).sort();
        if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`categories after a fresh boot: ${got.length} rows, not the ${expected.length} standard ones`);
        const first = await counts();
        if (first.accounts !== STANDARD_CHART_OF_ACCOUNTS.length) wrong.push(`${first.accounts} active accounts, not the ${STANDARD_CHART_OF_ACCOUNTS.length} of the standard chart`);
        if (first.settings !== 6) wrong.push(`${first.settings} of 6 default settings`);

        await bootDatabase(cluster, { NODE_ENV: 'production' });
        const second = await counts();
        if (JSON.stringify(second) !== JSON.stringify(first)) wrong.push(`a second boot changed the counts: ${JSON.stringify(first)} -> ${JSON.stringify(second)}`);
      });
    });
  }

  if (shouldRun('sec_category_list_read_only_td_526', 'security', 'td526', 'categories', 'install', 'package2')) {
    await runCase(results, {
      id: 'sec_category_list_read_only_td_526',
      name: 'v9.0.117: reading the category list writes nothing, even when there is no category (TD-526, A02-19)',
      details: 'with the categories table emptied for the test, GET /api/categories returns 200 and an empty list and the table stays empty; the rows are put back afterwards',
    }, async (h, wrong) => {
      await h.q('CREATE TABLE categories_backup_td526 AS SELECT * FROM categories');
      try {
        await h.q('DELETE FROM categories');
        const res = await h.get('/api/categories');
        if (res.status !== 200) wrong.push(`GET /api/categories returned ${res.status}, not 200`);
        const listed = Array.isArray(res.body) ? res.body.length : -1;
        if (listed !== 0) wrong.push(`GET /api/categories listed ${listed} categories on an empty table`);
        const [after] = await h.q('SELECT COUNT(*)::int AS n FROM categories');
        if (Number(after.n) !== 0) wrong.push(`reading the list inserted ${after.n} categories`);
      } finally {
        await h.q('DELETE FROM categories');
        await h.q('INSERT INTO categories SELECT * FROM categories_backup_td526');
        await h.q('DROP TABLE categories_backup_td526');
      }
    });
  }

  if (shouldRun('sec_category_reset_standard_list_td_526', 'security', 'td526', 'categories', 'install', 'package2')) {
    await runCase(results, {
      id: 'sec_category_reset_standard_list_td_526',
      name: 'v9.0.117: the reset-defaults button writes the same 22 standard categories a fresh install gets (TD-526)',
      details: 'after POST /api/categories/reset-defaults by the system admin, every name of DEFAULT_CATEGORIES exists with its prefix, type and unit; the rows are put back afterwards',
    }, async (h, wrong) => {
      const { DEFAULT_CATEGORIES } = await import('../../data/defaultCategories.js');
      await h.q('CREATE TABLE categories_backup_td526r AS SELECT * FROM categories');
      try {
        const res = await h.post('/api/categories/reset-defaults', {});
        if (res.status !== 200) wrong.push(`reset-defaults returned ${res.status}, not 200`);
        const rows = await h.q('SELECT name, prefix, type, default_unit FROM categories');
        const byName = new Map(rows.map(r => [String(r.name), r]));
        for (const c of DEFAULT_CATEGORIES) {
          const row = byName.get(c.name);
          if (!row) { wrong.push(`category ${c.name} is missing after the reset`); continue; }
          if (row.prefix !== c.prefix || row.type !== c.type || row.default_unit !== c.defaultUnit) {
            wrong.push(`category ${c.name} became ${row.prefix} / ${row.type} / ${row.default_unit}, not ${c.prefix} / ${c.type} / ${c.defaultUnit}`);
          }
        }
      } finally {
        await h.q('DELETE FROM categories');
        await h.q('INSERT INTO categories SELECT * FROM categories_backup_td526r');
        await h.q('DROP TABLE categories_backup_td526r');
      }
    });
  }

  if (shouldRun('sec_former_seed_roles_ordinary_td_885', 'security', 'td885', 'roles', 'migration', 'package2')) {
    await runCase(results, {
      id: 'sec_former_seed_roles_ordinary_td_885',
      name: 'v9.0.118: only the system admin role is a system role; a former seed role is deleted like any other (TD-885)',
      details: 'migration 0067 on an install with a seed role flagged system, a role with no flag and an admin row not flagged: the first two become 0, the admin 1, one activity_logs row each and no other row; DELETE /api/roles/:id of a role flagged system without users returns 200 and removes it; DELETE of the system admin role returns 400 with a Persian message',
    }, async (h, wrong) => {
      const { runMigrationRolledBack } = await import('./workflowLifecycleTests.js');
      const seedCode = `td885_seed_${h.tag}`;
      const nullCode = `td885_null_${h.tag}`;
      const outcome = await runMigrationRolledBack('0067_only_admin_role_is_system.sql', async (q) => {
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ('نقش پیش‌فرض قدیمی', $1, '["customers.view"]'::jsonb, 1)`, [seedCode]);
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ('نقش بی پرچم', $1, '[]'::jsonb, NULL)`, [nullCode]);
        await q(`UPDATE roles SET is_system = 0 WHERE code = 'admin'`);
      }, async (q) => ({
        flags: await q('SELECT id, code, is_system FROM roles ORDER BY id'),
        logs: await q(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0067_only_admin_role_is_system' ORDER BY id`),
      }));
      const flagOf = (code: string) => outcome.flags.find(r => r.code === code)?.is_system;
      if (Number(flagOf(seedCode)) !== 0) wrong.push(`the former seed role kept is_system ${flagOf(seedCode)}`);
      if (Number(flagOf(nullCode)) !== 0) wrong.push(`the role without a flag has is_system ${flagOf(nullCode)}`);
      if (Number(flagOf('admin')) !== 1) wrong.push(`the system admin role has is_system ${flagOf('admin')}`);
      const others = outcome.flags.filter(r => r.code !== 'admin' && Number(r.is_system) !== 0);
      if (others.length > 0) wrong.push(`roles still flagged system: ${others.map(r => r.code).join(', ')}`);
      const idOf = (code: string) => String(outcome.flags.find(r => r.code === code)?.id);
      const logged = outcome.logs.map(l => String(l.entity_id)).sort();
      const expected = [idOf(seedCode), idOf(nullCode), idOf('admin')].sort();
      if (JSON.stringify(logged) !== JSON.stringify(expected)) wrong.push(`activity_logs rows for roles ${logged.join(', ')}, expected ${expected.join(', ')}`);

      const [former] = await h.q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ('نقش پیش‌فرض قدیمی', $1, '["customers.view"]'::jsonb, 1) RETURNING id`, [seedCode]);
      const removed = await h.del(`/api/roles/${former.id}`);
      if (removed.status !== 200) wrong.push(`deleting a former seed role without users returned ${removed.status}, not 200`);
      const [left] = await h.q('SELECT COUNT(*)::int AS n FROM roles WHERE id = $1', [former.id]);
      if (Number(left.n) !== 0) {
        wrong.push('the former seed role is still there');
        await h.q('DELETE FROM roles WHERE id = $1', [former.id]);
      }
      const [admin] = await h.q(`SELECT id FROM roles WHERE code = 'admin'`);
      const refused = await h.del(`/api/roles/${admin.id}`);
      if (refused.status !== 400) wrong.push(`deleting the system admin role returned ${refused.status}, not 400`);
      else if (!/[؀-ۿ]/.test(String(refused.body?.error ?? ''))) wrong.push('the refusal to delete the system admin role is not Persian');
    });
  }

  if (shouldRun('sec_system_admin_role_fixed_td_886', 'security', 'td886', 'roles', 'package2')) {
    await runCase(results, {
      id: 'sec_system_admin_role_fixed_td_886',
      name: 'v9.0.119: the system admin role lists every catalog key and its permissions cannot be edited (TD-886)',
      details: 'GET /api/roles returns the system admin row with exactly the catalog keys whatever is stored; PUT /api/roles/:id of that role with permissions returns 409 and stores nothing; a holder of roles.manage gets 403 even for its name; the system admin changes its description (200)',
    }, async (h, wrong) => {
      const { PERMISSION_KEYS } = await import('../../lib/permissions/permissionCatalog.js');
      const [stored] = await h.q(`SELECT id, name, description, permissions FROM roles WHERE code = 'admin'`);
      const listed = await h.get('/api/roles');
      const adminRow = Array.isArray(listed.body) ? listed.body.find((r: { code?: string }) => r.code === 'admin') : undefined;
      const listedKeys = Array.isArray(adminRow?.permissions) ? [...adminRow.permissions].sort() : null;
      if (JSON.stringify(listedKeys) !== JSON.stringify([...PERMISSION_KEYS].sort())) {
        wrong.push(`GET /api/roles lists the system admin with ${listedKeys?.length ?? 'no'} keys, not the ${PERMISSION_KEYS.length} catalog keys`);
      }

      const edit = await h.put(`/api/roles/${stored.id}`, { name: stored.name, permissions: ['customers.view'] });
      if (edit.status !== 409) wrong.push(`changing the system admin role permissions returned ${edit.status}, not 409`);
      const [afterEdit] = await h.q(`SELECT permissions FROM roles WHERE id = $1`, [stored.id]);
      if (JSON.stringify(afterEdit.permissions) !== JSON.stringify(stored.permissions)) wrong.push(`the stored permissions became ${JSON.stringify(afterEdit.permissions)}`);

      const manager = await h.sessionWith(['roles.manage', 'daily_logs.view']);
      const rename = await h.put(`/api/roles/${stored.id}`, { name: 'نقش دیگر' }, manager);
      if (rename.status !== 403) wrong.push(`a holder of roles.manage renaming the system admin role got ${rename.status}, not 403`);

      const describe = await h.put(`/api/roles/${stored.id}`, { name: stored.name, description: 'توضیح آزمون td886' });
      if (describe.status !== 200) wrong.push(`the system admin changing its role description got ${describe.status}, not 200`);
      const [afterDescribe] = await h.q(`SELECT name, description FROM roles WHERE id = $1`, [stored.id]);
      if (afterDescribe.name !== stored.name) wrong.push(`the system admin role name became ${afterDescribe.name}`);
      if (afterDescribe.description !== 'توضیح آزمون td886') wrong.push(`the description was not saved (${afterDescribe.description})`);
      await h.q(`UPDATE roles SET name = $2, description = $3, permissions = $4::jsonb WHERE id = $1`, [stored.id, stored.name, stored.description, JSON.stringify(stored.permissions)]);
    });
  }

  if (shouldRun('sec_role_label_from_role_name_td_894', 'security', 'td894', 'roles', 'package2')) {
    await runCase(results, {
      id: 'sec_role_label_from_role_name_td_894',
      name: 'v9.0.144: /users/my-permissions gives every user, the system admin included, the stored name of its role (TD-894)',
      details: 'the system admin renames its role; GET /api/users/my-permissions as the system admin returns that name as roleName with isAdmin true; a user of another role gets that role\'s stored name',
    }, async (h, wrong) => {
      const [stored] = await h.q(`SELECT id, name, description FROM roles WHERE code = 'admin'`);
      const renamed = 'مدیر کل آزمون td894';
      try {
        const rename = await h.put(`/api/roles/${stored.id}`, { name: renamed, description: stored.description ?? '' });
        if (rename.status !== 200) wrong.push(`the system admin renaming its role got ${rename.status}, not 200`);
        const mine = await h.get('/api/users/my-permissions');
        if (mine.body?.roleName !== renamed) wrong.push(`the system admin got roleName ${JSON.stringify(mine.body?.roleName)}, not the stored name ${renamed}`);
        if (mine.body?.isAdmin !== true) wrong.push('the system admin is no longer reported as isAdmin');

        const other = await h.sessionWith(['daily_logs.view']);
        const [otherRole] = await h.q(`SELECT name FROM roles WHERE code = $1`, [other.role]);
        const otherMine = await h.get('/api/users/my-permissions', other);
        if (otherMine.body?.roleName !== otherRole?.name) {
          wrong.push(`a user of role ${other.role} got roleName ${JSON.stringify(otherMine.body?.roleName)}, not ${otherRole?.name}`);
        }
      } finally {
        await h.q(`UPDATE roles SET name = $2 WHERE id = $1`, [stored.id, stored.name]);
      }
    });
  }

  return results;
}
