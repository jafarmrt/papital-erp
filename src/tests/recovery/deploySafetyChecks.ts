import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { TEST_MARKER } from '../fixtures/testMarker.js';
import type { RecoveryCheckOutcome } from './backupRestoreChecks.js';
import { clientToolsMissing, createScratchCluster, makeAppDir, querySql, REPO_ROOT, runCommand, scriptEnv, type ScratchCluster } from './scratchDatabase.js';

/**
 * Package 1, PR «الف» (v9.0.121 to v9.0.124): deployment safety, proven by running the real scripts.
 * - TD-581: `npm run db:cleanup-test` on a database with a simulated business year.
 * - TD-585: `scripts/backup.sh` output modes and the `go-live-verify.sh` check.
 * - TD-586 / TD-587: `update.sh` in git mode on a throwaway clone, with fake npm, systemctl and sudo on PATH.
 */

const NAMES: Array<[string, string, string]> = [
  ['rec_td_581_cleanup_script_guarded',
    'db:cleanup-test refuses outside test/development without ERP_ALLOW_TEST_CLEANUP=1, previews by default and with --force deletes only unreferenced marker rows (TD-581)',
    'production run refused before connecting; preview changed nothing; --force removed exactly the marker rows; Kardex and sequences untouched'],
  ['rec_td_585_backup_private',
    'backup.sh writes a private backup directory (0700) and files (0600) even under umask 022, and go-live-verify fails on readable backups (TD-585)',
    'directory 0700, dump, manifest and uploads archive 0600; go-live-verify passed the private directory and failed the readable one'],
  ['rec_td_586_update_build_failure_keeps_dist',
    'a failed build during update.sh puts the previous dist/ back and prints the rollback steps with the data-loss warning (TD-586)',
    'dist/server.cjs kept after the failed build; rollback steps printed once with the backup warning'],
  ['rec_td_587_update_port_from_env',
    'update.sh waits for startup on PORT from .env, the port the service listens on (TD-587)',
    'update.sh verified startup on the PORT written by install.sh'],
];

const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MARK = `${TEST_MARKER} p01`;

// ---------- TD-581 ----------

async function manifest(url: string): Promise<string> {
  const r = await runCommand('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-tA', '-F|', '-c', 'BEGIN',
    '-f', path.join(REPO_ROOT, 'scripts', 'sql', 'backup-manifest.sql'), '-c', 'COMMIT']);
  if (r.code !== 0) throw new Error(`manifest failed: ${r.output.slice(-300)}`);
  return r.output;
}

function manifestDiff(before: string, after: string): string[] {
  const a = new Set(before.split('\n'));
  const b = new Set(after.split('\n'));
  return [...[...a].filter(l => !b.has(l)).map(l => `- ${l}`), ...[...b].filter(l => !a.has(l)).map(l => `+ ${l}`)].slice(0, 6);
}

async function sequences(url: string): Promise<string> {
  const rows = await querySql<{ s: string }>(url, `SELECT string_agg(sequencename || '=' || coalesce(last_value::text, '-'), ',' ORDER BY sequencename) AS s FROM pg_sequences`);
  return rows[0]?.s ?? '';
}

