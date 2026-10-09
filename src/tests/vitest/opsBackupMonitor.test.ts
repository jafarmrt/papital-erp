// @vitest-environment node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Series 10 phase 1, O-02 / O-03: the daily backup schedule, the encrypted off-server copy and the server monitor,
// proven by running the real scripts with fake rclone, a fake application and a fake alert bot. Test names are English.
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('ops_cron_installed_td_1020: install.sh schedules the daily backup and the monitor (README says it does)', () => {
  const runCron = (env: Record<string, string>) => spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), os.userInfo().username], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });

  it('install-ops-cron.sh writes one cron file with the backup and the monitor, replaces the older file and is idempotent', () => {
    const dir = tmp('ops-cron-');
    const cronFile = path.join(dir, 'cron.d', 'papital-erp');
    fs.mkdirSync(path.dirname(cronFile), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cron.d', 'papital-erp-backup'), '0 2 * * * root /opt/papital-erp/scripts/backup.sh\n');
    const first = runCron({ CRON_FILE: cronFile, APP_DIR: ROOT });
    expect(first.status, first.stderr).toBe(0);
    const text = fs.readFileSync(cronFile, 'utf8');
    const user = os.userInfo().username;
    expect(text).toContain(`30 2 * * * ${user} ${ROOT}/scripts/backup.sh >> ${ROOT}/logs/backup.log 2>&1`);
    expect(text).toContain(`*/5 * * * * ${user} ${ROOT}/scripts/monitor.sh >> ${ROOT}/logs/monitor.log 2>&1`);
    expect((fs.statSync(cronFile).mode & 0o777).toString(8)).toBe('644');
    expect(fs.existsSync(path.join(dir, 'cron.d', 'papital-erp-backup'))).toBe(false);
    expect(runCron({ CRON_FILE: cronFile, APP_DIR: ROOT }).status).toBe(0);
    expect(fs.readFileSync(cronFile, 'utf8')).toBe(text);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a bad backup time or an unknown user is refused and writes nothing', () => {
    const dir = tmp('ops-cron-');
    const cronFile = path.join(dir, 'papital-erp');
    expect(runCron({ CRON_FILE: cronFile, APP_DIR: ROOT, BACKUP_HOUR: '24' }).status).toBe(1);
    const unknown = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), 'no_such_user_x9'], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: cronFile, APP_DIR: ROOT },
    });
    expect(unknown.status).toBe(1);
    expect(fs.existsSync(cronFile)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('install.sh runs it and makes the private backup directory; the old cron hint is gone from backup.sh', () => {
    const install = read('install.sh');
    expect(install).toContain('bash scripts/install-ops-cron.sh "$(id -un)"');
    expect(install).toMatch(/install -d -m 700 -o "\$\(id -un\)"/);
    expect(read('scripts/backup.sh')).not.toContain('/etc/cron.d/papital-erp-backup');
  });
});

// ---------- O-02: the encrypted off-server copy ----------

const FAKE_RCLONE = `#!/bin/bash
echo "$*" >> "$FAKE_RCLONE_LOG"
case "$1" in
  listremotes) echo "papital-crypt: \${FAKE_REMOTE_TYPE:-crypt}"; echo "gdrive: drive" ;;
  copyto)
    [ "\${FAKE_RCLONE_FAIL:-}" != "copy" ] || exit 1
    cp "$2" "$FAKE_REMOTE_DIR/\${3##*/}" ;;
  lsl)
    for f in "$FAKE_REMOTE_DIR"/*; do [ -f "$f" ] && printf '%9d 2026-10-09 02:30:00.000000000 %s\\n' "$(stat -c %s "$f")" "\${f##*/}"; done; true ;;
  delete) ;;
  *) exit 1 ;;
esac
`;

interface OffsiteSetup { dir: string; appDir: string; backupDir: string; remoteDir: string; log: string; base: string; env: NodeJS.ProcessEnv }

function offsiteSetup(envLines: string): OffsiteSetup {
  const dir = tmp('offsite-');
  const appDir = path.join(dir, 'app');
  const backupDir = path.join(dir, 'backups');
  const remoteDir = path.join(dir, 'remote');
  const binDir = path.join(dir, 'bin');
  for (const d of [appDir, backupDir, remoteDir, binDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'rclone'), FAKE_RCLONE, { mode: 0o755 });
  fs.writeFileSync(path.join(appDir, '.env'), `NODE_ENV=production\nERP_SECRETS_KEY=k-0123456789abcdef\n${envLines}`);
  const base = path.join(backupDir, 'erp_daily_20261009_023000');
  fs.writeFileSync(`${base}.dump.gz`, 'dump');
  fs.writeFileSync(`${base}.manifest`, 'manifest');
  fs.writeFileSync(`${base}_uploads.tar.gz`, 'uploads');
  const log = path.join(dir, 'rclone.log');
  const env: NodeJS.ProcessEnv = {
    ...process.env, PATH: `${binDir}:${process.env.PATH}`, APP_DIR: appDir, BACKUP_DIR: backupDir,
    FAKE_REMOTE_DIR: remoteDir, FAKE_RCLONE_LOG: log,
  };
  delete env.BACKUP_RCLONE_REMOTE;
  return { dir, appDir, backupDir, remoteDir, log, base, env };
}

