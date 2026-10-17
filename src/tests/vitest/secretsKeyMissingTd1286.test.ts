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

/** The ERP_SECRETS_KEY step of update.sh, run on its own against a scratch app directory. */
function updateKeyStep(): string {
  const src = readFileSync(path.join(ROOT, 'update.sh'), 'utf8');
  const start = src.indexOf('# v10.1.67 (TD-1286)');
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf('\nfi\n', start);
  expect(end).toBeGreaterThan(start);
  // the step runs before the pre-update backup, so a failed update later on still leaves the key in place
  expect(start).toBeLessThan(src.indexOf('# ---------- 1) Pre-update database backup'));
  return src.slice(start, end + 4);
}

function runStep(appDir: string): string {
  const prelude = [
    'set -euo pipefail',
    'warn() { echo "WARN: $*"; }',
    `APP_DIR=${JSON.stringify(appDir)}`,
    'cd "$APP_DIR"',
    'env_file_value() { [ -f .env ] || return 0; grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }',
  ].join('\n');
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

  it('adds ERP_SECRETS_KEY to a .env without it and keeps the existing values', () => {
    const app = scratchApp('PORT=3000\nJWT_SECRET=keep-me\nERP_WEBHOOK_SECRET_TOKEN=keep-token\n');
    const out = runStep(app);
    const env = readFileSync(path.join(app, '.env'), 'utf8');
    expect(env).toMatch(/^ERP_SECRETS_KEY=[0-9a-f]{64}$/m);
    expect(env).toContain('JWT_SECRET=keep-me\n');
    expect(env).toContain('ERP_WEBHOOK_SECRET_TOKEN=keep-token\n');
    expect(out).toContain('ERP_SECRETS_KEY was missing and has been added');
    expect(out).not.toMatch(/[0-9a-f]{64}/);
  });

  it('leaves a .env that already has the key untouched and silent', () => {
    const before = 'PORT=3000\nERP_SECRETS_KEY=existing\n';
    const app = scratchApp(before);
    expect(runStep(app)).toBe('');
    expect(readFileSync(path.join(app, '.env'), 'utf8')).toBe(before);
  });

  it('warns and keeps an empty key line as it is', () => {
    const app = scratchApp('PORT=3000\nERP_SECRETS_KEY=\n');
    const out = runStep(app);
    expect(out).toContain('ERP_SECRETS_KEY is not set in .env and could not be added');
    expect(readFileSync(path.join(app, '.env'), 'utf8')).toMatch(/^ERP_SECRETS_KEY=$/m);
  });
});