/** Marker rows that nothing else refers to: all of them must go */
async function insertDeletableMarkers(url: string): Promise<void> {
  await querySql(url, `
    WITH acc AS (SELECT id FROM accounts ORDER BY id LIMIT 1),
    per AS (INSERT INTO personnel (full_name) VALUES ($1 || ' personnel') RETURNING id),
    pay AS (INSERT INTO piecework_payrolls (payroll_number, personnel_id, start_date, end_date, title, net_payable)
      SELECT 'P01-MARK-1', id, '2026-01-01', '2026-01-31', $1 || ' payroll', 0 FROM per RETURNING id),
    plog AS (INSERT INTO piecework_logs (personnel_id, task_id, date, quantity, unit_rate, total_amount, notes, payroll_id)
      SELECT per.id, 1, '2026-01-05', 1, 1, 1, $1, pay.id FROM per, pay RETURNING id),
    item AS (INSERT INTO items (type, name, code, unit) VALUES ('product', $1 || ' item', 'P01-MARK-ITEM', 'عدد') RETURNING id),
    price AS (INSERT INTO item_prices (item_id, title, price) SELECT id, 'p', 1 FROM item RETURNING id),
    doc AS (INSERT INTO documents (type, ref_number, date, notes, status) VALUES ('invoice', 'P01-MARK-DOC', now(), $1, 'draft') RETURNING id),
    line AS (INSERT INTO document_items (document_id, item_id, quantity) SELECT doc.id, item.id, 1 FROM doc, item RETURNING id),
    dv AS (INSERT INTO journal_vouchers (voucher_number, date, description, source_document_id)
      SELECT 990001, '2026-01-05', 'draft voucher of a marked invoice', id FROM doc RETURNING id),
    dvi AS (INSERT INTO journal_voucher_items (voucher_id, account_id) SELECT dv.id, acc.id FROM dv, acc RETURNING id),
    v AS (INSERT INTO journal_vouchers (voucher_number, date, description) VALUES (990002, '2026-01-05', $1 || ' voucher') RETURNING id),
    vi AS (INSERT INTO journal_voucher_items (voucher_id, account_id) SELECT v.id, acc.id FROM v, acc RETURNING id),
    cust AS (INSERT INTO customers (name) VALUES ($1 || ' customer') RETURNING id),
    lead AS (INSERT INTO crm_leads (title) VALUES ($1 || ' lead') RETURNING id),
    act AS (INSERT INTO crm_activities (type, title, lead_id) SELECT 'call', 'call', id FROM lead RETURNING id),
    proj AS (INSERT INTO production_projects (project_code, title) VALUES ('P01-MARK-PRJ', $1 || ' project') RETURNING id),
    stage AS (INSERT INTO project_stages (project_id, title) SELECT id, 's' FROM proj RETURNING id)
    INSERT INTO daily_work_logs (user_id, username, date, title, content) VALUES (1, 'p01', '2026-01-05', $1 || ' log', 'c')`, [MARK]);
}

export async function checkCleanupScript(cluster: ScratchCluster): Promise<string[]> {
  const v: string[] = [];
  const url = cluster.appUrl;
  const run = (env: Record<string, string>, args: string[] = []) => runCommand(tsx, ['scripts/cleanup-test-data.ts', ...args],
    { env: scriptEnv({ DATABASE_URL: url, ERP_TEST_SCHEMA_ISOLATION: '0', ...env }), timeoutMs: 120_000 });

  const clean = await manifest(url);
  await insertDeletableMarkers(url);
  const marked = await manifest(url);
  const seqBefore = await sequences(url);

  // 1. production .env: refused before anything is read (the old script deleted payrolls, vouchers, items, users)
  for (const [label, env] of [
    ['NODE_ENV=production', { NODE_ENV: 'production', ERP_ALLOW_TEST_CLEANUP: '1' }],
    ['no ERP_ALLOW_TEST_CLEANUP', { NODE_ENV: 'development', ERP_ALLOW_TEST_CLEANUP: '' }],
  ] as Array<[string, Record<string, string>]>) {
    const r = await run(env, ['--force']);
    if (r.code === 0 || !r.output.includes('Refused')) v.push(`${label}: not refused (exit ${r.code}): ${r.output.slice(-200)}`);
    const diff = manifestDiff(marked, await manifest(url));
    if (diff.length > 0) v.push(`${label}: data changed: ${diff.join(' ; ')}`);
  }

  const allowed = { NODE_ENV: 'development', ERP_ALLOW_TEST_CLEANUP: '1' };
  // 2. preview is the default and changes nothing
  const preview = await run(allowed);
  if (preview.code !== 0 || !preview.output.includes('PREVIEW')) v.push(`preview failed (exit ${preview.code}): ${preview.output.slice(-300)}`);
  const afterPreview = manifestDiff(marked, await manifest(url));
  if (afterPreview.length > 0) v.push(`preview changed data: ${afterPreview.join(' ; ')}`);

  // 3. --force removes exactly the marker rows: the database is again equal to the simulated year
  const forced = await run(allowed, ['--force']);
  if (forced.code !== 0) v.push(`--force failed (exit ${forced.code}): ${forced.output.slice(-300)}`);
  const leftover = manifestDiff(clean, await manifest(url));
  if (leftover.length > 0) v.push(`--force did not restore the database to its state before the marker rows: ${leftover.join(' ; ')}`);
  if ((await sequences(url)) !== seqBefore) v.push('a sequence changed');

  // 4. a marker item with a Kardex row stays, and so does its Kardex row
  await querySql(url, `WITH item AS (INSERT INTO items (type, name, code, unit) VALUES ('product', $1 || ' kardex item', 'P01-MARK-KX', 'عدد') RETURNING id)
    INSERT INTO transactions (item_id, type, quantity, date) SELECT id, 'in', 1, now() FROM item`, [MARK]);
  const kardex = await manifest(url);
  const second = await run(allowed, ['--force']);
  // the simulated year's own marker rows that are still referenced are kept on every run; the Kardex item adds one
  const kept = (out: string) => Number(out.match(/(\d+) marked row\(s\) kept/)?.[1] ?? 0);
  if (second.code !== 0 || kept(second.output) !== kept(forced.output) + 1) {
    v.push(`item with a Kardex row not reported as kept (${kept(forced.output)} then ${kept(second.output)}): ${second.output.slice(-300)}`);
  }
  const kardexDiff = manifestDiff(kardex, await manifest(url));
  if (kardexDiff.length > 0) v.push(`item with a Kardex row or its Kardex row was deleted: ${kardexDiff.join(' ; ')}`);
  return v;
}

