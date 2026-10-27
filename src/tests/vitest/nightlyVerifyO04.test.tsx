import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanup, render } from '@testing-library/react';
import { NightlyVerifyHealthCard } from '../../components/system/NightlyVerifyHealthCard';
import {
  NIGHTLY_VERIFY_FAILURE_MESSAGES, NIGHTLY_VERIFY_MESSAGES, NIGHTLY_VERIFY_REPORT_VERSION, acceptedMessage, nightlyBaseline,
  nightlyCarriedAccepted, newChecksMessage, nightlyNewChecks, nightlyRepeat, nightlyVerifyVerdict, nightlyWorse, parseNightlyReport, type NightlyVerifyReport,
} from '../../lib/system/nightlyVerify';
import { readNightlyVerifyHealth } from '../../services/system/nightlyVerifyHealth';

// v10.2.16 (O-04, 10.2 package 13): every night the latest good daily backup is restored into a drill copy and the
// financial health check and the business invariants run on it; the health page shows the result. Before, nothing
// checked a backup after it was written, and a backup that did not restore or held broken books went unnoticed until
// needed. The shell tests run scripts/nightly-verify.sh in a made-up app directory with stand-ins for restore.sh, tsx
// and psql, so they need no database. There is no case for the database test runner: the script needs root or
// `sudo -u postgres` to create the drill database, and its database steps are restore.sh (covered by the backup and
// restore tests) and the read-only health check and invariants.

afterEach(cleanup);

const ROOT = path.resolve(__dirname, '../../..');
const NOW = new Date('2026-10-18T05:00:00Z');

