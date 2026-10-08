import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { REPO_ROOT, runCommand } from './scratchDatabase.js';

/**
 * حوزه K (v8.0.83، TD-365): به‌روزرسانی فقط وقتی «موفق» است که /health/startup (پایان مهاجرت‌ها و seed) پاسخ ۲۰۰
 * بدهد و نسخه در حال اجرا همان نسخه ساخته‌شده باشد. سرور آزمایشی همه حالت‌ها را شبیه‌سازی می‌کند: زنده ولی هنوز
 * در حال مهاجرت (live = 200، startup = 503)، راه‌افتاده، و راه‌افتاده با نسخه دیگر.
 */

function fakeServer(state: { started: boolean; version: string }): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"alive"}');
    } else if (url === '/health/startup') {
      res.writeHead(state.started ? 200 : 503, { 'Content-Type': 'application/json' }).end(`{"status":"${state.started ? 'started' : 'starting'}"}`);
    } else if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(`{"status":"ok","version":"${state.version}"}`);
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as AddressInfo).port, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}

export async function checkUpdateWaitsForStartup(): Promise<string[]> {
  const v: string[] = [];
  const state = { started: false, version: '8.0.999' };
  const server = await fakeServer(state);
  const verify = path.join(REPO_ROOT, 'scripts', 'verify-startup.sh');
  const env = { ...process.env, STARTUP_POLL_INTERVAL: '1' };
  try {
    const migrating = await runCommand('bash', [verify, String(server.port), '3', '8.0.999'], { env });
    if (migrating.code === 0) v.push('A live server still migrating (startup = 503) was counted as "started"');
    state.started = true;
    const started = await runCommand('bash', [verify, String(server.port), '3', '8.0.999'], { env });
    if (started.code !== 0) v.push(`A started server with the right version was refused (code ${started.code}): ${started.output.slice(-200)}`);
    const otherVersion = await runCommand('bash', [verify, String(server.port), '3', '8.0.998'], { env });
    if (otherVersion.code === 0) v.push('Another (stale) running version was accepted');
  } finally {
    await server.close();
  }

  const update = fs.readFileSync(path.join(REPO_ROOT, 'update.sh'), 'utf8');
  if (!update.includes('scripts/verify-startup.sh')) v.push('update.sh does not check the end of startup (/health/startup)');
  if (/health\/live/.test(update)) v.push('update.sh still takes /health/live as the success signal');

  // آرگومان ناشناخته: پیام روشن و کد ۱، نه «die: command not found» (کد ۱۲۷)
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-k-update-'));
  try {
    const bogus = await runCommand('bash', [path.join(REPO_ROOT, 'update.sh'), '--bogus-argument'], { cwd, env: { ...process.env, APP_DIR: cwd } });
    if (bogus.code !== 1 || !bogus.output.includes('Unknown argument')) v.push(`update.sh with an unknown argument returned code ${bogus.code}: ${bogus.output.slice(-150)}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  return v;
}
