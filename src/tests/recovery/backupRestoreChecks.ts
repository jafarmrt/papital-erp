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
  ['rec_td_362_backup_from_any_directory', 'v8.0.84: a backup from any directory (such as cron) reads the database URL from the app .env and archives the attachment files too; an attachment record without the attachment directory does not produce a partial backup (TD-362)', undefined,
    'The backup from another directory used the app .env and the attachments were in the archive; a missing attachment directory refused the backup'],
  ['rec_td_957_daily_backup_goes_offsite',
    'v10.0.4: the daily backup copies its dump, manifest, attachment archive and the .env with ERP_SECRETS_KEY to the encrypted rclone remote and records both times; a failed copy keeps the local backup and exits 3 (TD-957)', undefined,
    'The remote held the four files and the .env copy; daily_ok and offsite_ok were written; with a failing upload the run exited 3 and kept the local dump'],
  ['rec_td_361_restore_drill_compares_content', 'v8.0.85: the restore drill compares the restored database row by row with the content manifest of the same backup; a difference, an empty main table in a backup without a manifest and a missing attachment are refused (TD-361)', 'recovery_backup_restore',
    'The restore matched the manifest; a tampered manifest, an empty users table in a backup without a manifest and a missing attachment archive were refused'],
  ['rec_td_363_drill_with_installed_role', 'v8.0.86: the restore drill with the role install.sh creates (no CREATEDB) runs with the admin connection RESTORE_ADMIN_URL, and without it stops before doing anything with clear guidance (TD-363)', undefined,
    'Without the admin connection it stopped with guidance and created nothing; with RESTORE_ADMIN_URL the drill passed and the temporary database was dropped'],
  ['rec_td_367_upgrade_rehearsal', 'v8.0.88: the upgrade rehearsal runs the migrations of the new code on a copy of the last backup and, before startup, refuses a broken migration or one that changes ledger totals, stock or financial health; the app database is untouched (TD-367)', undefined,
    'A no-op migration was accepted; a stock-changing migration (reported with the item name) and a broken migration were refused; the copy was dropped and the app database stayed untouched'],
  ['rec_td_360_apply_replaces_whole_database', 'v8.0.87: a real restore (apply) does not mix the backup with current data; the restored copy replaces the database after verification, the previous one is kept, and it is refused while the service has an open connection (TD-360)', undefined,
    'Refused with an open connection and nothing changed; then the database became exactly equal to the backup, and the previous copy and the previous attachment directory were kept'],
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
    v.push(`Backup from another directory failed (code ${r.code}): ${r.output.slice(-300)}`);
    return v;
  }
  ctx.dump = dumps[0];
  const archive = dumps[0].replace(/\.dump\.gz$/, '_uploads.tar.gz');
  if (!fs.existsSync(archive)) {
    v.push('The archive of the uploads (attachments) directory was not created');
  } else {
    const list = await runCommand('tar', ['-tzf', archive]);
    if (!list.output.split('\n').includes('uploads/.attachments/k-a1.pdf')) v.push('Attachment file k-a1.pdf is not in the archive');
  }
  // رکورد پیوست هست ولی پوشه پیوست نیست (مسیر اشتباه): پشتیبان باید شکست بخورد، نه فقط پایگاه‌داده را بگیرد
  fs.renameSync(path.join(appDir, 'public'), path.join(appDir, 'public.hidden'));
  try {
    const noAtt = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: path.join(cluster.tmpDir, 'backups-no-att') }) });
    if (noAtt.code === 0) v.push('A backup with an attachment record but no attachment directory was reported "successful" (the attachments were silently left out)');
  } finally {
    fs.renameSync(path.join(appDir, 'public.hidden'), path.join(appDir, 'public'));
  }
  return v;
}

const FAKE_RCLONE = `#!/bin/bash
case "$1" in
  listremotes) echo "papital-crypt: crypt" ;;
  copyto) [ "\${FAKE_RCLONE_FAIL:-}" != "copy" ] || exit 1; cp "$2" "$FAKE_REMOTE_DIR/\${3##*/}" ;;
  lsl) for f in "$FAKE_REMOTE_DIR"/*; do [ -f "$f" ] && printf '%9d 2026-10-09 02:30:00.000000000 %s\\n' "$(stat -c %s "$f")" "\${f##*/}"; done; true ;;
  delete) ;;
  *) exit 1 ;;
esac
`;

