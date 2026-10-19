import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { cleanup, render } from '@testing-library/react';
import { NightlyVerifyHealthCard } from '../../components/system/NightlyVerifyHealthCard';
import {
  NIGHTLY_VERIFY_FAILURE_MESSAGES, NIGHTLY_VERIFY_MESSAGES, NIGHTLY_VERIFY_REPORT_VERSION, nightlyBaseline, nightlyVerifyVerdict,
  nightlyWorse, parseNightlyReport, type NightlyVerifyReport,
} from '../../lib/system/nightlyVerify';
import { readNightlyVerifyHealth } from '../../services/system/nightlyVerifyHealth';

// v10.2.16 (O-04, 10.2 package 13): every night the latest good daily backup is restored into a drill copy and the
// financial health check and the business invariants run on it; the health page shows the result. Before, nothing
// checked a backup after it was written, and a backup that did not restore or held broken books went unnoticed until
// needed. The shell tests run scripts/nightly-verify.sh in a made-up app directory with stand-ins for restore.sh, tsx
// and psql, so they need no database.

afterEach(cleanup);

const ROOT = path.resolve(__dirname, '../../..');
const NOW = new Date('2026-10-18T05:00:00Z');

const report = (over: Partial<NightlyVerifyReport> = {}): NightlyVerifyReport => ({
  version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: '2026-10-18T04:02:00Z', backupFile: 'erp_daily_20261018_023000.dump.gz',
  backupAt: '2026-10-18T02:31:00Z', restoreOk: true, failure: null,
  health: [{ id: 'voucher_balance', status: 'healthy', count: 0 }, { id: 'secrets_at_rest', status: 'warning', count: 1 }],
  invariants: [{ invariant: 'I1_voucher_balanced', count: 2 }],
  worse: [], errors: [], baseline: null, ...over,
});