const offsite = (s: OffsiteSetup, extra: Record<string, string> = {}) =>
  spawnSync('bash', [path.join(ROOT, 'scripts/backup-offsite.sh'), s.base], { encoding: 'utf8', env: { ...s.env, ...extra } });

describe('offsite_backup_carries_secrets_key_td_957: the daily backup and the .env with ERP_SECRETS_KEY go off the server, encrypted (OBS-PR-08)', () => {
  it('copies the dump, the manifest, the archive and the .env to the crypt remote, checks them and records the time', () => {
    const s = offsiteSetup('BACKUP_RCLONE_REMOTE=papital-crypt:erp\nOFFSITE_RETENTION_DAYS=30\n');
    const r = offsite(s);
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(fs.readdirSync(s.remoteDir).sort()).toEqual([
      'erp_daily_20261009_023000.dump.gz', 'erp_daily_20261009_023000.env', 'erp_daily_20261009_023000.manifest',
      'erp_daily_20261009_023000_uploads.tar.gz',
    ]);
    expect(fs.readFileSync(path.join(s.remoteDir, 'erp_daily_20261009_023000.env'), 'utf8')).toContain('ERP_SECRETS_KEY=k-0123456789abcdef');
    const calls = fs.readFileSync(s.log, 'utf8');
    expect(calls).toContain('copyto');
    expect(calls).toContain('papital-crypt:erp/erp_daily_20261009_023000.env');
    expect(calls).toMatch(/^delete papital-crypt:erp\/ --min-age 30d --include erp_daily_\*$/m);
    expect(fs.readFileSync(path.join(s.backupDir, '.last_offsite_ok'), 'utf8')).toMatch(/^\d+ erp_daily_20261009_023000\n$/);
    fs.rmSync(s.dir, { recursive: true, force: true });
  });

  it('refuses a remote that is not a crypt remote before copying anything', () => {
    const s = offsiteSetup('BACKUP_RCLONE_REMOTE=papital-crypt:\n');
    const r = offsite(s, { FAKE_REMOTE_TYPE: 'drive' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('not crypt');
    expect(fs.readdirSync(s.remoteDir)).toEqual([]);
    expect(fs.existsSync(path.join(s.backupDir, '.last_offsite_ok'))).toBe(false);
    fs.rmSync(s.dir, { recursive: true, force: true });
  });

  it('a missing remote setting, an unknown remote or a failed upload fails without a status time', () => {
    const none = offsiteSetup('');
    expect(offsite(none).status).toBe(1);
    const unknown = offsiteSetup('BACKUP_RCLONE_REMOTE=other:\n');
    expect(offsite(unknown).stdout).toContain('no remote named other');
    const failed = offsiteSetup('BACKUP_RCLONE_REMOTE=papital-crypt:\n');
    expect(offsite(failed, { FAKE_RCLONE_FAIL: 'copy' }).status).toBe(1);
    for (const s of [none, unknown, failed]) {
      expect(fs.existsSync(path.join(s.backupDir, '.last_offsite_ok'))).toBe(false);
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  });

  it('backup.sh runs it for the daily kind, exits 3 when it fails, and no longer uses the AWS command line', () => {
    const backup = read('scripts/backup.sh');
    expect(backup).toContain('bash "$APP_DIR/scripts/backup-offsite.sh" "$BASE"');
    expect(backup).toMatch(/OFFSITE_KINDS="\$\{OFFSITE_KINDS:-daily\}"/);
    expect(backup).toMatch(/off-server copy FAILED"\n\s+exit 3/);
    expect(backup).toContain('.last_${BACKUP_KIND}_ok');
    expect(backup).not.toContain('aws s3');
    expect(read('install.sh')).toMatch(/apt-get install -y [^\n]*rclone/);
  });
});

// ---------- O-03: the monitor ----------

interface FakeServer { url: string; ready: number; metrics: string; sent: string[]; sent2: string[]; close: () => Promise<void> }

async function fakeServer(): Promise<FakeServer> {
  const state = { ready: 200, metrics: '', sent: [] as string[], sent2: [] as string[] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += String(c); });
    req.on('end', () => {
      if (req.url === '/health/ready') { res.writeHead(state.ready); res.end('{}'); return; }
      if (req.url === '/metrics') {
        if (req.headers['x-metrics-token'] !== 'mt-1') { res.writeHead(401); res.end(); return; }
        res.writeHead(200); res.end(state.metrics); return;
      }
      if (req.url === '/botBT-1/sendMessage') {
        const params = new URLSearchParams(body);
        if (params.get('chat_id') === '42') state.sent.push(String(params.get('text')));
        res.writeHead(200); res.end('{"ok":true}'); return;
      }
      if (req.url === '/botBT-2/sendMessage') {
        const params = new URLSearchParams(body);
        if (params.get('chat_id') === '77') state.sent2.push(String(params.get('text')));
        res.writeHead(200); res.end('{"ok":true}'); return;
      }
      if (req.url === '/botBT-DOWN/sendMessage') { res.writeHead(500); res.end(); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, { url, close: () => new Promise<void>(resolve => server.close(() => resolve())) }) as FakeServer;
}

const GOOD_METRICS = 'erp_queue_metrics_up 1\nerp_dead_letter_unresolved 0\nerp_outbox_stuck 0\nerp_outbox_failed 0\n';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNumber = (n: number) => String(n).replace(/\d/g, d => FA_DIGITS[Number(d)]);
/** The alert template of KEY from the messages file, filled like monitor.sh fills it */
function alertText(key: string, ...args: Array<string | number>): string {
  const line = read('scripts/ops/monitor-messages.fa.txt').split('\n').find(l => l.startsWith(`${key}|`));
  if (!line) throw new Error(`no alert text ${key}`);
  let out = line.slice(key.length + 1);
  for (const a of args) out = out.replace('%s', typeof a === 'number' ? faNumber(a) : a);
  return out;
}

/** The alert template of KEY with every %s matching anything */
function alertPattern(key: string): RegExp {
  const line = read('scripts/ops/monitor-messages.fa.txt').split('\n').find(l => l.startsWith(`${key}|`)) ?? '';
  return new RegExp(line.slice(key.length + 1).split('%s').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+'));
}

describe('monitor_alerts_td_1021: the server monitor alerts once on app, disk, backup age and event queue problems and once on recovery (O-03)', () => {
  let srv: FakeServer;
  let dir: string;
  let backupDir: string;
  let stateDir: string;

  beforeAll(async () => { srv = await fakeServer(); });
  afterAll(async () => { await srv.close(); });

  const fresh = (envLines = '') => {
    dir = tmp('monitor-');
    backupDir = path.join(dir, 'backups');
    stateDir = path.join(dir, 'state');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'ops'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/ops/monitor-messages.fa.txt'), path.join(dir, 'scripts/ops/monitor-messages.fa.txt'));
    fs.writeFileSync(path.join(dir, '.env'), `METRICS_TOKEN=mt-1\nALERT_BOT_TOKEN=BT-1\nALERT_CHAT_ID=42\n${envLines}`);
    fs.writeFileSync(path.join(backupDir, '.last_daily_ok'), `${Math.floor(Date.now() / 1000) - 3600} erp_daily_x\n`);
    srv.ready = 200;
    srv.metrics = GOOD_METRICS;
    srv.sent.length = 0;
    srv.sent2.length = 0;
  };
  const monitor = (extra: Record<string, string> = {}) => new Promise<{ code: number | null; out: string }>(resolve => {
    const child = spawn('bash', [path.join(ROOT, 'scripts/monitor.sh')], {
      env: {
        ...process.env, APP_DIR: dir, MONITOR_URL: srv.url, ALERT_BOT_API: srv.url, BACKUP_DIR: backupDir,
        MONITOR_STATE_DIR: stateDir, MONITOR_DISK_PERCENT: '100', ...extra,
      },
    });
    let out = '';
    child.stdout.on('data', c => { out += String(c); });
    child.stderr.on('data', c => { out += String(c); });
    child.on('close', code => resolve({ code, out }));
  });

  it('a healthy server sends nothing and exits 0', async () => {
    fresh();
    const r = await monitor();
    expect(r.code, r.out).toBe(0);
    expect(srv.sent).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an app that stops answering is reported once, not again within the repeat window, and its recovery once', async () => {
    fresh();
    srv.ready = 503;
    expect((await monitor()).code).toBe(1);
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent[0]).toContain(alertText('app_down', 'HTTP 503'));
    expect((await monitor()).code).toBe(1);
    expect(srv.sent).toHaveLength(1);
    srv.ready = 200;
    expect((await monitor()).code).toBe(0);
    expect(srv.sent).toHaveLength(2);
    expect(srv.sent[1]).toContain(alertText('resolved', alertText('app_ok')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a failure still standing after the repeat window is sent again', async () => {
    fresh();
    srv.ready = 503;
    await monitor();
    const stateFile = path.join(stateDir, 'check_app');
    const [since] = fs.readFileSync(stateFile, 'utf8').trim().split(' ');
    fs.writeFileSync(stateFile, `${since} ${Math.floor(Date.now() / 1000) - 7 * 3600}\n`);
    await monitor();
    expect(srv.sent).toHaveLength(2);
    expect(srv.sent[1]).toContain(alertText('still', alertText('app_down', 'HTTP 503')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dead-letter events, a stuck outbox event or an unread queue gauge are reported with Persian digits', async () => {
    fresh();
    srv.metrics = 'erp_queue_metrics_up 1\nerp_dead_letter_unresolved 3\nerp_outbox_stuck 12\n';
    expect((await monitor()).code).toBe(1);
    expect(srv.sent[0]).toContain(alertText('events_bad', 3, 12));
    fresh();
    srv.metrics = 'erp_queue_metrics_up 0\nerp_dead_letter_unresolved 0\nerp_outbox_stuck 0\n';
    await monitor();
    expect(srv.sent[0]).toContain(alertText('events_unreadable', 'erp_queue_metrics_up'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an old daily backup, a missing off-server copy after a day of monitoring and a full disk are reported', async () => {
    fresh('BACKUP_RCLONE_REMOTE=papital-crypt:\n');
    fs.writeFileSync(path.join(backupDir, '.last_daily_ok'), `${Math.floor(Date.now() / 1000) - 30 * 3600} erp_daily_x\n`);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'first_run'), `${Math.floor(Date.now() / 1000) - 27 * 3600}\n`);
    expect((await monitor({ MONITOR_DISK_PERCENT: '0' })).code).toBe(1);
    const message = srv.sent[0] ?? '';
    expect(message).toContain(alertText('backup_stale', 30));
    expect(message).toContain(alertText('offsite_missing'));
    expect(message).toMatch(alertPattern('disk_full'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a new install is not reported for missing backups before the first day ends', async () => {
    fresh('BACKUP_RCLONE_REMOTE=papital-crypt:\n');
    fs.rmSync(path.join(backupDir, '.last_daily_ok'));
    expect((await monitor()).code).toBe(0);
    expect(srv.sent).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('without an alert channel the problem is not lost: exit 2 and it is sent once a channel exists', async () => {
    fresh();
    fs.writeFileSync(path.join(dir, '.env'), 'METRICS_TOKEN=mt-1\n');
    srv.ready = 503;
    const r = await monitor();
    expect(r.code).toBe(2);
    expect(r.out).toContain('no alert channel configured');
    fs.writeFileSync(path.join(dir, '.env'), 'METRICS_TOKEN=mt-1\nALERT_BOT_TOKEN=BT-1\nALERT_CHAT_ID=42\n');
    await monitor();
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent[0]).toContain(alertText('app_down', 'HTTP 503'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('second_alert_bot_td_1001: a second bot (Bale and Telegram together) gets the same alert, and one bot failing does not stop the other', async () => {
    fresh(`ALERT_BOT2_TOKEN=BT-2\nALERT_BOT2_CHAT_ID=77\nALERT_BOT2_API=${srv.url}\n`);
    srv.ready = 503;
    expect((await monitor()).code).toBe(1);
    expect(srv.sent).toHaveLength(1);
    expect(srv.sent2).toEqual(srv.sent);
    fs.rmSync(dir, { recursive: true, force: true });
    fresh(`ALERT_BOT2_TOKEN=BT-2\nALERT_BOT2_CHAT_ID=77\nALERT_BOT2_API=${srv.url}\n`);
    fs.writeFileSync(path.join(dir, '.env'), fs.readFileSync(path.join(dir, '.env'), 'utf8').replace('ALERT_BOT_TOKEN=BT-1', 'ALERT_BOT_TOKEN=BT-DOWN'));
    srv.ready = 503;
    const r = await monitor();
    expect(r.code).toBe(1);
    expect(r.out).toContain('WARNING: the bot alert could not be sent (bot 1)');
    expect(srv.sent2).toHaveLength(1);
    expect(srv.sent2[0]).toContain(alertText('app_down', 'HTTP 503'));
    // the failure was delivered through bot 2, so it is not sent again within the repeat window
    await monitor();
    expect(srv.sent2).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the monitor prints no Persian on the terminal and METRICS_TOKEN is generated for new and existing installs', async () => {
    fresh();
    srv.ready = 503;
    const r = await monitor();
    expect(r.out).not.toMatch(/[؀-ۿ]/);
    expect(read('scripts/ensure-env-secrets.sh')).toMatch(/for key in [^\n]*METRICS_TOKEN/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