async function checkBackupGoesOffsite(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const { appDir, cluster } = ctx;
  const root = path.join(cluster.tmpDir, 'offsite');
  const binDir = path.join(root, 'bin');
  const remoteDir = path.join(root, 'remote');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(remoteDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'rclone'), FAKE_RCLONE, { mode: 0o755 });
  const envFile = path.join(appDir, '.env');
  const envBefore = fs.readFileSync(envFile, 'utf8');
  fs.writeFileSync(envFile, `${envBefore}ERP_SECRETS_KEY=offsite-check-key\nBACKUP_RCLONE_REMOTE=papital-crypt:erp\n`);
  try {
    const backupDir = path.join(root, 'backups');
    const env = scriptEnv({ BACKUP_DIR: backupDir, PATH: `${binDir}:${process.env.PATH}`, FAKE_REMOTE_DIR: remoteDir });
    const ok = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env });
    if (ok.code !== 0) return [`The daily backup with an off-server remote failed (code ${ok.code}): ${ok.output.slice(-300)}`];
    const remote = fs.readdirSync(remoteDir).sort();
    for (const suffix of ['.dump.gz', '.manifest', '_uploads.tar.gz', '.env']) {
      if (!remote.some(f => f.endsWith(suffix))) v.push(`The off-server copy has no *${suffix} file (remote: ${remote.join(', ')})`);
    }
    const envCopy = remote.find(f => f.endsWith('.env'));
    if (envCopy && !fs.readFileSync(path.join(remoteDir, envCopy), 'utf8').includes('ERP_SECRETS_KEY=offsite-check-key')) v.push('The .env copy does not carry ERP_SECRETS_KEY');
    for (const status of ['daily_ok', 'offsite_ok']) {
      if (!fs.existsSync(path.join(backupDir, `.last_${status}`))) v.push(`The status file .last_${status} was not written`);
    }
    const failDir = path.join(root, 'backups-fail');
    const failed = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env: { ...env, BACKUP_DIR: failDir, FAKE_RCLONE_FAIL: 'copy' } });
    if (failed.code !== 3) v.push(`A failed off-server copy exited ${failed.code} (expected 3): ${failed.output.slice(-200)}`);
    if (listBackups(failDir, '.dump.gz').length !== 1) v.push('A failed off-server copy did not keep the local dump');
    if (fs.existsSync(path.join(failDir, '.last_offsite_ok'))) v.push('A failed off-server copy wrote offsite_ok');
  } finally {
    fs.writeFileSync(envFile, envBefore);
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
  if (ok.code !== 0 || !ok.output.includes('content identical')) v.push(`The restore drill of a sound backup was not compared with the manifest or failed (code ${ok.code}): ${ok.output.slice(-300)}`);

  const tampered = copyBackup(dump, path.join(cluster.tmpDir, 'tampered'), { manifest: true, uploads: true });
  const manifestPath = tampered.replace(/\.dump\.gz$/, '.manifest');
  if (fs.existsSync(manifestPath)) {
    const text = fs.readFileSync(manifestPath, 'utf8');
    fs.writeFileSync(manifestPath, text.replace(/^table\|public\.journal_vouchers\|(\d+)\|/m, (_m, n: string) => `table|public.journal_vouchers|${Number(n) + 1}|`));
  } else {
    v.push('The backup has no content manifest');
  }
  const bad = await runCommand('bash', [restore, tampered], { env });
  if (bad.code === 0) v.push('The restore drill with a database that does not match the backup manifest was reported "successful"');

  // پشتیبان قدیمی بی‌فهرست: users این پایگاه‌داده خالی است و بررسی پایه باید آن را بگیرد
  const legacy = copyBackup(dump, path.join(cluster.tmpDir, 'legacy'), { uploads: true });
  const legacyRun = await runCommand('bash', [restore, legacy], { env });
  if (legacyRun.code === 0) v.push('The restore drill of a backup without a manifest and with an empty main table (users) was reported "successful"');

  const noUploads = copyBackup(dump, path.join(cluster.tmpDir, 'no-uploads'), { manifest: true });
  const noUploadsRun = await runCommand('bash', [restore, noUploads], { env });
  if (noUploadsRun.code === 0) v.push('The restore drill without the attachment archive (two attachment records) was reported "successful"');

  const after = await drillDatabases();
  const leftover = after.filter(d => !before.includes(d));
  if (leftover.length > 0) v.push(`Drill database was not dropped: ${leftover.join(', ')}`);
  return v;
}