describe('nightly_verify_o_04: the nightly check on a copy of the backup', () => {
  it('compares with the night before: only what got worse counts, old findings do not', () => {
    const previous = report();
    expect(nightlyWorse(previous, report())).toEqual([]);
    expect(nightlyWorse(previous, report({
      health: [{ id: 'voucher_balance', status: 'error', count: 1 }, { id: 'secrets_at_rest', status: 'warning', count: 2 }],
      invariants: [{ invariant: 'I1_voucher_balanced', count: 3 }, { invariant: 'I2_three_way_stock', count: 1 }],
    }))).toEqual(['health:voucher_balance', 'health:secrets_at_rest', 'invariant:I1_voucher_balanced', 'invariant:I2_three_way_stock']);
    // fewer findings, or no previous night, is never worse
    expect(nightlyWorse(previous, report({ invariants: [] }))).toEqual([]);
    expect(nightlyWorse(null, report({ invariants: [{ invariant: 'I1_voucher_balanced', count: 9 }] }))).toEqual([]);
  });

  it('a bad night is compared with the last healthy night again, never becoming the new yardstick', () => {
    const healthy = report();
    const bad = report({
      finishedAt: '2026-10-19T04:02:00Z', invariants: [{ invariant: 'I1_voucher_balanced', count: 5 }],
      worse: ['invariant:I1_voucher_balanced'], baseline: nightlyBaseline(healthy),
    });
    expect(bad.baseline).toMatchObject({ finishedAt: healthy.finishedAt, invariants: healthy.invariants });
    // the next night still has 5: it is worse than the healthy night, not equal to the bad one
    const next = nightlyBaseline(bad);
    expect(next).toEqual(bad.baseline);
    expect(nightlyWorse(next, report({ invariants: [{ invariant: 'I1_voucher_balanced', count: 5 }] }))).toEqual(['invariant:I1_voucher_balanced']);
    // a failed night keeps the baseline too, and a healthy night after it becomes the new one
    expect(nightlyBaseline(report({ failure: 'no_space', restoreOk: false, health: null, invariants: null, baseline: bad.baseline }))).toEqual(bad.baseline);
    expect(nightlyBaseline(report({ finishedAt: '2026-10-20T04:02:00Z', baseline: bad.baseline }))?.finishedAt).toBe('2026-10-20T04:02:00Z');
    expect(nightlyBaseline(null)).toBeNull();
  });

  it('the card status: ok, worse, failed restore, a check that did not run, stale and never', () => {
    expect(nightlyVerifyVerdict(report(), NOW)).toMatchObject({ status: 'ok', healthErrorCount: 0, healthWarningCount: 1, invariantViolationCount: 2 });
    expect(nightlyVerifyVerdict(report({ worse: ['health:voucher_balance'] }), NOW).status).toBe('warning');
    expect(nightlyVerifyVerdict(report({ restoreOk: false, health: null, invariants: null }), NOW)).toMatchObject({
      status: 'failed', messages: [NIGHTLY_VERIFY_MESSAGES.restoreFailed],
    });
    expect(nightlyVerifyVerdict(report({ invariants: null }), NOW).status).toBe('failed');
    expect(nightlyVerifyVerdict(report({ finishedAt: '2026-10-16T04:02:00Z' }), NOW).status).toBe('stale');
    expect(nightlyVerifyVerdict(null, NOW)).toMatchObject({ status: 'never', messages: [NIGHTLY_VERIFY_MESSAGES.never] });
    // a night that could not be checked says why; an old failed night stays failed, with the stale note added
    expect(nightlyVerifyVerdict(report({ failure: 'no_space', restoreOk: false, health: null, invariants: null }), NOW)).toMatchObject({
      status: 'failed', failure: 'no_space', messages: [NIGHTLY_VERIFY_FAILURE_MESSAGES.no_space],
    });
    expect(nightlyVerifyVerdict(report({ restoreOk: false, failure: 'restore', finishedAt: '2026-10-16T04:02:00Z' }), NOW)).toMatchObject({
      status: 'failed', messages: [NIGHTLY_VERIFY_MESSAGES.stale, NIGHTLY_VERIFY_MESSAGES.restoreFailed],
    });
  });

  it('reads only a report of its own shape', () => {
    expect(parseNightlyReport(JSON.stringify(report()))).toEqual(report());
    expect(parseNightlyReport('not json')).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), version: 99 }))).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), health: [{ id: 'x', status: 'bad', count: 1 }] }))).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), failure: 'flood' }))).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), baseline: { finishedAt: 'x' } }))).toBeNull();
  });

  it('the health page reads the report file: missing is «not run yet», unreadable is unknown, never ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-'));
    const file = path.join(dir, 'nightly-verify.json');
    const saved = process.env.NIGHTLY_VERIFY_REPORT;
    process.env.NIGHTLY_VERIFY_REPORT = file;
    try {
      expect(readNightlyVerifyHealth(NOW).status).toBe('never');
      fs.writeFileSync(file, '{"version":1');
      expect(readNightlyVerifyHealth(NOW).status).toBe('unknown');
      fs.writeFileSync(file, JSON.stringify(report()));
      expect(readNightlyVerifyHealth(NOW).status).toBe('ok');
    } finally {
      if (saved === undefined) delete process.env.NIGHTLY_VERIFY_REPORT; else process.env.NIGHTLY_VERIFY_REPORT = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the card says it in Persian with Persian digits', () => {
    const { container, getByTestId } = render(<NightlyVerifyHealthCard nightly={nightlyVerifyVerdict(report({ worse: ['health:voucher_balance'] }), NOW)} />);
    expect(getByTestId('nightly-verify-health').dataset.status).toBe('warning');
    const copy = container.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-technical]').forEach(el => el.remove());
    const text = copy.textContent ?? '';
    expect(text).toContain('بررسی شبانهٔ پشتیبان');
    expect(text).toContain('۱ بررسی نسبت به آخرین شب سالم بدتر شده است');
    expect(text).toContain('عمر پشتیبان هنگام بررسی');
    expect(text).toContain('۱ ساعت');
    expect(text).not.toContain('دیشب');
    expect(text).not.toMatch(/[A-Za-z0-9]/);
  });

  it('a night that could not be checked is written as a failed report (no database needed), keeping the baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-'));
    const file = path.join(dir, 'nightly-verify.json');
    fs.writeFileSync(file, JSON.stringify(report()));
    const run = spawnSync(path.join(ROOT, 'node_modules/.bin/tsx'),
      ['scripts/nightly-verify.ts', '--report', file, '--backup', '/var/backups/erp/erp_daily_x.dump.gz', '--backup-at', '1792200000',
        '--failed', 'no_space', '--detail', '/ needs 9 bytes'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_DIR: dir } });
    expect(run.status, run.stderr).toBe(1);
    const written = parseNightlyReport(fs.readFileSync(file, 'utf8'));
    expect(written).toMatchObject({
      restoreOk: false, failure: 'no_space', health: null, invariants: null, backupFile: 'erp_daily_x.dump.gz',
      backupAt: new Date(1792200000 * 1000).toISOString(), baseline: { finishedAt: report().finishedAt },
    });
    expect(written?.errors.join(' ')).toContain('/ needs 9 bytes');
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('644');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('install-ops-cron.sh schedules it every night at 04:00 as root, after the backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-cron-'));
    const cronFile = path.join(dir, 'papital-erp');
    const run = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), os.userInfo().username], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: cronFile, APP_DIR: ROOT },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(cronFile, 'utf8')).toContain(`0 4 * * * root ${ROOT}/scripts/nightly-verify.sh >> ${ROOT}/logs/nightly-verify.log 2>&1`);
    const bad = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), os.userInfo().username], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: path.join(dir, 'other'), APP_DIR: ROOT, NIGHTLY_VERIFY_HOUR: '25' },
    });
    expect(bad.status).toBe(1);
    expect(run.stdout).toContain('default times are written');
    expect(run.stdout).toContain('nightly backup check at 04:00');
    const cron = (env: Record<string, string>) => spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), os.userInfo().username], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: path.join(dir, 'times'), APP_DIR: ROOT, ...env },
    });
    // 08 and 09 are decimal hours
    const nine = cron({ BACKUP_HOUR: '08', BACKUP_MINUTE: '09', NIGHTLY_VERIFY_HOUR: '09', NIGHTLY_VERIFY_MINUTE: '09' });
    expect(nine.status, nine.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'times'), 'utf8')).toContain(`9 9 * * * root ${ROOT}/scripts/nightly-verify.sh`);
    expect(nine.stdout).not.toContain('default times are written');
    // the check never starts within 60 minutes after the backup, nor at the same time (across midnight too)
    expect(cron({ NIGHTLY_VERIFY_HOUR: '2', NIGHTLY_VERIFY_MINUTE: '30' }).status).toBe(1);
    expect(cron({ NIGHTLY_VERIFY_HOUR: '3', NIGHTLY_VERIFY_MINUTE: '15' }).status).toBe(1);
    expect(cron({ BACKUP_HOUR: '23', BACKUP_MINUTE: '30', NIGHTLY_VERIFY_HOUR: '0', NIGHTLY_VERIFY_MINUTE: '15' }).status).toBe(1);
    expect(cron({ NIGHTLY_VERIFY_HOUR: '3', NIGHTLY_VERIFY_MINUTE: '30' }).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('nightly_verify_o_04 review: the shell script cleans up, checks room and keeps passwords off the command line', () => {
  const PASSWORD = 's3cr:et';
  const DB_URL = `postgresql://app:${encodeURIComponent(PASSWORD)}@localhost:5432/erp`;
  const DRILL = 'erp_restore_drill_20261019_040001';

  /** A made-up app directory: the real script, stand-ins for restore.sh, tsx and psql (the calls go to calls.log) */
  function fakeApp(over: { markerAgeHours?: number | null } = {}) {
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
esac`);
    stub(path.join(app, 'node_modules/.bin/tsx'), `echo "tsx $* URL=$DATABASE_URL" >> "${calls}"; exit \${FAKE_CHECK_RC:-0}`);
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
    const env = {
      ...process.env, APP_DIR: app, BACKUP_DIR: backups, DATABASE_URL: DB_URL, PATH: `${bin}:${process.env.PATH}`,
      NIGHTLY_VERIFY_BUSY_PATTERN: 'no-such-process-o04-x9', RESTORE_ADMIN_URL: '',
    };
    const log = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '');
    return { dir, app, backups, env, log, script: path.join(app, 'scripts/nightly-verify.sh') };
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
    expect(log).toContain('PASSFILE=localhost:5432:*:app:s3cr\\:et');
    for (const line of log.split('\n').filter(l => l.startsWith('psql') || l.startsWith('restore'))) {
      expect(line.replace(/PASSFILE=.*/, '')).not.toContain('s3cr');
    }
    const check = log.split('\n').find(l => l.includes('--backup-at')) ?? '';
    expect(check.split(' URL=')[0]).not.toContain('s3cr');
    expect(check.split(' URL=')[1]).toBe(`postgresql://app:${encodeURIComponent(PASSWORD)}@localhost:5432/${DRILL}`);
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

  it('a run killed while restoring drops the copy it created on its way out', async () => {
    const f = fakeApp();
    const { spawn } = await import('child_process');
    const child = spawn('bash', [f.script], { env: { ...f.env, FAKE_RESTORE: 'hang', NIGHTLY_VERIFY_TIMEOUT: '3' } });
    await new Promise(resolve => setTimeout(resolve, 1500));
    child.kill('SIGTERM');
    const code = await new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));
    expect(code).not.toBe(0);
    expect(f.log()).toContain(`DROP DATABASE IF EXISTS "${DRILL}"`);
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
