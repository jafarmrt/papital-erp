import fs from 'fs';
import path from 'path';
import pkg from 'pg';
import type { CriticalScenarioId } from '../types.js';
import {
  adminUrl, clientToolsMissing, createScratchCluster, databaseUrlParts, makeAppDir, querySql, REPO_ROOT, runCommand,
  scriptEnv, urlFor, type ScratchCluster,
} from './scratchDatabase.js';
import { checkUpgradeRehearsal } from './upgradeRehearsalChecks.js';

/**
 * حوزه K (v8.0.84 تا v8.0.87): آزمون‌های اسکریپت‌های واقعی پشتیبان و بازیابی روی پایگاه‌داده‌ای با چیدمان پروداکشن
 * و داده شبیه‌ساز یک سال کاری. نقش پایگاه‌داده مثل نقش install.sh است: LOGIN، مالک پایگاه‌داده، بی CREATEDB.
 */

export interface RecoveryCheckOutcome {
  id: string;
  scenarioId?: CriticalScenarioId;
  name: string;
  violations: string[];
  info: string;
}

interface Ctx {
  cluster: ScratchCluster;
  appDir: string;
  dump: string;
}

const NAMES: Array<[string, string, CriticalScenarioId | undefined, string]> = [
  ['rec_td_362_backup_from_any_directory', 'v8.0.84: پشتیبان‌گیری از هر پوشه‌ای (مثل cron) نشانی پایگاه‌داده را از ‎.env برنامه می‌خواند و فایل‌های پیوست را هم بایگانی می‌کند؛ رکورد پیوست بی پوشه پیوست، پشتیبان ناقص نمی‌سازد (TD-362)', undefined,
    'پشتیبان از پوشه دیگر با ‎.env برنامه گرفته شد و پیوست‌ها در بایگانی بودند؛ نبود پوشه پیوست پشتیبان را رد کرد'],
  ['rec_td_361_restore_drill_compares_content', 'v8.0.85: تمرین بازیابی پایگاه‌داده بازیابی‌شده را سطر به سطر با فهرست محتوای همان پشتیبان مقایسه می‌کند؛ اختلاف، جدول اصلی خالیِ پشتیبان بی‌فهرست و پیوست گم‌شده را رد می‌کند (TD-361)', 'recovery_backup_restore',
    'بازیابی با فهرست یکی بود؛ فهرست دست‌خورده، users خالیِ پشتیبان بی‌فهرست و بایگانی پیوست گم‌شده رد شدند'],
  ['rec_td_363_drill_with_installed_role', 'v8.0.86: تمرین بازیابی با نقشی که install.sh می‌سازد (بی CREATEDB) با اتصال مدیر RESTORE_ADMIN_URL اجرا می‌شود و بی آن، پیش از هر کاری با راهنمای روشن می‌ایستد (TD-363)', undefined,
    'بی اتصال مدیر با راهنما ایستاد و چیزی نساخت؛ با RESTORE_ADMIN_URL تمرین گذشت و پایگاه‌داده موقت حذف شد'],
  ['rec_td_367_upgrade_rehearsal', 'v8.0.88: تمرین ارتقا مهاجرت‌های کد تازه را روی رونوشت آخرین پشتیبان اجرا می‌کند و مهاجرت خراب یا مهاجرتی که جمع دفتر، موجودی یا سلامت مالی را عوض کند پیش از راه‌اندازی رد می‌کند؛ پایگاه‌داده برنامه دست نمی‌خورد (TD-367)', undefined,
    'مهاجرت بی‌اثر پذیرفته شد؛ مهاجرت تغییردهنده موجودی با نام کالا و مهاجرت خراب رد شدند؛ رونوشت حذف و پایگاه‌داده برنامه دست‌نخورده ماند'],
  ['rec_td_360_apply_replaces_whole_database', 'v8.0.87: بازیابی واقعی (apply) پشتیبان را با داده کنونی قاطی نمی‌کند؛ نسخه بازیابی‌شده پس از سنجش جایگزین می‌شود، قبلی نگه داشته می‌شود و با اتصال باز سرویس رد می‌شود (TD-360)', undefined,
    'با اتصال باز رد شد و چیزی عوض نشد؛ سپس پایگاه‌داده دقیقاً برابر پشتیبان شد، نسخه قبلی و پوشه پیوست قبلی نگه داشته شدند'],
];

const listBackups = (dir: string, suffix: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(suffix)).map(f => path.join(dir, f)) : [];

