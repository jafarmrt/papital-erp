import fs from 'fs';
import path from 'path';
import { adminUrl, querySql, REPO_ROOT, runCommand, scriptEnv, type ScratchCluster } from './scratchDatabase.js';

/**
 * حوزه K (v8.0.88، TD-367): تمرین ارتقا روی رونوشت پشتیبان. پوشه برنامه آزمایشی همان اسکریپت‌های مخزن را دارد و
 * پوشه مهاجرتش رونوشت `drizzle/` به‌اضافه یک مهاجرت آزمایشی است: بی‌اثر، تغییر دهنده موجودی، یا خراب. تمرین باید
 * اولی را بپذیرد، دومی را با نام کالا و سومی را با خطای مهاجرت رد کند، رونوشت را حذف کند و پایگاه‌داده برنامه را
 * دست نزند. اجرای مستقیم بخش TypeScript روی پایگاه‌داده‌ای جز رونوشت تمرین هم رد می‌شود.
 */

interface RehearsalCtx {
  cluster: ScratchCluster;
  appDir: string;
  dump: string;
}

/** پوشه برنامه برای یک تمرین: اسکریپت‌ها و ‎.env پوشه آزمون پشتیبان، مهاجرت‌ها با یک مهاجرت آزمایشی */
function rehearsalAppDir(ctx: RehearsalCtx, name: string, probeSql: string): string {
  const dir = path.join(ctx.cluster.tmpDir, name);
  fs.mkdirSync(path.join(dir, 'scripts', 'sql'), { recursive: true });
  for (const rel of ['scripts/backup.sh', 'scripts/restore.sh', 'scripts/sql/backup-manifest.sql', 'scripts/upgrade-rehearsal.sh', '.env']) {
    const from = fs.existsSync(path.join(ctx.appDir, rel)) ? path.join(ctx.appDir, rel) : path.join(REPO_ROOT, rel);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, rel));
  }
  // بخش TypeScript و وابستگی‌ها از خود مخزن (پیوند نمادین: import ها به مسیر واقعی مخزن می‌روند)
  if (fs.existsSync(path.join(REPO_ROOT, 'scripts', 'upgrade-rehearsal.ts'))) {
    fs.symlinkSync(path.join(REPO_ROOT, 'scripts', 'upgrade-rehearsal.ts'), path.join(dir, 'scripts', 'upgrade-rehearsal.ts'));
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const drizzleDir = path.join(dir, 'drizzle');
  fs.cpSync(path.join(REPO_ROOT, 'drizzle'), drizzleDir, { recursive: true });
  const journalPath = path.join(drizzleDir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };
  const last = journal.entries[journal.entries.length - 1];
  const tag = `${String(last.idx + 1).padStart(4, '0')}_k_rehearsal_probe`;
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 3_600_000, tag, breakpoints: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(drizzleDir, `${tag}.sql`), probeSql);
  return dir;
}

async function drillDatabases(): Promise<string[]> {
  return (await querySql<{ datname: string }>(adminUrl(), `SELECT datname FROM pg_database WHERE datname LIKE 'erp\\_restore\\_drill\\_%'`)).map(r => r.datname);
}

export async function checkUpgradeRehearsal(ctx: RehearsalCtx): Promise<string[]> {
  const v: string[] = [];
  const env = scriptEnv({ RESTORE_ALLOW_SUDO: '0', RESTORE_ADMIN_URL: adminUrl(), ERP_TEST_SCHEMA_ISOLATION: '0', NODE_ENV: 'production' });
  const before = await drillDatabases();
  const sourceStock = await querySql<{ s: string }>(ctx.cluster.appUrl, `SELECT COALESCE(SUM(current_stock), 0)::text AS s FROM item_warehouse_stocks`);
  const rehearse = async (name: string, probeSql: string) => {
    const dir = rehearsalAppDir(ctx, name, probeSql);
    return runCommand('bash', [path.join(dir, 'scripts', 'upgrade-rehearsal.sh'), ctx.dump], { cwd: dir, env, timeoutMs: 600_000 });
  };

  const harmless = await rehearse('rehearsal-ok', 'CREATE TABLE k_rehearsal_probe (id integer);');
  if (harmless.code !== 0 || !harmless.output.includes('migrations: 1 applied') || !harmless.output.includes('SUCCESS')) {
    v.push(`The upgrade rehearsal with a no-op migration did not pass (code ${harmless.code}): ${harmless.output.slice(-400)}`);
  }

  const stockChange = await rehearse('rehearsal-stock', `UPDATE item_warehouse_stocks SET current_stock = current_stock + 1
    WHERE id = (SELECT min(id) FROM item_warehouse_stocks WHERE current_stock > 0);`);
  if (stockChange.code === 0) v.push('A migration that changes item stock was judged "safe" by the rehearsal');
  else if (!/item .+ in warehouse .+: \S+ → \S+/.test(stockChange.output)) v.push(`The rehearsal did not name the changed item: ${stockChange.output.slice(-400)}`);

  const broken = await rehearse('rehearsal-broken', 'SELECT 1 / 0;');
  if (broken.code === 0 || !broken.output.includes('migrations FAILED')) v.push(`The rehearsal did not refuse a broken migration (code ${broken.code}): ${broken.output.slice(-300)}`);

  // پایگاه‌داده برنامه دست نخورده و رونوشت‌ها حذف شده‌اند
  const sourceAfter = await querySql<{ s: string; probe: boolean }>(ctx.cluster.appUrl,
    `SELECT COALESCE(SUM(current_stock), 0)::text AS s, to_regclass('k_rehearsal_probe') IS NOT NULL AS probe FROM item_warehouse_stocks`);
  if (sourceAfter[0]?.s !== sourceStock[0]?.s || sourceAfter[0]?.probe) v.push('The upgrade rehearsal changed the app database');
  const leftover = (await drillDatabases()).filter(d => !before.includes(d));
  if (leftover.length > 0) v.push(`The rehearsal copy was not dropped: ${leftover.join(', ')}`);

  // بخش TypeScript هرگز روی پایگاه‌داده‌ای جز رونوشت تمرین مهاجرت نمی‌دهد
  const direct = await runCommand(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [path.join(REPO_ROOT, 'scripts', 'upgrade-rehearsal.ts')], {
    cwd: path.join(ctx.cluster.tmpDir, 'rehearsal-ok'), env: { ...env, DATABASE_URL: ctx.cluster.appUrl },
  });
  if (direct.code === 0 || !direct.output.includes('REFUSED')) v.push(`Running the rehearsal directly on the app database was not refused (code ${direct.code})`);

  // update.sh --rehearse تمرین را پیش از راه‌اندازی دوباره اجرا می‌کند و بی پشتیبان پیش از استقرار پذیرفته نمی‌شود
  const update = fs.readFileSync(path.join(REPO_ROOT, 'update.sh'), 'utf8');
  if (!update.includes('bash scripts/upgrade-rehearsal.sh "$PRE_DEPLOY_DUMP"')) v.push('update.sh --rehearse does not run the upgrade rehearsal on the backup before deploying');
  const noBackup = await runCommand('bash', [path.join(REPO_ROOT, 'update.sh'), '--rehearse', '--no-backup'], {
    cwd: ctx.cluster.tmpDir, env: { ...env, APP_DIR: ctx.cluster.tmpDir },
  });
  if (noBackup.code !== 1 || !noBackup.output.includes('--no-backup')) v.push(`update.sh --rehearse --no-backup was not refused (code ${noBackup.code})`);
  return v;
}
