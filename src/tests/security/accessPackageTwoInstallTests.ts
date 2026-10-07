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

        // a role with a former seed code whose admin took products.delete away (the seed until v9.0.115 put it back)
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

  return results;
}
