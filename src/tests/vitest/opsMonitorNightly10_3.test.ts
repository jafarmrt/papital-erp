// @vitest-environment node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { NIGHTLY_VERIFY_REPORT_VERSION, NIGHTLY_VERIFY_STALE_HOURS, nightlyVerifyVerdict, type NightlyVerifyReport } from '../../lib/system/nightlyVerify';
import { alertPattern, alertText, monitorHarness } from './helpers/monitorHarness';

// 10.3 package 8 (v10.3.21): the server monitor alerts on the nightly backup check (TD-1350) and gives curl its secrets on
// standard input, never on its command line (TD-1388). The real scripts/monitor.sh runs against a fake app and bot.
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('monitor_nightly_and_secrets_10_3_package8: the nightly backup check alert and secrets off the curl command line', () => {
  const h = monitorHarness();
  const fresh = h.fresh;
  const monitor = h.monitor;

  // ---------- v10.3.21 (TD-1350): the nightly backup check ----------
  const nightlyReport = (over: Partial<NightlyVerifyReport> = {}, hoursAgo = 2): NightlyVerifyReport => ({
    version: NIGHTLY_VERIFY_REPORT_VERSION, finishedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    backupFile: 'erp_daily_x.dump.gz', backupAt: null, restoreOk: true, failure: null,
    health: [{ id: 'voucher_balance', status: 'healthy', count: 0 }], invariants: [{ invariant: 'I1_voucher_balanced', count: 0 }],
    worse: [], repeatNights: 0, acceptedWorse: [], newChecks: [], errors: [], baseline: null, ...over,
  });
  const writeNightly = (report: NightlyVerifyReport | string) => {
    fs.mkdirSync(path.join(h.dir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, 'logs', 'nightly-verify.json'), typeof report === 'string' ? report : JSON.stringify(report));
  };

  it('nightly_verify_alert_td_1350: a failed nightly backup check is sent once, again after the repeat window, and its recovery once', async () => {
    fresh();
    writeNightly(nightlyReport());
    expect((await monitor()).code).toBe(0);
    expect(h.srv.sent).toEqual([]);
    writeNightly(nightlyReport({ restoreOk: false, failure: 'restore', health: null, invariants: null }));
    expect((await monitor()).code).toBe(1);
    expect(h.srv.sent).toHaveLength(1);
    expect(h.srv.sent[0]).toContain(alertText('nightly_failed'));
    expect((await monitor()).code).toBe(1);
    expect(h.srv.sent).toHaveLength(1);
    const stateFile = path.join(h.stateDir, 'check_nightly');
    const [since] = fs.readFileSync(stateFile, 'utf8').trim().split(' ');
    fs.writeFileSync(stateFile, `${since} ${Math.floor(Date.now() / 1000) - 7 * 3600}\n`);
    await monitor();
    expect(h.srv.sent[1]).toContain(alertText('still', alertText('nightly_failed')));
    writeNightly(nightlyReport());
    expect((await monitor()).code).toBe(0);
    expect(h.srv.sent[2]).toContain(alertText('resolved', alertText('nightly_ok')));
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('nightly_verify_alert_td_1350: a worse night gives the count, an old report the hours, an unreadable report says so; none is not a problem', async () => {
    fresh();
    expect((await monitor()).code).toBe(0);
    writeNightly(nightlyReport({ worse: ['voucher_balance', 'I1_voucher_balanced'], repeatNights: 1 }));
    await monitor();
    expect(h.srv.sent[0]).toContain(alertText('nightly_worse', 2));
    fs.rmSync(h.dir, { recursive: true, force: true });
    fresh();
    writeNightly(nightlyReport({}, 40));
    await monitor();
    expect(h.srv.sent[0]).toContain(alertText('nightly_stale', 40));
    fs.rmSync(h.dir, { recursive: true, force: true });
    fresh();
    writeNightly('{"version": 1, "finishedAt": "not a time"');
    await monitor();
    expect(h.srv.sent[0]).toContain(alertText('nightly_unreadable'));
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('nightly_verify_alert_td_1350: no report is a problem only when the cron file runs the check and a day and a half has passed; a malformed report is unreadable', async () => {
    const schedule = (line: string, firstRunHoursAgo: number) => {
      fs.mkdirSync(path.join(h.dir, 'cron.d'), { recursive: true });
      fs.writeFileSync(path.join(h.dir, 'cron.d', 'papital-erp'), `30 2 * * * root /opt/app/scripts/backup.sh\n${line}\n`);
      fs.mkdirSync(h.stateDir, { recursive: true });
      fs.writeFileSync(path.join(h.stateDir, 'first_run'), `${Math.floor(Date.now() / 1000) - firstRunHoursAgo * 3600}\n`);
    };
    fresh();
    schedule('0 4 * * * root /opt/app/scripts/nightly-verify.sh >> /opt/app/logs/nightly-verify.log 2>&1', 37);
    expect((await monitor()).code).toBe(1);
    expect(h.srv.sent[0]).toContain(alertText('nightly_missing'));
    fs.rmSync(h.dir, { recursive: true, force: true });
    for (const [line, hours] of [['# 0 4 * * * root /opt/app/scripts/nightly-verify.sh', 37], ['0 4 * * * root /opt/app/scripts/nightly-verify.sh', 20]] as const) {
      fresh();
      schedule(line, hours);
      expect((await monitor()).code).toBe(0);
      expect(h.srv.sent).toEqual([]);
      fs.rmSync(h.dir, { recursive: true, force: true });
    }
    fresh();
    const malformed: Record<string, unknown> = { ...nightlyReport() };
    delete malformed.restoreOk;
    writeNightly(JSON.stringify(malformed));
    await monitor();
    expect(h.srv.sent[0]).toContain(alertText('nightly_unreadable'));
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  it('nightly_verify_alert_td_1350: the alert follows the verdict of the health page card', async () => {
    const cases: Array<[NightlyVerifyReport, string | null]> = [
      [nightlyReport(), null],
      [nightlyReport({ acceptedWorse: ['voucher_balance'] }), null],
      [nightlyReport({ failure: 'no_space', restoreOk: false, health: null, invariants: null }), 'nightly_failed'],
      [nightlyReport({ restoreOk: false }), 'nightly_failed'],
      [nightlyReport({ health: null }), 'nightly_failed'],
      [nightlyReport({ worse: ['voucher_balance'] }), 'nightly_worse'],
      [nightlyReport({ worse: ['voucher_balance'] }, NIGHTLY_VERIFY_STALE_HOURS + 1), 'nightly_stale'],
      [nightlyReport({ failure: 'restore', restoreOk: false }, NIGHTLY_VERIFY_STALE_HOURS + 1), 'nightly_failed'],
    ];
    const keyOf: Record<string, string | null> = { ok: null, warning: 'nightly_worse', failed: 'nightly_failed', stale: 'nightly_stale' };
    for (const [report, key] of cases) {
      expect(keyOf[nightlyVerifyVerdict(report, new Date()).status]).toBe(key);
      fresh();
      writeNightly(report);
      await monitor();
      if (key === null) expect(h.srv.sent).toEqual([]);
      else expect(h.srv.sent[0] ?? '').toMatch(alertPattern(key));
      fs.rmSync(h.dir, { recursive: true, force: true });
    }
    expect(read('scripts/monitor.sh')).toContain(`r.version !== ${NIGHTLY_VERIFY_REPORT_VERSION}`);
    expect(read('scripts/monitor.sh')).toContain(`> ${NIGHTLY_VERIFY_STALE_HOURS} * 3600000`);
  }, 30_000);

  it('monitor_secrets_off_command_line_td_1388: the metrics token, the bot token and the SMTP password never reach the curl command line', async () => {
    fresh('ALERT_SMTP_URL=smtps://smtp.example.test:465\nALERT_SMTP_USER=ops@example.test\nALERT_SMTP_PASSWORD=smtp"pw\\1\nALERT_EMAIL_TO=owner@example.test\n');
    const bin = path.join(h.dir, 'bin');
    fs.mkdirSync(bin);
    const argvLog = path.join(h.dir, 'curl-argv.log');
    const smtpConfig = path.join(h.dir, 'smtp-config.txt');
    const realCurl = spawnSync('bash', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
    // a stand-in curl: writes its command line, sends nothing for SMTP (keeps the config it got on stdin), else runs curl
    fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> '${argvLog}'
case "$*" in *smtps://*) cat > '${smtpConfig}'; exit 0 ;; esac
exec '${realCurl}' "$@"
`, { mode: 0o755 });
    h.srv.ready = 503;
    const r = await monitor({ PATH: `${bin}:${process.env.PATH}` });
    expect(r.code, r.out).toBe(1);
    expect(h.srv.sent).toHaveLength(1);
    h.srv.ready = 200;
    expect((await monitor({ PATH: `${bin}:${process.env.PATH}` })).code).toBe(0);
    const argv = fs.readFileSync(argvLog, 'utf8');
    expect(argv).toContain('/metrics');
    expect(argv).toContain('smtps://smtp.example.test:465');
    for (const secret of ['mt-1', 'BT-1', 'smtp"pw']) expect(argv).not.toContain(secret);
    expect(fs.readFileSync(smtpConfig, 'utf8').trim()).toBe('user = "ops@example.test:smtp\\"pw\\\\1"');
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

});