function superuserUrl(database: string): string {
  const base = databaseUrlParts(process.env.DATABASE_URL ?? '');
  return urlFor(base.user, base.password, database);
}

/** نسخه‌ای از پشتیبان با نام دیگر (برای دست‌کاری فهرست یا حذف همراه‌ها بی خراب کردن نسخه اصلی) */
function copyBackup(dump: string, dir: string, parts: { manifest?: boolean; uploads?: boolean }): string {
  fs.mkdirSync(dir, { recursive: true });
  const base = dump.replace(/\.dump\.gz$/, '');
  const target = path.join(dir, path.basename(base));
  fs.copyFileSync(dump, `${target}.dump.gz`);
  if (parts.manifest && fs.existsSync(`${base}.manifest`)) fs.copyFileSync(`${base}.manifest`, `${target}.manifest`);
  if (parts.uploads && fs.existsSync(`${base}_uploads.tar.gz`)) fs.copyFileSync(`${base}_uploads.tar.gz`, `${target}_uploads.tar.gz`);
  return `${target}.dump.gz`;
}

async function drillDatabases(): Promise<string[]> {
  return (await querySql<{ datname: string }>(adminUrl(), `SELECT datname FROM pg_database WHERE datname LIKE 'erp\\_restore\\_drill\\_%' ORDER BY 1`)).map(r => r.datname);
}

async function checkBackupFromAnyDirectory(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const { appDir, cluster } = ctx;
  fs.writeFileSync(path.join(appDir, '.env'), `NODE_ENV=production\nDATABASE_URL="${cluster.appUrl}"\n`);
  const attDir = path.join(appDir, 'public', 'uploads', '.attachments');
  fs.mkdirSync(attDir, { recursive: true });
  fs.writeFileSync(path.join(attDir, 'k-a1.pdf'), 'pdf1');
  fs.writeFileSync(path.join(attDir, 'k-a2.pdf'), 'pdf2');
  const backupDir = path.join(cluster.tmpDir, 'backups');
  // مثل cron: پوشه کاری خانه کاربر است، نه پوشه برنامه، و DATABASE_URL در محیط نیست
  const r = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: backupDir }) });
  const dumps = listBackups(backupDir, '.dump.gz');
  if (r.code !== 0 || dumps.length !== 1) {
    v.push(`پشتیبان از پوشه دیگر انجام نشد (کد ${r.code}): ${r.output.slice(-300)}`);
    return v;
  }
  ctx.dump = dumps[0];
  const archive = dumps[0].replace(/\.dump\.gz$/, '_uploads.tar.gz');
  if (!fs.existsSync(archive)) {
    v.push('بایگانی پوشه بارگذاری‌ها (پیوست‌ها) ساخته نشد');
  } else {
    const list = await runCommand('tar', ['-tzf', archive]);
    if (!list.output.split('\n').includes('uploads/.attachments/k-a1.pdf')) v.push('فایل پیوست k-a1.pdf در بایگانی نیست');
  }
  // رکورد پیوست هست ولی پوشه پیوست نیست (مسیر اشتباه): پشتیبان باید شکست بخورد، نه فقط پایگاه‌داده را بگیرد
  fs.renameSync(path.join(appDir, 'public'), path.join(appDir, 'public.hidden'));
  try {
    const noAtt = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: path.join(cluster.tmpDir, 'backups-no-att') }) });
    if (noAtt.code === 0) v.push('پشتیبان با رکورد پیوست ولی بی پوشه پیوست «موفق» گزارش شد (پیوست‌ها بی‌صدا جا ماندند)');
  } finally {
    fs.renameSync(path.join(appDir, 'public.hidden'), path.join(appDir, 'public'));
  }
  return v;
}

