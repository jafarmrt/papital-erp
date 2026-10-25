// @vitest-environment node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { baselineUpdateRefusals } from '../../../scripts/eslint-ratchet';
import { REAL_EXECUTION_TYPES, realExecutionCount, runnerExitCode } from '../runnerOutcome';

// Tooling observations of the series 9 ledger (docs/audit/V9_OBSERVATIONS.md): go-live checks, ratchet update,
// test runner exit code and label, simulator guard, route table script, ESLint money paths, CHANGELOG.md lines,
// the session-start hook and the port reading of setup-domain.sh. Test names are English (terminal output).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const baseEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? os.tmpdir() });

function runAsync(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; out: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env, cwd: ROOT });
    let out = '';
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { out += String(d); });
    child.on('close', status => resolve({ status, out }));
  });
}

describe('obs_r1_18_go_live_signals: go-live-verify fails an unstarted server and can pass /metrics with METRICS_TOKEN', () => {
  const TOKEN = 'metrics-token-for-the-test';

  async function verify(startupStatus: number, startupBody: string): Promise<string> {
    const server = http.createServer((req, res) => {
      const send = (code: number, body: string) => { res.writeHead(code); res.end(body); };
      if (req.url === '/health/live') return send(200, '{"status":"alive"}');
      if (req.url === '/health/ready') return send(200, '{"status":"ready"}');
      if (req.url === '/health/startup') return send(startupStatus, startupBody);
      if (req.url === '/health') return send(200, '{"status":"ok","version":"0.0.1"}');
      if (req.url === '/metrics') {
        return req.headers['x-metrics-token'] === TOKEN ? send(200, '# HELP erp_up test\n# TYPE erp_up gauge\nerp_up 1\n') : send(401, '{}');
      }
      return send(404, '{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const dir = tmp('golive');
    const backups = path.join(dir, 'backups');
    fs.mkdirSync(backups, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"0.0.1"}');
    fs.writeFileSync(path.join(dir, '.env'), [
      'NODE_ENV=production',
      'DATABASE_URL=postgres://u:p@127.0.0.1:1/none',
      `BACKUP_DIR=${backups}`,
      `METRICS_TOKEN=${TOKEN}`,
      '',
    ].join('\n'));
    try {
      const r = await runAsync('bash', [path.join(ROOT, 'scripts/go-live-verify.sh'), `http://127.0.0.1:${port}`],
        { ...baseEnv(), APP_DIR: dir, SERVICE_NAME: 'papital-erp-go-live-test' });
      return r.out;
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a /health/startup that answers 503 "starting" is a FAIL, not a WARN', async () => {
    const out = await verify(503, '{"status":"starting"}');
    expect(out).toMatch(/\[FAIL\] \/health\/startup not started/);
    expect(out).not.toMatch(/\[PASS\] \/health\/startup/);
  });

  it('a started server passes the startup probe, and /metrics passes when read with METRICS_TOKEN of .env', async () => {
    const out = await verify(200, '{"status":"started"}');
    expect(out).toMatch(/\[PASS\] \/health\/startup started/);
    expect(out).toMatch(/\[PASS\] \/metrics serving Prometheus format/);
  });

  it('a missing backup cron entry names scripts/install-ops-cron.sh, which installs it', () => {
    expect(read('scripts/go-live-verify.sh')).toContain('bad "No backup cron entry found (sudo bash scripts/install-ops-cron.sh');
    expect(read('scripts/install-ops-cron.sh')).toContain('scripts/backup.sh >> ');
  });
});

describe('obs_r1_20_eslint_update_refuses_growth: lint:eslint --update never raises a baseline count', () => {
  it('refuses a grown rule count, not only a grown any count', () => {
    expect(baselineUpdateRefusals({ 'max-lines': 5 }, { 'max-lines': 4 }, {}, {})).toEqual(['max-lines: 4 → 5']);
    expect(baselineUpdateRefusals({ 'new-rule': 1 }, {}, {}, {})).toEqual(['new-rule: 0 → 1']);
    expect(baselineUpdateRefusals({}, {}, { 'src/a.ts': 2 }, { 'src/a.ts': 1 })).toEqual(['src/a.ts: any 1 → 2']);
  });

  it('accepts lower or equal counts and writes a missing baseline as it is', () => {
    expect(baselineUpdateRefusals({ 'max-lines': 3 }, { 'max-lines': 4 }, { 'src/a.ts': 1 }, { 'src/a.ts': 2 })).toEqual([]);
    expect(baselineUpdateRefusals({ 'max-lines': 9 }, null, { 'src/a.ts': 9 }, null)).toEqual([]);
    expect(read('scripts/eslint-ratchet.ts')).toMatch(/const refusals = baselineUpdateRefusals\(/);
  });
});

describe('obs_r1_23_obs_r2_114_runner_outcome: run-tests --json fails a failed run, and real execution counts every real type', () => {
  it('runnerExitCode is 1 for a failed test, an unfinished run or no test, else 0', () => {
    expect(runnerExitCode({ totalTests: 3, failedCount: 1, overallStatus: 'failed' })).toBe(1);
    expect(runnerExitCode({ totalTests: 3, failedCount: 0, overallStatus: 'incomplete' })).toBe(1);
    expect(runnerExitCode({ totalTests: 0, failedCount: 0, overallStatus: 'passed' })).toBe(1);
    expect(runnerExitCode({ totalTests: 3, failedCount: 0, overallStatus: 'passed' })).toBe(0);
  });

  it('the --json branch of run-tests.ts sets that exit code', () => {
    const src = read('scripts/run-tests.ts');
    const jsonBranch = src.slice(src.indexOf('if (isJsonOutput) {\n      const jsonReport'), src.indexOf('} else {', src.indexOf('const jsonReport')));
    expect(jsonBranch).toContain('process.exitCode = runnerExitCode(report);');
  });

  it('real_database, real_api and real_code count as real execution; only simulation_logic does not', () => {
    expect(realExecutionCount([
      { executionType: 'real_database' }, { executionType: 'real_api' }, { executionType: 'real_code' }, { executionType: 'simulation_logic' },
    ])).toBe(3);
    expect(REAL_EXECUTION_TYPES.has('simulation_logic')).toBe(false);
    const src = read('scripts/run-tests.ts');
    expect(src).toContain('const realCodeCases = realExecutionCount(report.testCases);');
    expect(src).not.toContain("executionType === 'real_code'");
    expect(src).not.toContain('Real Code Ratio');
  });
});

describe('obs_r1_24_simulator_env_guard: simulate:year refuses NODE_ENV production before touching a database', () => {
  it('stops with the test runner environment error', async () => {
    const r = await runAsync(TSX, [path.join(ROOT, 'scripts/simulate-business-year.ts'), '--steps=1'], {
      ...baseEnv(), NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none',
    });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('Test runner can only run in test/development environment. Current: production');
    expect(r.out).not.toContain('Simulating seed');
  }, 120_000);
});

describe('obs_r2_112_route_table_without_env: routes:permissions runs without a test environment', () => {
  it('prints the route table with no JWT_SECRET set', async () => {
    const r = await runAsync(TSX, [path.join(ROOT, 'scripts/route-permissions.ts')], baseEnv());
    expect(r.out).not.toContain('JWT_SECRET environment variable is missing');
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/\| GET \| `\/api\/[^`]+` \|/);
  }, 120_000);
});

describe('obs_r2_116_money_stock_paths_exist: every MONEY_STOCK_PATHS glob of eslint.config.js matches a file', () => {
  const globRegex = (glob: string) => new RegExp(`^${glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')}$`);
  const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });

  it('has no stale glob', () => {
    const config = read('eslint.config.js');
    const block = config.slice(config.indexOf('export const MONEY_STOCK_PATHS = ['), config.indexOf('];', config.indexOf('MONEY_STOCK_PATHS')));
    const globs = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(globs.length).toBeGreaterThan(20);
    const files = walk('src');
    const stale = globs.filter(g => !files.some(f => globRegex(g).test(f)));
    expect(stale).toEqual([]);
  });
});

describe('obs_r2_117_changelog_md_lines: CHANGELOG.md list lines start with a single dash', () => {
  it('has no line starting with "- - "', () => {
    const doubled = read('CHANGELOG.md').split('\n').filter(l => l.startsWith('- - '));
    expect(doubled).toEqual([]);
  });
});

describe('ot_b_04_session_hook_npm_ci: the session-start hook reinstalls node_modules only when dependencies change', () => {
  const HOOK = path.join(ROOT, '.claude/hooks/ensure-node-modules.sh');

  function project(lock: object): { dir: string; npmLog: string; env: NodeJS.ProcessEnv } {
    const dir = tmp('hook');
    const bin = path.join(dir, '.bin');
    fs.mkdirSync(bin);
    const npmLog = path.join(dir, 'npm.log');
    // stub npm: records the call and lays down node_modules like npm ci does
    fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash\necho "$*" >> "${npmLog}"\nrm -rf node_modules\nmkdir -p node_modules\necho '{}' > node_modules/.package-lock.json\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    return { dir, npmLog, env: { ...baseEnv(), PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` } };
  }
  const lockOf = (version: string, dep: string) => ({ name: 'x', version, lockfileVersion: 3, packages: { '': { name: 'x', version, dependencies: { a: dep } }, 'node_modules/a': { version: dep } } });
  const run = (p: { dir: string; env: NodeJS.ProcessEnv }) => spawnSync('bash', [HOOK, p.dir], { env: p.env, encoding: 'utf8' });
  const npmCalls = (log: string) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);

  it('installs when node_modules is missing, then skips a release that only bumps the version', () => {
    const p = project(lockOf('10.1.1', '1.0.0'));
    expect(run(p).status).toBe(0);
    expect(npmCalls(p.npmLog)).toBe(1);
    // a release rewrites package-lock.json (newer mtime) with only the root version changed
    fs.writeFileSync(path.join(p.dir, 'package-lock.json'), JSON.stringify(lockOf('10.1.2', '1.0.0')));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(p.dir, 'package-lock.json'), future, future);
    const second = run(p);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('node_modules matches the dependencies of package-lock.json');
    expect(npmCalls(p.npmLog)).toBe(1);
    // a dependency change installs again
    fs.writeFileSync(path.join(p.dir, 'package-lock.json'), JSON.stringify(lockOf('10.1.2', '2.0.0')));
    expect(run(p).status).toBe(0);
    expect(npmCalls(p.npmLog)).toBe(2);
    fs.rmSync(p.dir, { recursive: true, force: true });
  });

  it('session-start.sh delegates the decision and never runs npm ci on its own', () => {
    const hook = read('.claude/hooks/session-start.sh');
    expect(hook).toContain('bash .claude/hooks/ensure-node-modules.sh .');
    expect(hook).not.toContain('npm ci --no-audit');
  });
});

describe('ot_a_08_setup_domain_port: setup-domain.sh proxies to PORT of .env', () => {
  const script = read('setup-domain.sh');
  const block = script.slice(script.indexOf('if [ -z "$APP_PORT" ]; then'), script.indexOf('APP_PORT="${APP_PORT:-3000}"') + 'APP_PORT="${APP_PORT:-3000}"'.length);

  const portFor = (envFile: string | null, appPort = ''): string => {
    const dir = tmp('domain');
    if (envFile !== null) fs.writeFileSync(path.join(dir, '.env'), envFile);
    else fs.writeFileSync(path.join(dir, '.env'), 'NODE_ENV=production\n');
    // v11 (O5): the block reads .env through scripts/env-file.sh, which setup-domain.sh sources at its top
    const r = spawnSync('bash', ['-c', `set -euo pipefail\nsource "$3"\nAPP_DIR="$1"\nAPP_PORT="$2"\n${block}\nprintf '%s' "$APP_PORT"`, 'x', dir, appPort, path.join(ROOT, 'scripts/env-file.sh')], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    return r.stdout;
  };

  it('reads PORT, with or without quotes, ignores a commented line and falls back to 3000', () => {
    expect(portFor('NODE_ENV=production\nPORT=4100\n')).toBe('4100');
    expect(portFor('PORT="4200"\n')).toBe('4200');
    expect(portFor("# PORT=9999\nPORT='4300'\n")).toBe('4300');
    expect(portFor(null)).toBe('3000');
    expect(portFor('PORT=4100\n', '5000')).toBe('5000');
    // v11 (O5): as the service reads it, the later line wins and an inline comment is dropped
    expect(portFor('PORT=3000\n  export PORT=4400 # later\n')).toBe('4400');
  });

  it('the Nginx site, ALLOWED_ORIGINS and the health check use that port', () => {
    expect(script).toContain('proxy_pass http://127.0.0.1:${APP_PORT};');
    expect(script).toContain('http://127.0.0.1:${APP_PORT}/health/live');
    expect(script).not.toMatch(/127\.0\.0\.1:3000|localhost:3000/);
  });
});
