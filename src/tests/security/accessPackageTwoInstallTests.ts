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

  return results;
}
