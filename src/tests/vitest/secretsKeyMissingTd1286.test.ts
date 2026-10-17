import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSecretsAtRestHealthTest } from '../../services/system/secretsAtRestHealth';

const ROOT = path.resolve(__dirname, '../../..');
const NONE = { plaintext: { personnel: 0, settings: 0, webhooks: 0 }, unreadable: 0, nonBcryptPasswords: 0 };

describe('secrets_key_missing_warns_td_1286', () => {
  it('warns when ERP_SECRETS_KEY is missing even with no stored secret', () => {
    const noKey = buildSecretsAtRestHealthTest({ ...NONE, keyConfigured: false });
    expect(noKey.status).toBe('warning');
    expect(noKey.count).toBe(1);
    expect(noKey.items?.map(i => i.id)).toEqual(['secrets_key_missing']);
    expect(noKey.items?.[0].details).toContain('scripts/ensure-env-secrets.sh');
    expect(noKey.metrics?.secretsKeyMissing).toBe(1);
  });

  it('stays healthy with the key set, and for older callers that do not report it', () => {
    expect(buildSecretsAtRestHealthTest({ ...NONE, keyConfigured: true }).status).toBe('healthy');
    expect(buildSecretsAtRestHealthTest(NONE).status).toBe('healthy');
  });

  it('counts the missing key beside stored problems', () => {
    const both = buildSecretsAtRestHealthTest({ ...NONE, plaintext: { personnel: 0, settings: 1, webhooks: 0 }, keyConfigured: false });
    expect(both.count).toBe(2);
    expect(both.items?.map(i => i.id)).toEqual(['secrets_key_missing', 'plaintext_secrets']);
  });
});

const UPDATE_SH = () => readFileSync(path.join(ROOT, 'update.sh'), 'utf8');

/** The ERP_SECRETS_KEY step of update.sh with its own log helpers, run on its own against a scratch app directory. */
function updateKeyStep(): string {
  const src = UPDATE_SH();
  const start = src.indexOf('# v10.1.68 (TD-1286)');
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf('\nfi\n', start);
  expect(end).toBeGreaterThan(start);
  // the step runs before the pre-update backup, so a failed update later on still leaves the key in place
  expect(start).toBeLessThan(src.indexOf('# ---------- 1) Pre-update database backup'));
  const helpers = src.split('\n').filter(l => /^(log|warn)\(\)/.test(l));
  expect(helpers).toHaveLength(2);
  return `${helpers.join('\n')}\n${src.slice(start, end + 4)}`;
}

function runStep(appDir: string): string {
  const prelude = ['set -euo pipefail', `APP_DIR=${JSON.stringify(appDir)}`, 'cd "$APP_DIR"'].join('\n');
  return execFileSync('bash', ['-c', `${prelude}\n${updateKeyStep()}`], { encoding: 'utf8' });
}

describe('update_adds_missing_secrets_key_td_1286', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  function scratchApp(env: string): string {
    dir = mkdtempSync(path.join(tmpdir(), 'td1286-'));
    mkdirSync(path.join(dir, 'scripts'));
    copyFileSync(path.join(ROOT, 'scripts/ensure-env-secrets.sh'), path.join(dir, 'scripts/ensure-env-secrets.sh'));
    writeFileSync(path.join(dir, '.env'), env);
    return dir;
  }
  const envOf = (app: string) => readFileSync(path.join(app, '.env'), 'utf8');

  it('adds only ERP_SECRETS_KEY to a .env without it and keeps the existing values', () => {
    const app = scratchApp('PORT=3000\nJWT_SECRET=keep-me');
    const out = runStep(app);
    const env = envOf(app);
    expect(env).toMatch(/^ERP_SECRETS_KEY=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^JWT_SECRET=keep-me$/m);
    // the echo token would replace the stored one and the metrics token would start monitor alerts
    expect(env).not.toContain('ERP_WEBHOOK_SECRET_TOKEN');
    expect(env).not.toContain('METRICS_TOKEN');
    expect(out).toContain('ERP_SECRETS_KEY was missing and has been added');
    expect(out).toContain('off this server');
    expect(out).not.toMatch(/[0-9a-f]{64}/);
  });

  it.each([
    'ERP_SECRETS_KEY=existing',
    'export ERP_SECRETS_KEY=existing',
    '  ERP_SECRETS_KEY="existing"',
    "ERP_SECRETS_KEY = 'existing'",
  ])('leaves a key already present as %j untouched and stays silent', line => {
    const before = `PORT=3000\n${line}\n`;
    const app = scratchApp(before);
    expect(runStep(app)).toBe('');
    expect(envOf(app)).toBe(before);
  });

  it.each(['ERP_SECRETS_KEY=', 'ERP_SECRETS_KEY=""'])('warns and keeps an empty key line %j as it is', line => {
    const before = `PORT=3000\n${line}\n`;
    const app = scratchApp(before);
    expect(runStep(app)).toContain('ERP_SECRETS_KEY is empty in .env and was left as it is');
    expect(envOf(app)).toBe(before);
  });

  it('ensure-env-secrets.sh still adds every missing key without a key list and refuses an unknown key', () => {
    const app = scratchApp('PORT=3000\n');
    const script = path.join(app, 'scripts/ensure-env-secrets.sh');
    execFileSync('bash', [script, path.join(app, '.env')], { encoding: 'utf8' });
    for (const key of ['ERP_SECRETS_KEY', 'ERP_WEBHOOK_SECRET_TOKEN', 'METRICS_TOKEN']) expect(envOf(app)).toMatch(new RegExp(`^${key}=[0-9a-f]{64}$`, 'm'));
    expect(() => execFileSync('bash', [script, path.join(app, '.env'), 'JWT_SECRET'], { stdio: 'pipe' })).toThrow();
  });
});