async function checkDrillWithInstalledRole(ctx: Ctx): Promise<string[]> {
  const v: string[] = [];
  const restore = path.join(ctx.appDir, 'scripts', 'restore.sh');
  const before = await drillDatabases();
  // مثل اپراتور: از پوشه برنامه اجرا می‌شود و نشانی پایگاه‌داده را از ‎.env آن می‌خواند
  const noAdmin = await runCommand('bash', [restore, ctx.dump], { cwd: ctx.appDir, env: scriptEnv({ RESTORE_ALLOW_SUDO: '0' }) });
  if (noAdmin.code === 0) v.push('The restore drill must not run with a role without CREATEDB and without an admin connection');
  if (!noAdmin.output.includes('RESTORE_ADMIN_URL')) v.push(`The failure message does not give the remedy (RESTORE_ADMIN_URL): ${noAdmin.output.slice(-200)}`);
  const withAdmin = await runCommand('bash', [restore, ctx.dump], { cwd: ctx.appDir, env: scriptEnv({ RESTORE_ALLOW_SUDO: '0', RESTORE_ADMIN_URL: adminUrl() }) });
  if (withAdmin.code !== 0 || !withAdmin.output.includes('content identical')) v.push(`The restore drill with RESTORE_ADMIN_URL failed (code ${withAdmin.code}): ${withAdmin.output.slice(-300)}`);
  const leftover = (await drillDatabases()).filter(d => !before.includes(d));
  if (leftover.length > 0) v.push(`Drill database was not dropped: ${leftover.join(', ')}`);
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
    if (busy.code === 0) v.push('The real restore ran while the service had an open connection');
  } finally {
    await service.end();
  }
  const untouched = await querySql<{ n: number }>(target, `SELECT count(*)::int AS n FROM app_settings WHERE key = 'k_after_backup'`);
  if (untouched[0]?.n !== 1) v.push('The refused restore changed the target database');

  const applied = await runCommand('bash', [restore, dump], { cwd: appDir, env });
  if (applied.code !== 0) v.push(`The real restore failed (code ${applied.code}): ${applied.output.slice(-300)}`);
  const expected = fs.readFileSync(dump.replace(/\.dump\.gz$/, '.manifest'), 'utf8').split('\n').filter(l => /^(table|constraint)\|/.test(l)).join('\n');
  const actual = (await manifestOf(target)).trim();
  if (actual !== expected.trim()) v.push('After the restore the database is not exactly equal to the backup (data written after the backup or a missing table)');
  const kept = await querySql<{ datname: string }>(adminUrl(), `SELECT datname FROM pg_database WHERE datname LIKE $1`, [`${cluster.database}_before_restore_%`]);
  if (kept.length !== 1) {
    v.push('The pre-restore database was not kept');
  } else {
    const old = await querySql<{ n: number }>(superuserUrl(kept[0].datname), `SELECT count(*)::int AS n FROM app_settings WHERE key = 'k_after_backup'`);
    if (old[0]?.n !== 1) v.push('The kept copy does not have the data written after the backup');
  }
  if (fs.existsSync(path.join(uploads, 'after-backup.txt'))) v.push('The attachments directory was not restored from the backup archive');
  if (!fs.existsSync(path.join(uploads, '.attachments', 'k-a1.pdf'))) v.push('The attachment file is missing after the restore');
  const previous = fs.readdirSync(path.join(appDir, 'public')).filter(d => d.startsWith('uploads.before_restore_'));
  if (previous.length !== 1 || !fs.existsSync(path.join(appDir, 'public', previous[0], 'after-backup.txt'))) v.push('The pre-restore attachments directory was not kept');
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
    results.push(await checkBackupGoesOffsite(ctx));
    results.push(await checkDrillComparesContent(ctx));
    results.push(await checkDrillWithInstalledRole(ctx));
    results.push(await checkUpgradeRehearsal(ctx));
    results.push(await checkApplyReplacesDatabase(ctx));
    return outcome(results);
  } finally {
    await cluster.teardown();
  }
}
