import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanup, render } from '@testing-library/react';
import { NightlyVerifyHealthCard } from '../../components/system/NightlyVerifyHealthCard';
import {
  NIGHTLY_VERIFY_MESSAGES, NIGHTLY_VERIFY_REPORT_VERSION, nightlyVerifyVerdict, nightlyWorse, parseNightlyReport,
  type NightlyVerifyReport,
} from '../../lib/system/nightlyVerify';
import { readNightlyVerifyHealth } from '../../services/system/nightlyVerifyHealth';

// v10.2.14 (O-04, 10.2 package 13): every night the latest daily backup is restored into a drill copy and the financial
// health check and the business invariants run on it; the health page shows the result. Before, nothing checked a
// backup after it was written, and a backup that did not restore or held broken books went unnoticed until needed.

afterEach(cleanup);

const ROOT = path.resolve(__dirname, '../../..');
const NOW = new Date('2026-10-18T05:00:00Z');

const report = (over: Partial<NightlyVerifyReport> = {}): NightlyVerifyReport => ({
  version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: '2026-10-18T04:02:00Z', backupFile: 'erp_daily_20261018_023000.dump.gz',
  restoreOk: true,
  health: [{ id: 'voucher_balance', status: 'healthy', count: 0 }, { id: 'secrets_at_rest', status: 'warning', count: 1 }],
  invariants: [{ invariant: 'I1_voucher_balanced', count: 2 }],
  worse: [], errors: [], ...over,
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

  it('the card status: ok, worse, failed restore, a check that did not run, stale and never', () => {
    expect(nightlyVerifyVerdict(report(), NOW)).toMatchObject({ status: 'ok', healthErrorCount: 0, healthWarningCount: 1, invariantViolationCount: 2 });
    expect(nightlyVerifyVerdict(report({ worse: ['health:voucher_balance'] }), NOW).status).toBe('warning');
    expect(nightlyVerifyVerdict(report({ restoreOk: false, health: null, invariants: null }), NOW)).toMatchObject({
      status: 'failed', messages: [NIGHTLY_VERIFY_MESSAGES.restoreFailed],
    });
    expect(nightlyVerifyVerdict(report({ invariants: null }), NOW).status).toBe('failed');
    expect(nightlyVerifyVerdict(report({ finishedAt: '2026-10-16T04:02:00Z' }), NOW).status).toBe('stale');
    expect(nightlyVerifyVerdict(null, NOW)).toMatchObject({ status: 'never', messages: [NIGHTLY_VERIFY_MESSAGES.never] });
  });

  it('reads only a report of its own shape', () => {
    expect(parseNightlyReport(JSON.stringify(report()))).toEqual(report());
    expect(parseNightlyReport('not json')).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), version: 99 }))).toBeNull();
    expect(parseNightlyReport(JSON.stringify({ ...report(), health: [{ id: 'x', status: 'bad', count: 1 }] }))).toBeNull();
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
    expect(text).toContain('۱ بررسی نسبت به شب پیش بدتر شده است');
    expect(text).not.toMatch(/[A-Za-z0-9]/);
  });

  it('a backup that did not restore is written as a failed report (no database needed) and the script exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-'));
    const file = path.join(dir, 'nightly-verify.json');
    const run = spawnSync(path.join(ROOT, 'node_modules/.bin/tsx'),
      ['scripts/nightly-verify.ts', '--report', file, '--backup', '/var/backups/erp/erp_daily_x.dump.gz', '--restore-failed'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_DIR: dir } });
    expect(run.status, run.stderr).toBe(1);
    const written = parseNightlyReport(fs.readFileSync(file, 'utf8'));
    expect(written).toMatchObject({ restoreOk: false, health: null, invariants: null, backupFile: 'erp_daily_x.dump.gz' });
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
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
