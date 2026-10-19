import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { NIGHTLY_VERIFY_REPORT_VERSION, type NightlyVerifyReport } from '../../lib/system/nightlyVerify';

// v10.2.16 (O-04, 10.2 package 13), review fixes: scripts/nightly-verify.sh runs in a made-up app directory with
// stand-ins for restore.sh, tsx, psql and df, so these tests need no database (see nightlyVerifyO04.test.tsx).

const ROOT = path.resolve(__dirname, '../../..');

const report = (over: Partial<NightlyVerifyReport> = {}): NightlyVerifyReport => ({
  version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: '2026-10-18T04:02:00Z', backupFile: 'erp_daily_20261018_023000.dump.gz',
  backupAt: '2026-10-18T02:31:00Z', restoreOk: true, failure: null,
  health: [{ id: 'voucher_balance', status: 'healthy', count: 0 }], invariants: [{ invariant: 'I1_voucher_balanced', count: 0 }],
  worse: [], repeatNights: 0, acceptedWorse: [], newChecks: [], errors: [], baseline: null, ...over,
});

describe('nightly_verify_o_04 review: the shell script cleans up, checks room and keeps passwords off the command line', () => {
  // a raw + and an encoded backslash: libpq keeps the + and reads %5C as a backslash (\\c must not cut it short)
  const PASSWORD = 's3cr:et+1\\c';
  const URL_PASSWORD = 's3cr%3Aet+1%5Cc';
  const DB_URL = `postgresql://app:${URL_PASSWORD}@localhost:5432/erp`;
  const DRILL = 'erp_restore_drill_20261019_040001';

  /** A made-up app directory: the real script, stand-ins for restore.sh, tsx and psql (the calls go to calls.log) */
  function fakeApp(over: { markerAgeHours?: number | null; previousReport?: object } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-sh-'));
    const app = path.join(dir, 'app');
    const backups = path.join(dir, 'backups');
    const bin = path.join(dir, 'bin');
    const data = path.join(dir, 'pgdata');
    for (const d of [path.join(app, 'scripts'), path.join(app, 'node_modules/.bin'), path.join(app, 'logs'), backups, bin, data]) fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/nightly-verify.sh'), path.join(app, 'scripts/nightly-verify.sh'));
    const calls = path.join(dir, 'calls.log');
    const stub = (file: string, body: string) => fs.writeFileSync(file, `#!/bin/bash
${body}
`, { mode: 0o755 });
    stub(path.join(app, 'scripts/restore.sh'), `echo "restore DATABASE_URL=$DATABASE_URL" >> "${calls}"
echo "Creating database ${DRILL} (owner app)"
case "\${FAKE_RESTORE:-ok}" in
  ok) echo "Drill database kept for inspection: ${DRILL}"; exit 0 ;;
  fail) echo "ERROR: restore FAILED"; exit 1 ;;
  hang) sleep 30 ;;
  full) echo "pg_restore: error: could not extend file: No space left on device"; exit 1 ;;
esac`);
    stub(path.join(app, 'node_modules/.bin/tsx'), `echo "tsx $* URL=$DATABASE_URL TMPDIR=\${TMPDIR:-}" >> "${calls}"; exit \${FAKE_CHECK_RC:-0}`);
    // a disk of 1 TB with 900 GB free, whatever the host has
    stub(path.join(bin, 'df'), `echo "Filesystem 1-blocks Used Available Capacity Mounted on"
echo "fake 1000000000000 100000000000 900000000000 10% /"`);
    stub(path.join(bin, 'psql'), `echo "psql $* PASSFILE=$(cat "$PGPASSFILE" 2>/dev/null | tr '\n' ' ')" >> "${calls}"
case "$*" in
  *pg_database_size*) echo "\${FAKE_DB_BYTES:-1000}" ;;
  *data_directory*) echo "${data}" ;;
  *"SELECT datname"*) printf '%s\n' erp_restore_drill_20200101_000000 "erp_restore_drill_$(date +%Y%m%d_%H%M%S)" erp_live ;;
esac
exit 0`);
    const stamp = '20261019_023000';
    fs.writeFileSync(path.join(backups, `erp_daily_${stamp}.dump.gz`), gzipSync('a stand-in dump\n'));
    if (over.markerAgeHours !== null) {
      const at = Math.floor(Date.now() / 1000) - (over.markerAgeHours ?? 1) * 3600;
      fs.writeFileSync(path.join(backups, '.last_daily_ok'), `${at} erp_daily_${stamp}\n`);
    }
    if (over.previousReport) fs.writeFileSync(path.join(app, 'logs/nightly-verify.json'), JSON.stringify(over.previousReport));
    const env = {
      ...process.env, APP_DIR: app, BACKUP_DIR: backups, DATABASE_URL: DB_URL, PATH: `${bin}:${process.env.PATH}`,
      NIGHTLY_VERIFY_BUSY_PATTERN: 'no-such-process-o04-x9', RESTORE_ADMIN_URL: '',
    };
    const log = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '');
    return { dir, app, backups, env, log, stamp, script: path.join(app, 'scripts/nightly-verify.sh') };
  }

  it('a good night: the drill copy is dropped, the password is only in the environment, temp files go to the backup disk', () => {
    const f = fakeApp();
    const run = spawnSync('bash', [f.script], { encoding: 'utf8', env: f.env });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const log = f.log();
    expect(log).toContain(`DROP DATABASE IF EXISTS "${DRILL}" WITH (FORCE)`);
    expect(log).toContain('DROP DATABASE IF EXISTS "erp_restore_drill_20200101_000000"');
    // a young drill copy (an upgrade rehearsal's) and any other database are never dropped
    expect(log.match(/DROP DATABASE/g)?.length).toBe(2);
    const escaped = PASSWORD.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    expect(log).toContain(`PASSFILE=localhost:5432:*:app:${escaped} `);
    for (const line of log.split('\n').filter(l => l.startsWith('psql') || l.startsWith('restore'))) {
      expect(line.replace(/PASSFILE=.*/, '')).not.toContain('s3cr');
    }
    const check = log.split('\n').find(l => l.includes('--backup-at')) ?? '';
    expect(check.split(' URL=')[0]).not.toContain('s3cr');
    expect(check.split(' URL=')[1]).toBe(`postgresql://app:${URL_PASSWORD}@localhost:5432/${DRILL} TMPDIR=`);
    expect(fs.existsSync(path.join(f.backups, '.nightly-verify-tmp'))).toBe(true);
    expect(fs.readdirSync(path.join(f.backups, '.nightly-verify-tmp'))).toEqual([]);
    fs.rmSync(f.dir, { recursive: true, force: true });
  }, 30_000);

  it('a restore that fails or runs out of time still drops the copy it created and writes the reason', () => {
    const failed = fakeApp();
    const run = spawnSync('bash', [failed.script], { encoding: 'utf8', env: { ...failed.env, FAKE_RESTORE: 'fail' } });
    expect(run.status).toBe(1);
    expect(failed.log()).toContain('--failed restore');
    expect(failed.log()).toContain(`DROP DATABASE IF EXISTS "${DRILL}"`);
    fs.rmSync(failed.dir, { recursive: true, force: true });

    const slow = fakeApp();
    const late = spawnSync('bash', [slow.script], { encoding: 'utf8', env: { ...slow.env, FAKE_RESTORE: 'hang', NIGHTLY_VERIFY_TIMEOUT: '2' } });
    expect(late.status).toBe(1);
    expect(slow.log()).toContain('--failed timeout');
    expect(slow.log()).toContain(`DROP DATABASE IF EXISTS "${DRILL}"`);
    fs.rmSync(slow.dir, { recursive: true, force: true });
  }, 30_000);

  it('a run stopped while restoring stops the restore at once and drops the copy it created', async () => {
    const f = fakeApp();
    const { spawn } = await import('child_process');
    const child = spawn('bash', [f.script], { env: { ...f.env, FAKE_RESTORE: 'hang', NIGHTLY_VERIFY_TIMEOUT: '600' } });
    const exited = new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));
    await new Promise(resolve => setTimeout(resolve, 1500));
    const stoppedAt = Date.now();
    child.kill('SIGTERM');
    const code = await exited;
    expect(code).not.toBe(0);
    // the restore (30 seconds of sleep here) is not waited for
    expect(Date.now() - stoppedAt).toBeLessThan(10_000);
    expect(f.log()).toContain(`DROP DATABASE IF EXISTS "${DRILL}"`);
    fs.rmSync(f.dir, { recursive: true, force: true });
  }, 30_000);

  it('a full disk during the restore is no room, not a bad backup; the same dump as the night before is no new backup', () => {
    const full = fakeApp();
    expect(spawnSync('bash', [full.script], { encoding: 'utf8', env: { ...full.env, FAKE_RESTORE: 'full' } }).status).toBe(1);
    expect(full.log()).toContain('--failed no_space');
    fs.rmSync(full.dir, { recursive: true, force: true });

    const lastNight = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const again = fakeApp({ markerAgeHours: 25, previousReport: report({ finishedAt: lastNight, backupFile: 'erp_daily_20261019_023000.dump.gz' }) });
    expect(spawnSync('bash', [again.script], { encoding: 'utf8', env: again.env }).status).toBe(1);
    expect(again.log()).toContain('--failed no_new_backup');
    expect(again.log()).not.toContain('restore DATABASE_URL');
    fs.rmSync(again.dir, { recursive: true, force: true });

    // a second run the same morning checks the same dump again
    const sameMorning = fakeApp({ previousReport: report({ finishedAt: new Date().toISOString(), backupFile: 'erp_daily_20261019_023000.dump.gz' }) });
    expect(spawnSync('bash', [sameMorning.script], { encoding: 'utf8', env: sameMorning.env }).status).toBe(0);
    fs.rmSync(sameMorning.dir, { recursive: true, force: true });
  }, 30_000);

  it('settings come from .env too, since cron gives no environment', () => {
    const f = fakeApp({ markerAgeHours: 30 });
    fs.writeFileSync(path.join(f.app, '.env'), 'NIGHTLY_VERIFY_MAX_DUMP_AGE_HOURS=48\n');
    const run = spawnSync('bash', [f.script], { encoding: 'utf8', env: f.env });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(f.log()).not.toContain('stale_dump');
    fs.rmSync(f.dir, { recursive: true, force: true });
  }, 30_000);

  it('an IPv6 address is written to the password file without its brackets', () => {
    const f = fakeApp();
    const run = spawnSync('bash', [f.script], { encoding: 'utf8', env: { ...f.env, DATABASE_URL: `postgresql://app:${URL_PASSWORD}@[::1]:5433/erp` } });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(f.log()).toContain('PASSFILE=\\:\\:1:5433:*:app:');
    fs.rmSync(f.dir, { recursive: true, force: true });
  }, 30_000);

  it('no finished backup, an old backup or too little room is a failed night that restores nothing', () => {
    const none = fakeApp({ markerAgeHours: null });
    expect(spawnSync('bash', [none.script], { encoding: 'utf8', env: none.env }).status).toBe(1);
    expect(none.log()).toContain('--failed no_dump');
    fs.rmSync(none.dir, { recursive: true, force: true });

    const old = fakeApp({ markerAgeHours: 30 });
    expect(spawnSync('bash', [old.script], { encoding: 'utf8', env: old.env }).status).toBe(1);
    expect(old.log()).toContain('--failed stale_dump');
    fs.rmSync(old.dir, { recursive: true, force: true });

    const full = fakeApp();
    expect(spawnSync('bash', [full.script], { encoding: 'utf8', env: { ...full.env, FAKE_DB_BYTES: '999999999999999999' } }).status).toBe(1);
    expect(full.log()).toContain('--failed no_space');
    for (const f of [none, old, full]) expect(f.log()).not.toContain('restore DATABASE_URL');
    fs.rmSync(full.dir, { recursive: true, force: true });
  }, 30_000);

  it('a night is skipped while a backup, a rehearsal, an update or a restore runs', () => {
    const f = fakeApp();
    const run = spawnSync('bash', [f.script], { encoding: 'utf8', env: { ...f.env, NIGHTLY_VERIFY_BUSY_PATTERN: 'nightly-verify\\.sh' } });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('SKIPPED');
    expect(f.log()).toBe('');
    fs.rmSync(f.dir, { recursive: true, force: true });
    const script = fs.readFileSync(path.join(ROOT, 'scripts/nightly-verify.sh'), 'utf8');
    expect(script).toContain('scripts/(backup|upgrade-rehearsal|restore)\\.sh( |$)|(^|[ /])update\\.sh( |$)');
  }, 30_000);
});
