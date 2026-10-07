import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import type { RecoveryCheckOutcome } from './backupRestoreChecks.js';
import { fakeBin, makeGitApp, runUpdate, startupServer } from './deploySafetyChecks.js';
import { adminUrl, clientToolsMissing, createScratchCluster, makeAppDir, querySql, REPO_ROOT, runCommand, scriptEnv, urlFor, type ScratchCluster } from './scratchDatabase.js';

/**
 * Package 1, PR «ح»: operations tooling, proven by running the real scripts.
 * - TD-603: the rollback steps of update.sh keep the checkout on its branch.
 * - TD-605: update.sh and go-live-verify.sh read .env literally and never run it as shell code.
 * - TD-606: a failed backup leaves no partial files; a database before its first migration is backed up.
 * - TD-608: the test runner refuses an unknown suite, a run that matched no test and a production environment
 *   before it writes anything.
 * - TD-615: a bulk transaction gets its longer statement timeout on its own connection.
 */

const NAMES: Array<[string, string, string]> = [
  ['rec_td_603_update_rollback_stays_on_branch',
    'the rollback steps update.sh prints keep the checkout on its branch, so the next update can pull (TD-603)',
    'the printed rollback command left HEAD on master and a later git pull --ff-only succeeded'],
  ['rec_td_605_env_never_executed',
    'update.sh and go-live-verify.sh read .env literally: a value with $, ; or a backtick is neither expanded nor run (TD-605)',
    'update.sh finished and go-live-verify reached its result; no command in .env ran; BACKUP_DIR came from .env'],
  ['rec_td_606_backup_cleans_failed_run',
    'backup.sh backs up a database before its first migration and a failed run leaves no partial files (TD-606)',
    'empty database backed up; a failed compression left no dump, manifest or archive behind'],
  ['rec_td_608_runner_refuses_empty_runs',
    'the test runner fails an unknown suite, a filter that matches no test and a production environment, the last before writing anything (TD-608)',
    'unknown suite exit 1; production refused with no table written; unmatched filter exit 1 with "No test ran"'],
  ['rec_td_615_long_statement_timeout',
    'a bulk transaction runs with the 5-minute statement timeout on its own connection, and the item import uses it (TD-615)',
    'statement_timeout 5min inside the transaction and back to the pool value after it; the import extends it'],
];