// ---------- TD-585 ----------

const mode = (p: string) => (fs.statSync(p).mode & 0o777).toString(8);

export async function checkBackupPrivate(cluster: ScratchCluster): Promise<string[]> {
  const v: string[] = [];
  const appDir = makeAppDir(path.join(cluster.tmpDir, 'p01-backup'));
  fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'go-live-verify.sh'), path.join(appDir, 'scripts', 'go-live-verify.sh'));
  fs.writeFileSync(path.join(appDir, '.env'), `NODE_ENV=production\nDATABASE_URL="${cluster.appUrl}"\n`);
  fs.mkdirSync(path.join(appDir, 'public', 'uploads', '.attachments'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'public', 'uploads', 'logo.png'), 'png');
  const backupDir = path.join(cluster.tmpDir, 'p01-backups');
  const r = await runCommand('bash', ['-c', `umask 022; bash "${path.join(appDir, 'scripts', 'backup.sh')}"`],
    { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: backupDir }) });
  if (r.code !== 0) return [`backup failed (exit ${r.code}): ${r.output.slice(-300)}`];
  if (mode(backupDir) !== '700') v.push(`backup directory mode ${mode(backupDir)}, expected 700`);
  const files = fs.readdirSync(backupDir);
  if (!files.some(f => f.endsWith('_uploads.tar.gz'))) v.push('no uploads archive was written');
  for (const f of files) {
    if (mode(path.join(backupDir, f)) !== '600') v.push(`${f} mode ${mode(path.join(backupDir, f))}, expected 600`);
  }

  const verify = (dir: string) => runCommand('bash', [path.join(appDir, 'scripts', 'go-live-verify.sh'), 'http://127.0.0.1:9'],
    { cwd: appDir, env: scriptEnv({ APP_DIR: appDir, BACKUP_DIR: dir }), timeoutMs: 120_000 });
  const privateRun = await verify(backupDir);
  if (!privateRun.output.includes('[PASS] Backup directory is private')) v.push(`go-live-verify did not pass the private directory: ${privateRun.output.slice(-200)}`);
  fs.chmodSync(backupDir, 0o755);
  fs.chmodSync(path.join(backupDir, files[0]), 0o644);
  const openRun = await verify(backupDir);
  if (!/\[FAIL\] Backup directory .* has mode 755/.test(openRun.output)) v.push('go-live-verify did not fail a backup directory with mode 755');
  if (!/\[FAIL\] 1 backup file\(s\) readable by other users/.test(openRun.output)) v.push('go-live-verify did not fail a backup file with mode 644');
  return v;
}

// ---------- TD-586 / TD-587 ----------

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd, stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'p01', GIT_AUTHOR_EMAIL: 'p01@example.com', GIT_COMMITTER_NAME: 'p01', GIT_COMMITTER_EMAIL: 'p01@example.com' },
  });
}

/** origin with two commits; the app clone is on the first, so update.sh pulls the second (package version 9.9.2) */
export function makeGitApp(root: string): string {
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const app = path.join(root, 'app');
  git(root, ['init', '-q', '--bare', '-b', 'master', origin]);
  git(root, ['clone', '-q', origin, work]);
  fs.mkdirSync(path.join(work, 'scripts'));
  for (const rel of ['update.sh', 'scripts/verify-startup.sh', 'scripts/untrack-node-modules-link.sh']) {
    fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(work, rel));
  }
  fs.writeFileSync(path.join(work, 'server.ts'), '');
  fs.writeFileSync(path.join(work, '.gitignore'), 'dist\n.env\n*.log\n');
  fs.writeFileSync(path.join(work, 'package.json'), '{ "name": "p01", "version": "9.9.1" }\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'one']);
  git(work, ['push', '-q', 'origin', 'HEAD:master']);
  git(root, ['clone', '-q', origin, app]);
  fs.writeFileSync(path.join(work, 'package.json'), '{ "name": "p01", "version": "9.9.2" }\n');
  git(work, ['commit', '-q', '-am', 'two']);
  git(work, ['push', '-q', 'origin', 'HEAD:master']);
  fs.mkdirSync(path.join(app, 'dist'));
  fs.writeFileSync(path.join(app, 'dist', 'server.cjs'), 'previous build');
  return app;
}