async function checkDrillComparesContent(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const { appDir, cluster, dump } = ctx;
  const before = await drillDatabases();
  const env = scriptEnv({ DATABASE_URL: superuserUrl(cluster.database), RESTORE_ALLOW_SUDO: '0' });
  const restore = path.join(appDir, 'scripts', 'restore.sh');
  const ok = await runCommand('bash', [restore, dump], { env });
  if (ok.code !== 0 || !ok.output.includes('content identical')) v.push(`تمرین بازیابی پشتیبان سالم با فهرست مقایسه نشد یا شکست خورد (کد ${ok.code}): ${ok.output.slice(-300)}`);

  const tampered = copyBackup(dump, path.join(cluster.tmpDir, 'tampered'), { manifest: true, uploads: true });
  const manifestPath = tampered.replace(/\.dump\.gz$/, '.manifest');
  if (fs.existsSync(manifestPath)) {
    const text = fs.readFileSync(manifestPath, 'utf8');
    fs.writeFileSync(manifestPath, text.replace(/^table\|public\.journal_vouchers\|(\d+)\|/m, (_m, n: string) => `table|public.journal_vouchers|${Number(n) + 1}|`));
  } else {
    v.push('پشتیبان فهرست محتوا (manifest) ندارد');
  }
  const bad = await runCommand('bash', [restore, tampered], { env });
  if (bad.code === 0) v.push('تمرین بازیابی با پایگاه‌داده‌ای که با فهرست پشتیبان نمی‌خواند «موفق» گزارش شد');

  // پشتیبان قدیمی بی‌فهرست: users این پایگاه‌داده خالی است و بررسی پایه باید آن را بگیرد
  const legacy = copyBackup(dump, path.join(cluster.tmpDir, 'legacy'), { uploads: true });
  const legacyRun = await runCommand('bash', [restore, legacy], { env });
  if (legacyRun.code === 0) v.push('تمرین بازیابی پشتیبان بی‌فهرست با جدول اصلی خالی (users) «موفق» گزارش شد');

  const noUploads = copyBackup(dump, path.join(cluster.tmpDir, 'no-uploads'), { manifest: true });
  const noUploadsRun = await runCommand('bash', [restore, noUploads], { env });
  if (noUploadsRun.code === 0) v.push('تمرین بازیابی بی بایگانی پیوست‌ها (دو رکورد پیوست) «موفق» گزارش شد');

  const after = await drillDatabases();
  const leftover = after.filter(d => !before.includes(d));
  if (leftover.length > 0) v.push(`پایگاه‌داده تمرین حذف نشد: ${leftover.join(', ')}`);
  return v;
}

async function checkDrillWithInstalledRole(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const restore = path.join(ctx.appDir, 'scripts', 'restore.sh');
  const before = await drillDatabases();
  // مثل اپراتور: از پوشه برنامه اجرا می‌شود و نشانی پایگاه‌داده را از ‎.env آن می‌خواند
  const noAdmin = await runCommand('bash', [restore, ctx.dump], { cwd: ctx.appDir, env: scriptEnv({ RESTORE_ALLOW_SUDO: '0' }) });
  if (noAdmin.code === 0) v.push('تمرین بازیابی با نقش بی CREATEDB و بی اتصال مدیر نباید اجرا شود');
  if (!noAdmin.output.includes('RESTORE_ADMIN_URL')) v.push(`پیام شکست، راه چاره (RESTORE_ADMIN_URL) را نمی‌گوید: ${noAdmin.output.slice(-200)}`);
  const withAdmin = await runCommand('bash', [restore, ctx.dump], { cwd: ctx.appDir, env: scriptEnv({ RESTORE_ALLOW_SUDO: '0', RESTORE_ADMIN_URL: adminUrl() }) });
  if (withAdmin.code !== 0 || !withAdmin.output.includes('content identical')) v.push(`تمرین بازیابی با RESTORE_ADMIN_URL انجام نشد (کد ${withAdmin.code}): ${withAdmin.output.slice(-300)}`);
  const leftover = (await drillDatabases()).filter(d => !before.includes(d));
  if (leftover.length > 0) v.push(`پایگاه‌داده تمرین حذف نشد: ${leftover.join(', ')}`);
  return v;
}

async function manifestOf(url: string): Promise<string> {
  const r = await runCommand('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-tA', '-F|', '-c', 'BEGIN', '-f', path.join(REPO_ROOT, 'scripts', 'sql', 'backup-manifest.sql'), '-c', 'COMMIT']);
  return r.code === 0 ? r.output : `ERROR ${r.output}`;
}