const report = (over: Partial<NightlyVerifyReport> = {}): NightlyVerifyReport => ({
  version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: '2026-10-18T04:02:00Z', backupFile: 'erp_daily_20261018_023000.dump.gz',
  backupAt: '2026-10-18T02:31:00Z', restoreOk: true, failure: null,
  health: [{ id: 'voucher_balance', status: 'healthy', count: 0 }, { id: 'secrets_at_rest', status: 'warning', count: 1 }],
  invariants: [{ invariant: 'I1_voucher_balanced', count: 2 }],
  worse: [], repeatNights: 0, acceptedWorse: [], newChecks: [], errors: [], baseline: null, ...over,
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

  it('a check the baseline does not list is new, not worse; a new invariant violation is worse', () => {
    const tonight = report({ health: [...report().health ?? [], { id: 'added_by_update', status: 'error', count: 4 }] });
    expect(nightlyWorse(report(), tonight)).toEqual([]);
    expect(nightlyNewChecks(report(), tonight)).toEqual(['added_by_update']);
    expect(nightlyWorse(report(), report({ invariants: [{ invariant: 'I1_voucher_balanced', count: 2 }, { invariant: 'I9_cheque', count: 1 }] })))
      .toEqual(['invariant:I9_cheque']);
  });

  it('the same worse counts night after night are counted, and accepted after three nights', () => {
    const worse = { invariants: [{ invariant: 'I1_voucher_balanced', count: 5 }], worse: ['invariant:I1_voucher_balanced'] };
    const nextBackup = { ...worse, backupFile: 'erp_daily_20261019_023000.dump.gz' };
    expect(nightlyRepeat(null, report(worse))).toBe(1);
    expect(nightlyRepeat(report({ ...worse, repeatNights: 1 }), report(nextBackup))).toBe(2);
    // other counts start again, and nothing worse is 0
    expect(nightlyRepeat(report({ ...worse, repeatNights: 2 }), report({ ...nextBackup, invariants: [{ invariant: 'I1_voucher_balanced', count: 6 }] }))).toBe(1);
    expect(nightlyRepeat(report({ ...worse, repeatNights: 2 }), report())).toBe(0);
    // the night it is accepted is ok, says so, and is the next yardstick
    const accepted = report({ ...worse, worse: [], acceptedWorse: worse.worse, repeatNights: 3 });
    expect(nightlyVerifyVerdict(accepted, NOW)).toMatchObject({ status: 'ok', messages: [NIGHTLY_VERIFY_MESSAGES.ok, acceptedMessage(1)] });
    expect(nightlyBaseline(accepted)?.invariants).toEqual(worse.invariants);
  });

  it('runs on the same backup file are one night: three of them never reach the auto-accept', () => {
    const worse = { invariants: [{ invariant: 'I1_voucher_balanced', count: 5 }], worse: ['invariant:I1_voucher_balanced'] };
    let repeat = nightlyRepeat(null, report(worse));
    for (let run = 0; run < 3; run++) repeat = nightlyRepeat(report({ ...worse, repeatNights: repeat }), report(worse));
    expect(repeat).toBe(1);
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
    expect(parseNightlyReport(JSON.stringify({ ...report(), repeatNights: -1 }))).toBeNull();
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

  it('the accepted note stays until the next healthy night, and new checks are named on the card', () => {
    const accepted = report({ acceptedWorse: ['invariant:I1_voucher_balanced'] });
    const noBackup = report({ failure: 'no_new_backup', restoreOk: false, health: null, invariants: null });
    expect(nightlyCarriedAccepted(accepted, noBackup)).toEqual(accepted.acceptedWorse);
    expect(nightlyVerifyVerdict({ ...noBackup, acceptedWorse: accepted.acceptedWorse }, NOW).messages).toContain(acceptedMessage(1));
    expect(nightlyCarriedAccepted({ ...noBackup, acceptedWorse: accepted.acceptedWorse }, report())).toEqual([]);
    const { container } = render(<NightlyVerifyHealthCard nightly={nightlyVerifyVerdict(report({ newChecks: ['added_by_update'] }), NOW)} />);
    const copy = container.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-technical]').forEach(el => el.remove());
    expect(copy.textContent).toContain(newChecksMessage(1));
    expect(copy.textContent).not.toMatch(/[A-Za-z0-9]/);
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

  it('--accept-baseline makes the findings of the last night the new normal, and refuses a night that did not run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-'));
    const file = path.join(dir, 'nightly-verify.json');
    const accept = () => spawnSync(path.join(ROOT, 'node_modules/.bin/tsx'),
      ['scripts/nightly-verify.ts', '--report', file, '--accept-baseline'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_DIR: dir } });
    fs.writeFileSync(file, JSON.stringify(report({ worse: ['I1_voucher_balanced: 0 → 2'], repeatNights: 2 })));
    const run = accept();
    expect(run.status, run.stderr).toBe(0);
    const written = parseNightlyReport(fs.readFileSync(file, 'utf8'));
    expect(written).toMatchObject({ worse: [], acceptedWorse: ['I1_voucher_balanced: 0 → 2'], repeatNights: 0 });
    expect(nightlyVerifyVerdict(written!, NOW).status).toBe('ok');
    expect(nightlyBaseline(written)?.invariants).toEqual(report().invariants);
    fs.writeFileSync(file, JSON.stringify(report({ failure: 'restore', restoreOk: false, health: null, invariants: null })));
    const refused = accept();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('REFUSED');
    expect(parseNightlyReport(fs.readFileSync(file, 'utf8'))?.failure).toBe('restore');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('install-ops-cron.sh schedules it every night at 04:00 as root, after the backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-cron-'));
    const cronFile = path.join(dir, 'papital-erp');
    const run = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), 'root'], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: cronFile, APP_DIR: ROOT },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(cronFile, 'utf8')).toContain(`0 4 * * * root bash ${ROOT}/scripts/nightly-verify.sh >> ${ROOT}/logs/nightly-verify.log 2>&1`);
    const bad = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), 'root'], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: path.join(dir, 'other'), APP_DIR: ROOT, NIGHTLY_VERIFY_HOUR: '25' },
    });
    expect(bad.status).toBe(1);
    expect(run.stderr).toContain('the default 2 is written');
    expect(run.stdout).toContain('nightly backup check at 04:00');
    const cron = (env: Record<string, string>) => spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), 'root'], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: path.join(dir, 'times'), APP_DIR: ROOT, ...env },
    });
    // 08 and 09 are decimal hours
    const nine = cron({ BACKUP_HOUR: '08', BACKUP_MINUTE: '09', NIGHTLY_VERIFY_HOUR: '09', NIGHTLY_VERIFY_MINUTE: '09', MEDIA_OFFSITE_HOUR: '01', MEDIA_OFFSITE_MINUTE: '00' });
    expect(nine.status, nine.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'times'), 'utf8')).toContain(`9 9 * * * root bash ${ROOT}/scripts/nightly-verify.sh`);
    expect(nine.stderr).not.toContain('not given');
    // a variable not given keeps the time the file has: only the check moves, the 08:09 backup stays
    const keep = cron({ NIGHTLY_VERIFY_HOUR: '11', NIGHTLY_VERIFY_MINUTE: '0' });
    expect(keep.status, keep.stderr).toBe(0);
    expect(keep.stderr).toContain('the existing 8 is kept');
    expect(fs.readFileSync(path.join(dir, 'times'), 'utf8')).toMatch(/^9 8 \* \* \* .*scripts\/backup\.sh/m);
    // a huge number does not wrap into range
    expect(cron({ BACKUP_HOUR: '18446744073709551618' }).status).toBe(1);
    // the check never starts within 60 minutes after the backup, nor at the same time (across midnight too)
    const at = (env: Record<string, string>) => cron({ BACKUP_HOUR: '2', BACKUP_MINUTE: '30', ...env });
    expect(at({ NIGHTLY_VERIFY_HOUR: '2', NIGHTLY_VERIFY_MINUTE: '30' }).status).toBe(1);
    expect(at({ NIGHTLY_VERIFY_HOUR: '3', NIGHTLY_VERIFY_MINUTE: '15' }).status).toBe(1);
    expect(at({ BACKUP_HOUR: '23', BACKUP_MINUTE: '30', NIGHTLY_VERIFY_HOUR: '0', NIGHTLY_VERIFY_MINUTE: '15' }).status).toBe(1);
    expect(at({ NIGHTLY_VERIFY_HOUR: '3', NIGHTLY_VERIFY_MINUTE: '30' }).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
