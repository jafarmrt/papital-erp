// @vitest-environment node
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Package 1, PR «ح» (lane 4): build, packaging, deployment documentation, audit gate, lock order and the generated
// secrets of a Linux install. Test names are English (terminal output).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p01h-'));
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

describe('build_skips_public_uploads_td_588: attachments never enter dist/, an image or a source package (B01-08)', () => {
  it('copyPublicAssets copies public/ without uploads/', async () => {
    const { copyPublicAssets } = await import('../../../scripts/publicAssets');
    const dir = tmp();
    const pub = path.join(dir, 'public');
    fs.mkdirSync(path.join(pub, 'uploads', '.attachments'), { recursive: true });
    fs.mkdirSync(path.join(pub, 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(pub, 'uploads', '.attachments', 'payslip.pdf'), 'secret');
    fs.writeFileSync(path.join(pub, 'uploads', 'logo.png'), 'png');
    fs.writeFileSync(path.join(pub, 'fonts', 'a.woff2'), 'font');
    fs.writeFileSync(path.join(pub, 'favicon.svg'), 'svg');
    const out = path.join(dir, 'dist');
    expect(copyPublicAssets(pub, out)).toBe(2);
    expect(fs.existsSync(path.join(out, 'fonts', 'a.woff2'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'favicon.svg'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'uploads'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('vite copies public/ only through that helper; .dockerignore and package-source.ps1 leave uploads out', () => {
    const vite = read('vite.config.ts');
    expect(vite).toMatch(/copyPublicDir:\s*false/);
    expect(vite).toContain('copyPublicAssets(');
    expect(read('.dockerignore').split('\n')).toContain('public/uploads');
    expect(read('package-source.ps1')).toMatch(/public\\uploads/);
  });
});

describe('zip_update_documented_td_604: the zip update instruction matches update.sh (B01-24)', () => {
  it('DEPLOY_LINUX.md gives update.sh --zip and no longer says to extract over the app directory', () => {
    const doc = read('deploy/DEPLOY_LINUX.md');
    expect(doc).toMatch(/update\.sh --zip /);
    expect(doc).not.toContain('extract کنید و سپس');
  });
});

describe('audit_gate_fails_on_npm_error_td_607: the dependency gate fails when npm audit itself fails (B01-27)', () => {
  const gate = (input: string) => spawnSync(TSX, ['scripts/audit-gate.ts'], { cwd: ROOT, input, encoding: 'utf8' });

  it('an npm error object fails the gate', () => {
    const r = gate(JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }));
    expect(r.status).toBe(1);
    expect(`${r.stderr}`).toContain('ENOLOCK');
  });

  it('output without a vulnerability list fails the gate', () => {
    expect(gate('{}').status).toBe(1);
  });

  it('a report without high or critical findings passes and a high finding fails', () => {
    expect(gate(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} })).status).toBe(0);
    const high = { auditReportVersion: 2, vulnerabilities: { x: { severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high', title: 't' }] } } };
    expect(gate(JSON.stringify(high)).status).toBe(1);
  });
});

describe('lock_order_same_everywhere_td_618: withOrderedLocks behaves the same in every environment (B01-38)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  const mockTx = (calls: string[]) => ({
    select: () => ({ from: (table: { [k: symbol]: unknown }) => ({ where: () => ({ for: (mode: string) => {
      calls.push(`${String(table[Symbol.for('drizzle:Name')])}:${mode}`);
      return Promise.resolve([]);
    } }) }) }),
  });

  for (const env of ['test', 'production']) {
    it(`NODE_ENV=${env}: resources given out of order are sorted, and a table without a lock level is refused`, async () => {
      vi.stubEnv('NODE_ENV', env);
      const { withOrderedLocks } = await import('../../lib/lockOrder');
      const { items, documents, pieceworkPayrolls } = await import('../../db/schema');
      const calls: string[] = [];
      await withOrderedLocks(mockTx(calls), [
        { table: documents, id: 5, name: 'documents' },
        { table: items, ids: [9, 2], name: 'items' },
      ], async () => true);
      expect(calls).toEqual(['items:no key update', 'items:no key update', 'documents:update']);
      await expect(withOrderedLocks(mockTx([]), [{ table: pieceworkPayrolls, id: 1, name: 'piecework_payrolls' }], async () => true))
        .rejects.toThrow(/no lock level for piecework_payrolls/);
    });

    it(`NODE_ENV=${env}: validateLockOrder refuses a declared sequence out of order`, async () => {
      vi.stubEnv('NODE_ENV', env);
      const { validateLockOrder } = await import('../../lib/lockOrder');
      expect(() => validateLockOrder([{ name: 'cheque', hierarchyLevel: 20 }, { name: 'bank', hierarchyLevel: 10 }])).toThrow(/Lock order violation/);
    });
  }
});

describe('install_env_has_secrets_td_609: a Linux install writes the secrets the checks require (B01-29)', () => {
  /** The .env heredoc of install.sh, rendered by bash with its variables */
  function installEnv(dir: string): string {
    const install = read('install.sh');
    const body = install.slice(install.indexOf('cat > .env <<ENV\n') + 'cat > .env <<ENV\n'.length, install.indexOf('\nENV\n'));
    const file = path.join(dir, '.env');
    const script = `APP_PORT=3000; DB_USER=u; DB_PASS=p; DB_NAME=d\ncat > "${file}" <<ENV\n${body}\nENV\n`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return file;
  }

  it('the .env of a new install passes audit-env.sh, ERP_SECRETS_KEY included', () => {
    const dir = tmp();
    const env = installEnv(dir);
    const ensure = spawnSync('bash', [path.join(ROOT, 'scripts/ensure-env-secrets.sh'), env], { encoding: 'utf8' });
    expect(ensure.status).toBe(0);
    const audit = spawnSync('bash', ['-c', `set -a; . "${env}"; set +a; bash "${path.join(ROOT, 'scripts/audit-env.sh')}"`], { encoding: 'utf8' });
    expect(`${audit.stdout}${audit.stderr}`).not.toContain('MISSING');
    expect(audit.status).toBe(0);
    expect(read('install.sh')).toContain('bash scripts/ensure-env-secrets.sh .env');
    expect(read('scripts/audit-env.sh')).toMatch(/REQUIRED_VARS=\([^)]*ERP_SECRETS_KEY/);
    expect(read('scripts/go-live-verify.sh')).toContain('ERP_SECRETS_KEY');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensure-env-secrets.sh adds only missing keys, keeps existing values and is idempotent', () => {
    const dir = tmp();
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'NODE_ENV=production\nERP_WEBHOOK_SECRET_TOKEN=keep-me', { mode: 0o644 });
    const run = () => spawnSync('bash', [path.join(ROOT, 'scripts/ensure-env-secrets.sh'), env], { encoding: 'utf8' });
    expect(run().status).toBe(0);
    const first = fs.readFileSync(env, 'utf8');
    expect(first).toMatch(/^ERP_SECRETS_KEY=[0-9a-f]{64}$/m);
    expect(first).toContain('ERP_WEBHOOK_SECRET_TOKEN=keep-me\n');
    expect((fs.statSync(env).mode & 0o777).toString(8)).toBe('600');
    expect(run().status).toBe(0);
    expect(fs.readFileSync(env, 'utf8')).toBe(first);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
