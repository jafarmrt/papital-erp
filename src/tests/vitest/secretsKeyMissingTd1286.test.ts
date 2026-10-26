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

/**
 * v11 (O10, O17): update.sh adds the generated keys a server lacks through update_refresh_ops_config of
 * scripts/update-steps.sh, right before the restart (so a run stopped earlier leaves .env as it was); run here on its own
 * against a scratch app directory, with the cron file in the scratch directory too.
 */
function runStep(appDir: string): string {
  const code = [
    'set -euo pipefail',
    `source ${JSON.stringify(path.join(ROOT, 'scripts/update-steps.sh'))}`,
    `update_refresh_ops_config ${JSON.stringify(appDir)}`,
    'for n in "${UPDATE_OPS_NOTES[@]}"; do case "$n" in WARN:*|Added*) echo "$n" ;; esac; done',
  ].join('\n');
  return execFileSync('bash', ['-c', code], { encoding: 'utf8', env: { ...process.env, CRON_FILE: path.join(appDir, 'cron.d/papital-erp') } });
}

describe('update_adds_missing_secrets_key_td_1286', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  function scratchApp(env: string): string {
    dir = mkdtempSync(path.join(tmpdir(), 'td1286-'));
    mkdirSync(path.join(dir, 'scripts'));
    for (const f of ['ensure-env-secrets.sh', 'install-ops-cron.sh', 'backup.sh']) copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
    writeFileSync(path.join(dir, '.env'), env);
    return dir;
  }
  const envOf = (app: string) => readFileSync(path.join(app, '.env'), 'utf8');

  it('adds ERP_SECRETS_KEY and METRICS_TOKEN to a .env without them and keeps the existing values', () => {
    const app = scratchApp('PORT=3000\nJWT_SECRET=keep-me');
    const out = runStep(app);
    const env = envOf(app);
    expect(env).toMatch(/^ERP_SECRETS_KEY=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^METRICS_TOKEN=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^JWT_SECRET=keep-me$/m);
    // the echo token would replace the one the settings hold
    expect(env).not.toContain('ERP_WEBHOOK_SECRET_TOKEN');
    expect(out).toContain('Added to .env: ERP_SECRETS_KEY METRICS_TOKEN');
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
    const before = `PORT=3000\n${line}\nMETRICS_TOKEN=present\n`;
    const app = scratchApp(before);
    expect(runStep(app).split('\n').filter(l => l && !l.includes('cron file'))).toEqual([]);
    expect(envOf(app)).toBe(before);
  });

  it.each(['ERP_SECRETS_KEY=', 'ERP_SECRETS_KEY=""'])('warns and keeps an empty key line %j as it is', line => {
    const before = `PORT=3000\n${line}\nMETRICS_TOKEN=present\n`;
    const app = scratchApp(before);
    expect(runStep(app)).toContain('ERP_SECRETS_KEY is empty in .env and was left as it is');
    expect(envOf(app)).toBe(before);
  });

  it('update.sh adds them right before the restart, not before its tool checks (O17)', () => {
    const update = readFileSync(path.join(ROOT, 'update.sh'), 'utf8');
    expect(update).not.toContain('ensure-env-secrets.sh "$APP_DIR/.env"');
    const refresh = update.indexOf('update_refresh_ops_config "$APP_DIR"');
    expect(refresh).toBeGreaterThan(update.indexOf('command -v rsync'));
    expect(refresh).toBeLessThan(update.indexOf('log "[5/6] Restarting service..."'));
  });

  it('ensure-env-secrets.sh still adds every missing key without a key list and refuses an unknown key', () => {
    const app = scratchApp('PORT=3000\n');
    const script = path.join(app, 'scripts/ensure-env-secrets.sh');
    execFileSync('bash', [script, path.join(app, '.env')], { encoding: 'utf8' });
    for (const key of ['ERP_SECRETS_KEY', 'ERP_WEBHOOK_SECRET_TOKEN', 'METRICS_TOKEN']) expect(envOf(app)).toMatch(new RegExp(`^${key}=[0-9a-f]{64}$`, 'm'));
    expect(() => execFileSync('bash', [script, path.join(app, '.env'), 'JWT_SECRET'], { stdio: 'pipe' })).toThrow();
  });
});
