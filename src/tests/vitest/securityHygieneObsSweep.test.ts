import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, getAuthToken, getCsrfToken, setAuthToken, setCsrfToken } from '../../api';
import { PUBLIC_USER_FIELDS, publicUserView } from '../../lib/auth/publicUser';

// v10.1.44 closing sweep, security hygiene: OBS-R2-18 (session tokens only from session answers),
// OBS-R1-28 (minimal user record in login, session check and profile), OBS-R2-12 (no raw database error in readiness).
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fetchMock = vi.fn();
const jsonAnswer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setAuthToken(null);
  setCsrfToken('csrf-before');
});

afterEach(() => {
  setAuthToken(null);
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('OBS-R2-18: the browser keeps session tokens only from session answers', () => {
  it('ignores token and csrfToken fields in a business answer', async () => {
    fetchMock.mockImplementation(() => jsonAnswer({ data: [], token: 'planted-token', csrfToken: 'planted-csrf' }));
    await fetchJson('/items');
    expect(getAuthToken()).toBeNull();
    expect(getCsrfToken()).toBe('csrf-before');
  });

  it('still takes them from the login answer', async () => {
    fetchMock.mockImplementation(() => jsonAnswer({ success: true, token: 'session-token', csrfToken: 'session-csrf' }));
    await fetchJson('/auth/login', { method: 'POST', body: '{}' });
    expect(getAuthToken()).toBe('session-token');
    expect(getCsrfToken()).toBe('session-csrf');
  });
});

describe('OBS-R1-28: the user record leaves internal columns out', () => {
  it('publicUserView carries only the fields the browser reads', () => {
    const row = {
      id: 7, username: 'sara', fullName: 'سارا', role: 'accountant', avatarUrl: '', mustResetPassword: 0,
      password: '$2b$hash', tokenVersion: 4, failedLoginCount: 2, lockedUntil: '2026-10-16', lastFailedLoginAt: 'x', isDeleted: 0,
    };
    const view = publicUserView(row);
    expect(Object.keys(view).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
    for (const hidden of ['password', 'tokenVersion', 'failedLoginCount', 'lockedUntil', 'lastFailedLoginAt', 'isDeleted']) {
      expect(view).not.toHaveProperty(hidden);
    }
    expect(view.full_name).toBe('سارا');
    expect(view.must_reset_password).toBe(false);
  });

  it('login, session check and profile answer through publicUserView, never a spread of the row', () => {
    for (const rel of ['src/routes/auth.routes.ts', 'src/routes/users.routes.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/password:\s*_\s*,\s*\.\.\./);
      expect(src).toContain('publicUserView(');
    }
  });
});

describe('OBS-R2-12: the public readiness probe sends no database error text', () => {
  it('the 503 answer of /health/ready has no error field', () => {
    const src = read('src/app.ts');
    const start = src.indexOf("reason: 'Database unreachable'");
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start - 200, start + 200);
    expect(block).not.toMatch(/error:\s*err/);
  });
});

describe('OBS-PR-09: plain secrets and non-bcrypt passwords show in the financial health check', () => {
  it('warns with counts only and names the one-off commands', async () => {
    const { buildSecretsAtRestHealthTest } = await import('../../services/system/secretsAtRestHealth');
    const bad = buildSecretsAtRestHealthTest({ plaintext: { personnel: 1, settings: 2, webhooks: 0 }, unreadable: 0, nonBcryptPasswords: 3 });
    expect(bad.id).toBe('secrets_at_rest');
    expect(bad.status).toBe('warning');
    expect(bad.count).toBe(6);
    expect(bad.items?.map(i => i.id)).toEqual(['plaintext_secrets', 'non_bcrypt_passwords']);
    expect(JSON.stringify(bad)).toContain('secrets:encrypt');
    const clean = buildSecretsAtRestHealthTest({ plaintext: { personnel: 0, settings: 0, webhooks: 0 }, unreadable: 0, nonBcryptPasswords: 0 });
    expect(clean.status).toBe('healthy');
    expect(read('src/services/accounting/financialHealth.service.ts')).toContain('countSecretsAtRest()');
  });
});

describe('OBS-R1-21: the Windows source package and stop script stay local', () => {
  it('the package leaves out local env files, backups, update logs and .claude', () => {
    const src = read('package-source.ps1');
    expect(src).toMatch(/'backups'/);
    expect(src).toMatch(/'\.claude'/);
    expect(src).toContain("$name -like '.env.*' -and $name -notlike '*.example'");
    expect(src).toContain("$name -like 'update-*.log'");
  });

  it('the stop script stops only node processes of this checkout', () => {
    expect(read('stop-local.ps1')).toContain('$_.CommandLine -match $rootPattern');
  });
});