async function checkApplyReplacesDatabase(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const { appDir, cluster, dump } = ctx;
  const target = cluster.appUrl;
  // پس از پشتیبان: داده تازه ثبت می‌شود و پیوستی اضافه
  await querySql(target, `DELETE FROM activity_logs`);
  await querySql(target, `INSERT INTO app_settings (key, value) VALUES ('k_after_backup', '1')`);
  const uploads = path.join(appDir, 'public', 'uploads');
  fs.writeFileSync(path.join(uploads, 'after-backup.txt'), 'new');
  const env = scriptEnv({ RESTORE_ALLOW_SUDO: '0', RESTORE_ADMIN_URL: adminUrl(), RESTORE_MODE: 'apply', RESTORE_CONFIRM: 'yes' });
  const restore = path.join(appDir, 'scripts', 'restore.sh');

  const service = new pkg.Client({ connectionString: target });
  await service.connect();
  try {
    const busy = await runCommand('bash', [restore, dump], { cwd: appDir, env });
    if (busy.code === 0) v.push('بازیابی واقعی با اتصال باز سرویس اجرا شد');
  } finally {
    await service.end();
  }
  const untouched = await querySql<{ n: number }>(target, `SELECT count(*)::int AS n FROM app_settings WHERE key = 'k_after_backup'`);
  if (untouched[0]?.n !== 1) v.push('بازیابی ردشده پایگاه‌داده هدف را تغییر داد');

  const applied = await runCommand('bash', [restore, dump], { cwd: appDir, env });
  if (applied.code !== 0) v.push(`بازیابی واقعی انجام نشد (کد ${applied.code}): ${applied.output.slice(-300)}`);
  const expected = fs.readFileSync(dump.replace(/\.dump\.gz$/, '.manifest'), 'utf8').split('\n').filter(l => /^(table|constraint)\|/.test(l)).join('\n');
  const actual = (await manifestOf(target)).trim();
  if (actual !== expected.trim()) v.push('پس از بازیابی، پایگاه‌داده دقیقاً برابر پشتیبان نیست (داده پس از پشتیبان یا جدول جاافتاده)');
  const kept = await querySql<{ datname: string }>(adminUrl(), `SELECT datname FROM pg_database WHERE datname LIKE $1`, [`${cluster.database}_before_restore_%`]);
  if (kept.length !== 1) {
    v.push('پایگاه‌داده پیش از بازیابی نگه داشته نشد');
  } else {
    const old = await querySql<{ n: number }>(superuserUrl(kept[0].datname), `SELECT count(*)::int AS n FROM app_settings WHERE key = 'k_after_backup'`);
    if (old[0]?.n !== 1) v.push('نسخه نگه‌داشته‌شده داده پس از پشتیبان را ندارد');
  }
  if (fs.existsSync(path.join(uploads, 'after-backup.txt'))) v.push('پوشه پیوست‌ها از بایگانی پشتیبان بازگردانده نشد');
  if (!fs.existsSync(path.join(uploads, '.attachments', 'k-a1.pdf'))) v.push('فایل پیوست پس از بازیابی نیست');
  const previous = fs.readdirSync(path.join(appDir, 'public')).filter(d => d.startsWith('uploads.before_restore_'));
  if (previous.length !== 1 || !fs.existsSync(path.join(appDir, 'public', previous[0], 'after-backup.txt'))) v.push('پوشه پیوست‌های پیش از بازیابی نگه داشته نشد');
  return v;
}

export async function runBackupRestoreChecks(): Promise<RecoveryCheckOutcome[]> {
  const outcome = (violations: string[][]): RecoveryCheckOutcome[] =>
    NAMES.map(([id, name, scenarioId, info], i) => ({ id, name, scenarioId, info, violations: violations[i] ?? ['اجرا نشد'] }));
  const missing = await clientToolsMissing();
  if (missing) return outcome(NAMES.map(() => [missing]));
  const cluster = await createScratchCluster('br');
  try {
    const populate = await runCommand(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['src/tests/recovery/populateRestoreSource.ts'], {
      env: { ...process.env, DATABASE_URL: cluster.appUrl, ERP_TEST_SCHEMA_ISOLATION: '0' },
    });
    if (populate.code !== 0) return outcome(NAMES.map(() => [`ساخت پایگاه‌داده منبع شکست خورد: ${populate.output.slice(-400)}`]));
    const ctx: Ctx = { cluster, appDir: makeAppDir(cluster.tmpDir), dump: '' };
    const results: string[][] = [await checkBackupFromAnyDirectory(ctx)];
    if (!ctx.dump) return outcome([results[0], ...NAMES.slice(1).map(() => ['پشتیبانی برای بازیابی ساخته نشد'])]);
    results.push(await checkDrillComparesContent(ctx));
    results.push(await checkDrillWithInstalledRole(ctx));
    results.push(await checkUpgradeRehearsal(ctx));
    results.push(await checkApplyReplacesDatabase(ctx));
    return outcome(results);
  } finally {
    await cluster.teardown();
  }
}
