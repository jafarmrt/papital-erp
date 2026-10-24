import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Series 10 phase 1, O-03 (moved here in v10.3.23 for the nightly check tests): scripts/monitor.sh run for real against a
 * fake application and a fake alert bot, in a made-up app directory with its own .env and state.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

export interface FakeServer { url: string; ready: number; metrics: string; sent: string[]; sent2: string[]; close: () => Promise<void> }

export async function fakeServer(): Promise<FakeServer> {
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

export const GOOD_METRICS = 'erp_queue_metrics_up 1\nerp_dead_letter_unresolved 0\nerp_outbox_stuck 0\nerp_outbox_failed 0\n';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNumber = (n: number) => String(n).replace(/\d/g, d => FA_DIGITS[Number(d)]);
/** The alert template of KEY from the messages file, filled like monitor.sh fills it */
export function alertText(key: string, ...args: Array<string | number>): string {
  const line = read('scripts/ops/monitor-messages.fa.txt').split('\n').find(l => l.startsWith(`${key}|`));
  if (!line) throw new Error(`no alert text ${key}`);
  let out = line.slice(key.length + 1);
  for (const a of args) out = out.replace('%s', typeof a === 'number' ? faNumber(a) : a);
  return out;
}

/** The alert template of KEY with every %s matching anything */
export function alertPattern(key: string): RegExp {
  const line = read('scripts/ops/monitor-messages.fa.txt').split('\n').find(l => l.startsWith(`${key}|`)) ?? '';
  return new RegExp(line.slice(key.length + 1).split('%s').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+'));
}

/** The settings monitor.sh reads (`setting KEY` in scripts/monitor.sh) */
export const MONITOR_SETTING = /^(ALERT_\w+|BACKUP_DIR|BACKUP_RCLONE_REMOTE|METRICS_TOKEN|MONITOR_\w+|NIGHTLY_VERIFY_REPORT|PORT)$/;

/** One fake server for the describe that calls it, and a fresh app directory per `fresh()` */
export function monitorHarness() {
  const h = { srv: undefined as unknown as FakeServer, dir: '', backupDir: '', stateDir: '' };
  beforeAll(async () => { h.srv = await fakeServer(); });
  afterAll(async () => { await h.srv.close(); });
  const fresh = (envLines = '') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-'));
    Object.assign(h, { dir, backupDir: path.join(dir, 'backups'), stateDir: path.join(dir, 'state') });
    fs.mkdirSync(h.backupDir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'ops'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/ops/monitor-messages.fa.txt'), path.join(dir, 'scripts/ops/monitor-messages.fa.txt'));
    fs.writeFileSync(path.join(dir, '.env'), `METRICS_TOKEN=mt-1\nALERT_BOT_TOKEN=BT-1\nALERT_CHAT_ID=42\n${envLines}`);
    fs.writeFileSync(path.join(h.backupDir, '.last_daily_ok'), `${Math.floor(Date.now() / 1000) - 3600} erp_daily_x\n`);
    h.srv.ready = 200;
    h.srv.metrics = GOOD_METRICS;
    h.srv.sent.length = 0;
    h.srv.sent2.length = 0;
  };
  // 10.3 package 3: monitor.sh takes a setting from its environment before .env, so a METRICS_TOKEN or alert channel of the
  // shell running the tests (CI's test settings, scripts/ci-test-env.sh) replaced this test's .env and the healthy run
  // reported events_unreadable; only the settings each test gives reach the monitor
  const shellEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MONITOR_SETTING.test(key)));
  const monitor = (extra: Record<string, string> = {}) => new Promise<{ code: number | null; out: string }>(resolve => {
    const child = spawn('bash', [path.join(ROOT, 'scripts/monitor.sh')], {
      env: {
        ...shellEnv, APP_DIR: h.dir, MONITOR_URL: h.srv.url, ALERT_BOT_API: h.srv.url, BACKUP_DIR: h.backupDir,
        MONITOR_STATE_DIR: h.stateDir, MONITOR_DISK_PERCENT: '100', MONITOR_CRON_FILE: path.join(h.dir, 'cron.d', 'papital-erp'), ...extra,
      },
    });
    let out = '';
    child.stdout.on('data', c => { out += String(c); });
    child.stderr.on('data', c => { out += String(c); });
    child.on('close', code => resolve({ code, out }));
  });
  return Object.assign(h, { fresh, monitor });
}