const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---------- TD-603 ----------
export async function checkUpdateRollbackStaysOnBranch(): Promise<string[]> {
  const v: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p01-rollback-'));
  try {
    const app = makeGitApp(root);
    fs.writeFileSync(path.join(app, '.env'), 'NODE_ENV=production\nPORT=1\n');
    const r = await runUpdate(app, fakeBin(root), { FAKE_BUILD_FAIL: '1' });
    const step = /2\) (git [^&\n]+?)\s*&&/.exec(r.output)?.[1];
    if (!step) return [`no git rollback step printed: ${r.output.slice(-300)}`];
    const run = await runCommand('bash', ['-c', step], { cwd: app });
    if (run.code !== 0) v.push(`the rollback step "${step}" failed: ${run.output.slice(-200)}`);
    if (!gitOk(app, ['symbolic-ref', '-q', 'HEAD'])) v.push(`after "${step}" HEAD is detached`);
    const pull = await runCommand('git', ['pull', '--ff-only'], { cwd: app });
    if (pull.code !== 0) v.push(`git pull --ff-only after the rollback failed: ${pull.output.trim().slice(-200)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return v;
}

// ---------- TD-605 ----------
export async function checkEnvNeverExecuted(): Promise<string[]> {
  const v: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p01-env-'));
  const server = await startupServer('9.9.2');
  try {
    const app = makeGitApp(root);
    const backups = path.join(root, 'backups');
    const markers = ['semicolon', 'subshell', 'backtick'].map(m => path.join(root, `marker_${m}`));
    const env = [
      'NODE_ENV=production',
      `PORT=${server.port}`,
      `EVIL_SEMICOLON=x;touch ${markers[0]}`,
      `EVIL_SUBSHELL=$(touch ${markers[1]})`,
      `EVIL_BACKTICK=\`touch ${markers[2]}\``,
      'JWT_SECRET=S3cr$et9-and-more-characters-to-pass-32',
      `BACKUP_DIR=${backups}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(app, '.env'), env);
    // the backup step only reports the BACKUP_DIR update.sh hands it (the real backup has its own tests)
    fs.writeFileSync(path.join(app, 'scripts', 'backup.sh'), '#!/bin/bash\necho "BACKUP_DIR_SEEN=${BACKUP_DIR:-unset}"\n', { mode: 0o755 });

    const update = await runUpdate(app, fakeBin(root), {}, []);
    if (update.code !== 0 || !update.output.includes('Update finished successfully')) v.push(`update.sh failed on this .env (exit ${update.code}): ${update.output.slice(-300)}`);
    if (!update.output.includes(`BACKUP_DIR_SEEN=${backups}`)) v.push('update.sh did not pass BACKUP_DIR from .env to the backup');

    fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'go-live-verify.sh'), path.join(app, 'scripts', 'go-live-verify.sh'));
    const verify = await runCommand('bash', [path.join(app, 'scripts', 'go-live-verify.sh'), 'http://127.0.0.1:9'],
      { cwd: app, env: scriptEnv({ APP_DIR: app }), timeoutMs: 120_000 });
    if (!verify.output.includes('RESULT:')) v.push(`go-live-verify stopped before its result: ${verify.output.slice(-300)}`);
    if (!verify.output.includes('[PASS] JWT_SECRET present')) v.push('go-live-verify did not read JWT_SECRET literally');

    const ran = markers.filter(m => fs.existsSync(m)).map(m => path.basename(m));
    if (ran.length > 0) v.push(`commands in .env were run: ${ran.join(', ')}`);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return v;
}

// ---------- TD-606 ----------
async function emptyDatabase(cluster: ScratchCluster, suffix: string): Promise<string> {
  const name = `${cluster.database}_${suffix}`;
  await querySql(adminUrl(), `CREATE DATABASE "${name}" OWNER "${cluster.role}"`);
  cluster.created.push(name);
  return name;
}

export async function checkBackupCleansFailedRun(cluster: ScratchCluster): Promise<string[]> {
  const v: string[] = [];
  const appDir = makeAppDir(path.join(cluster.tmpDir, 'p01-backup-clean'));
  const db = await emptyDatabase(cluster, 'empty');
  fs.writeFileSync(path.join(appDir, '.env'), `NODE_ENV=production\nDATABASE_URL="${urlFor(cluster.role, cluster.password, db)}"\n`);
  const leftovers = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  const emptyDir = path.join(cluster.tmpDir, 'p01-backups-empty');
  const empty = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')], { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: emptyDir }) });
  if (empty.code !== 0) v.push(`backup of a database before its first migration failed (exit ${empty.code}): ${empty.output.slice(-200)}`);
  const orphans = leftovers(emptyDir).filter(f => f.endsWith('.dump'));
  if (orphans.length > 0) v.push(`uncompressed dump left behind: ${orphans.join(', ')}`);

  // compressing the dump fails (disk full, for example); gzip through tar or a pipe still works
  const bin = path.join(cluster.tmpDir, 'p01-bin');
  fs.mkdirSync(bin, { recursive: true });
  const realGzip = execFileSync('bash', ['-c', 'command -v gzip'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(bin, 'gzip'), `#!/bin/bash\nif [ $# -eq 1 ] && [ -f "$1" ]; then echo "gzip: no space left on device" >&2; exit 1; fi\nexec "${realGzip}" "$@"\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(appDir, 'public', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'public', 'uploads', 'logo.png'), 'png');
  const failDir = path.join(cluster.tmpDir, 'p01-backups-fail');
  const failed = await runCommand('bash', [path.join(appDir, 'scripts', 'backup.sh')],
    { cwd: cluster.tmpDir, env: scriptEnv({ BACKUP_DIR: failDir, PATH: `${bin}:${process.env.PATH ?? ''}` }) });
  if (failed.code === 0) v.push('backup.sh reported success although the dump could not be compressed');
  const partial = leftovers(failDir);
  if (partial.length > 0) v.push(`a failed backup left files behind: ${partial.join(', ')}`);
  return v;
}

// ---------- TD-608 ----------
async function tableCount(url: string): Promise<number> {
  const rows = await querySql<{ n: string }>(url, `SELECT count(*)::text AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
  return Number(rows[0]?.n ?? 0);
}

export async function checkRunnerRefusesEmptyRuns(cluster: ScratchCluster): Promise<string[]> {
  const v: string[] = [];
  const db = await emptyDatabase(cluster, 'runner');
  const url = urlFor(cluster.role, cluster.password, db);
  const runner = (args: string[], extra: Record<string, string>) => runCommand(tsx, ['scripts/run-tests.ts', ...args], {
    env: { ...process.env, DATABASE_URL: url, ERP_TEST_SCHEMA_ISOLATION: '0', ERP_ALLOW_TEST_CLEANUP: '0', ...extra }, timeoutMs: 300_000,
  });

  const unknown = await runner(['--suite', 'no_such_suite'], { NODE_ENV: 'test' });
  if (unknown.code === 0) v.push('an unknown suite exited 0');

  const production = await runner(['--suite', 'unit'], { NODE_ENV: 'production' });
  if (production.code === 0) v.push('a run with NODE_ENV=production exited 0');
  if (!production.output.includes('Test runner can only run in test/development environment')) v.push(`the production run did not name the environment rule: ${production.output.slice(-200)}`);
  const written = await tableCount(url);
  if (written > 0) v.push(`the refused production run wrote ${written} table(s) first`);

  const unmatched = await runner(['--suite', 'unit', '--filter', 'zz_no_such_test_p01'], { NODE_ENV: 'test' });
  if (unmatched.code === 0) v.push('a filter that matched no test exited 0');
  if (!unmatched.output.includes('No test ran')) v.push('a filter that matched no test did not say "No test ran"');
  return v;
}

// ---------- TD-615 ----------
export async function checkLongStatementTimeout(): Promise<string[]> {
  const v: string[] = [];
  // loaded by name: the function does not exist before TD-615, and a missing named import would stop the whole suite
  const drizzleModule = await import('../../db/drizzle.js') as Record<string, unknown>;
  const extend = drizzleModule.extendStatementTimeout as ((tx: unknown) => Promise<void>) | undefined;
  const show = async (exec: { execute: typeof orm.execute }) => String((await exec.execute(sql`SHOW statement_timeout`)).rows[0]?.statement_timeout ?? '');
  const before = await show(orm);
  if (typeof extend !== 'function') {
    v.push('src/db/drizzle.ts exports no extendStatementTimeout(tx)');
  } else {
    const inside = await orm.transaction(async tx => {
      await extend(tx);
      return show(tx);
    });
    if (inside !== '5min') v.push(`statement_timeout inside the extended transaction is ${inside}, expected 5min`);
    const after = await show(orm);
    if (after !== before) v.push(`statement_timeout after the transaction is ${after}, expected the pool value ${before}`);
  }
  const importer = fs.readFileSync(path.join(REPO_ROOT, 'src', 'services', 'items', 'itemExcelImport.ts'), 'utf8');
  const importBody = importer.slice(importer.indexOf('export async function importItemsFromExcel'));
  if (!/orm\.transaction\(async \(tx\) => \{\s*(\/\/[^\n]*\n\s*)*await extendStatementTimeout\(tx\)/.test(importBody)) {
    v.push('the item import transaction does not extend its statement timeout first');
  }
  return v;
}

export async function runToolingChecks(): Promise<RecoveryCheckOutcome[]> {
  const results: string[][] = [];
  results.push(await checkUpdateRollbackStaysOnBranch());
  results.push(await checkEnvNeverExecuted());
  const missing = await clientToolsMissing();
  if (missing) {
    results.push([missing], [missing]);
  } else {
    const cluster = await createScratchCluster('p01h');
    try {
      results.push(await checkBackupCleansFailedRun(cluster));
      results.push(await checkRunnerRefusesEmptyRuns(cluster));
    } finally {
      await cluster.teardown();
    }
  }
  results.push(await checkLongStatementTimeout());
  return NAMES.map(([id, name, info], i) => ({ id, name, info, violations: results[i] ?? ['not run'] }));
}