/** npm (vite empties dist/ first, then the build fails when FAKE_BUILD_FAIL=1), systemctl and sudo */
export function fakeBin(root: string): string {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const write = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  write('npm', `if [ "$1 $2" = "run build" ]; then rm -rf dist/*; [ -z "\${FAKE_BUILD_FAIL:-}" ] || exit 1; mkdir -p dist; echo new > dist/server.cjs; fi; exit 0`);
  write('systemctl', `[ "$1" = "list-unit-files" ] && echo "papital-erp.service enabled"; exit 0`);
  write('sudo', 'exec "$@"');
  return bin;
}

export function startupServer(version: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/health/startup') res.writeHead(200).end('{"status":"started"}');
    else if (req.url === '/health') res.writeHead(200).end(`{"status":"ok","version":"${version}"}`);
    else res.writeHead(404).end();
  });
  return new Promise(resolve => server.listen(0, () => resolve({
    port: (server.address() as AddressInfo).port, close: () => new Promise(r => server.close(() => r())),
  })));
}

export async function runUpdate(app: string, bin: string, extra: Record<string, string>, args: string[] = ['--no-backup']): Promise<{ code: number; output: string }> {
  return runCommand('bash', [path.join(app, 'update.sh'), ...args], {
    cwd: path.dirname(app),
    env: scriptEnv({ PATH: `${bin}:${process.env.PATH ?? ''}`, APP_DIR: app, STARTUP_TIMEOUT: '4', STARTUP_POLL_INTERVAL: '1', ...extra }),
    timeoutMs: 120_000,
  });
}

export async function checkUpdateBuildFailure(): Promise<string[]> {
  const v: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p01-update-'));
  try {
    const app = makeGitApp(root);
    fs.writeFileSync(path.join(app, '.env'), 'NODE_ENV=production\nPORT=1\n');
    const r = await runUpdate(app, fakeBin(root), { FAKE_BUILD_FAIL: '1' });
    if (r.code === 0) v.push('update.sh reported success after a failed build');
    const server = path.join(app, 'dist', 'server.cjs');
    if (!fs.existsSync(server) || fs.readFileSync(server, 'utf8') !== 'previous build') v.push('dist/server.cjs of the previous build is gone after the failed build');
    if ((r.output.match(/Rollback:/g) ?? []).length !== 1) v.push(`rollback steps printed ${(r.output.match(/Rollback:/g) ?? []).length} times, expected once`);
    if (!r.output.includes('erases every change made after it')) v.push('the rollback steps do not warn that restoring the backup erases later changes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return v;
}

export async function checkUpdatePortFromEnv(): Promise<string[]> {
  const v: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p01-port-'));
  const server = await startupServer('9.9.2');
  try {
    const app = makeGitApp(root);
    // install.sh writes only PORT=<APP_PORT> into .env
    fs.writeFileSync(path.join(app, '.env'), `NODE_ENV=production\nPORT=${server.port}\n`);
    const r = await runUpdate(app, fakeBin(root), {});
    if (r.code !== 0 || !r.output.includes('Update finished successfully')) v.push(`update.sh did not verify startup on PORT ${server.port} (exit ${r.code}): ${r.output.slice(-300)}`);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return v;
}

export async function runDeploySafetyChecks(): Promise<RecoveryCheckOutcome[]> {
  const outcome = (violations: string[][]): RecoveryCheckOutcome[] =>
    NAMES.map(([id, name, info], i) => ({ id, name, info, violations: violations[i] ?? ['not run'] }));
  const results: string[][] = [];
  const missing = await clientToolsMissing();
  if (missing) {
    results.push([missing], [missing]);
  } else {
    const cluster = await createScratchCluster('p01');
    try {
      const populate = await runCommand(tsx, ['src/tests/recovery/populateRestoreSource.ts'], {
        env: { ...process.env, DATABASE_URL: cluster.appUrl, ERP_TEST_SCHEMA_ISOLATION: '0', K_SIM_STEPS: '30' },
      });
      if (populate.code !== 0) {
        const msg = `scratch database could not be populated: ${populate.output.slice(-300)}`;
        results.push([msg], [msg]);
      } else {
        results.push(await checkCleanupScript(cluster));
        results.push(await checkBackupPrivate(cluster));
      }
    } finally {
      await cluster.teardown();
    }
  }
  results.push(await checkUpdateBuildFailure());
  results.push(await checkUpdatePortFromEnv());
  return outcome(results);
}
