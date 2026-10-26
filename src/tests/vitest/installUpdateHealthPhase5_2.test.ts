// @vitest-environment node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DLQ_RESOLVED_STATUSES } from '../../services/events/deadLetterQueueService';

// v11 phase 5.2: install, update and health, findings O8, O9, O12 and O17 of the phase 2 server evaluation. The scripts
// run for real in made-up folders against a stand-in server; O10 and O11 (update.sh adds the missing .env keys, rewrites
// the cron file and does nothing when nothing is new) are checked by the recovery check rec_obs_r1_22_update_noop_and_lock.

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const dirs: string[] = [];
const tmp = (prefix: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): Promise<{ status: number | null; out: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env, cwd });
    let out = '';
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { out += String(d); });
    child.on('close', status => resolve({ status, out }));
  });
}

/** A stand-in app: /health/startup answers with the given body */
async function standIn(startupBody = '{"status":"started"}'): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((req, res) => {
    const send = (code: number, body: string) => { res.writeHead(code); res.end(body); };
    if (req.url === '/health/live') return send(200, '{"status":"alive"}');
    if (req.url === '/health/ready') return send(200, '{"status":"ready"}');
    if (req.url === '/health/startup') return send(200, startupBody);
    if (req.url === '/health') return send(200, '{"status":"ok","version":"0.0.1"}');
    return send(404, '{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, close: () => server.close() };
}

describe('go_live_dlq_and_port_o8_o17: go-live-verify counts the open failed events and probes the port of .env', () => {
  /** go-live-verify against the stand-in with a psql that answers 2 for the dead-letter count and 0 otherwise */
  async function goLive(withArg: boolean): Promise<string> {
    const app = await standIn();
    const dir = tmp('golive-o8-');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'psql'), `#!/bin/bash
for a in "$@"; do case "$a" in *dead_letter_events*) echo "$a" >> "${dir}/dlq.sql"; echo 2; exit 0 ;; esac; done
echo 0`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"0.0.1"}');
    fs.writeFileSync(path.join(dir, '.env'), `NODE_ENV=production\nPORT=${app.port}\nDATABASE_URL=postgres://u:p@127.0.0.1:1/none\n`);
    try {
      const r = await run('bash', [path.join(ROOT, 'scripts/go-live-verify.sh'), ...(withArg ? [`http://127.0.0.1:${app.port}`] : [])],
        { PATH: `${bin}:${process.env.PATH}`, HOME: dir, APP_DIR: dir, SERVICE_NAME: 'papital-erp-go-live-test' });
      return `${r.out}\n--- sql: ${fs.existsSync(path.join(dir, 'dlq.sql')) ? fs.readFileSync(path.join(dir, 'dlq.sql'), 'utf8') : ''}`;
    } finally {
      app.close();
    }
  }

  it('an event that is neither replayed nor dismissed counts, by the rule of the dead-letter metric', async () => {
    const out = await goLive(true);
    expect(out).toContain('[WARN] DLQ has 2 unresolved item(s)');
    expect(out).not.toContain('Dead letter queue empty');
    const statuses = [...out.split('--- sql:')[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
    expect(statuses.sort()).toEqual([...DLQ_RESOLVED_STATUSES].sort());
    expect(out).toContain('NOT IN');
  });

  it('without a URL it probes the PORT of .env, as every other script does', async () => {
    const out = await goLive(false);
    expect(out).toMatch(/Base URL : http:\/\/localhost:\d+/);
    expect(out).not.toContain('localhost:3000');
    expect(out).toMatch(/\[PASS\] \/health\/startup started/);
  });
});

describe('install_refuses_existing_o9: install.sh stops on a working install before it changes anything', () => {
  function installIn(files: Record<string, string>, env: Record<string, string> = {}) {
    const dir = tmp('install-o9-');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // every system command install.sh would run first is logged, never run
    for (const cmd of ['apt-get', 'sudo', 'systemctl', 'curl']) {
      fs.writeFileSync(path.join(bin, cmd), `#!/bin/bash\necho "${cmd} $*" >> "${dir}/ran.log"\nexit 1`, { mode: 0o755 });
    }
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    const r = spawnSync('bash', [path.join(ROOT, 'install.sh')], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } });
    const ran = fs.existsSync(path.join(dir, 'ran.log')) ? fs.readFileSync(path.join(dir, 'ran.log'), 'utf8') : '';
    return { ...r, ran };
  }
  const SOURCE = { 'package.json': '{}', 'server.ts': '' };

  it('a folder with .env and a build is updated with update.sh: the installer says so and runs nothing', () => {
    const r = installIn({ ...SOURCE, '.env': 'NODE_ENV=production\n', 'dist/server.cjs': 'built' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('already installed');
    expect(r.stdout).toContain('sudo ./update.sh');
    expect(r.ran).not.toContain('apt-get');
  });

  it('a folder without .env (a reinstall over a kept database) or without a build goes on as before', () => {
    for (const files of [{ ...SOURCE, 'dist/server.cjs': 'built' }, { ...SOURCE, '.env': 'NODE_ENV=production\n' }]) {
      const r = installIn(files);
      expect(r.stdout).not.toContain('already installed');
      expect(r.ran).toContain('apt-get');
    }
  });
});

describe('health_meaning_o12: the probes say the same thing about healthy', () => {
  it('verify-startup names the steps a server left out, and still counts the start', async () => {
    const app = await standIn('{"status":"started","degradedSteps":["base data seed","display time zone cache"]}');
    try {
      const r = await run('bash', [path.join(ROOT, 'scripts/verify-startup.sh'), String(app.port), '5'], { ...process.env, STARTUP_POLL_INTERVAL: '1' });
      expect(r.status).toBe(0);
      expect(r.out).toContain('WARNING: started without these steps: ["base data seed","display time zone cache"]');
      expect(r.out).toContain('Startup completed.');
    } finally {
      app.close();
    }
    const clean = await standIn();
    try {
      const r = await run('bash', [path.join(ROOT, 'scripts/verify-startup.sh'), String(clean.port), '5'], { ...process.env, STARTUP_POLL_INTERVAL: '1' });
      expect(r.status).toBe(0);
      expect(r.out).not.toContain('WARNING');
    } finally {
      clean.close();
    }
  });

  it('/health keeps the database error in the log like /health/ready, Docker reads /health/ready on PORT, setup-domain waits for the start', () => {
    const appTs = read('src/app.ts');
    const health = appTs.slice(appTs.indexOf("app.get(['/api/health', '/health']"), appTs.indexOf("app.use('/api/woocommerce'"));
    expect(health).toContain("message: 'Database connection check failed'");
    expect(health).not.toMatch(/error:\s*err/);
    expect(health).toContain('logger.warn(`Health probe: database check failed');
    const docker = read('Dockerfile');
    expect(docker).toContain('CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health/ready"');
    expect(docker).not.toContain('/health/startup >/dev/null');
    const domain = read('setup-domain.sh');
    expect(domain).toContain('bash "$APP_DIR/scripts/verify-startup.sh" "$APP_PORT"');
    expect(domain).not.toContain('curl -fsS "http://127.0.0.1:${APP_PORT}/health/live"');
  });
});

describe('boot_migrates_once_o17: the boot runs the migrator once', () => {
  it('the seed step of the boot does not migrate again; factory reset and the tests still let the seed migrate', () => {
    expect(read('src/services/system/bootData.ts')).toContain('runSeedWithLock({ afterMigrations: true })');
    const seed = read('src/db/seed.ts');
    expect(seed).toMatch(/if \(!options\.afterMigrations\) \{\s+const migration = await \(options\.migrate \?\? runMigrations\)\(\);/);
    expect(read('src/services/system/factoryReset.service.ts')).toContain('await runSeed()');
  });
});
