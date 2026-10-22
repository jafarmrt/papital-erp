import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v10.2.26 (#339 review N-C, TD-1351): restore.sh and upgrade-rehearsal.sh put the database URL with its password on the
// psql / pg_restore command line during `update.sh --rehearse`, readable by every user in the process list. They now
// source scripts/pg-password.sh, which moves the password into a PGPASSFILE (mode 600) and strips it from the URLs.

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

const setup = (env: Record<string, string>) => {
  dir = mkdtempSync(path.join(tmpdir(), 'pg-password-'));
  const r = spawnSync('bash', ['-c', `set -euo pipefail
. "$1/scripts/pg-password.sh"
pg_password_setup "$2"
printf '%s\\n%s\\n%s\\n%s\\n' "$DATABASE_URL" "\${RESTORE_ADMIN_URL:-}" "$PG_FULL_DATABASE_URL" "$PGPASSFILE"`, 'x', ROOT, dir], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  const [url, admin, full, passfile] = r.stdout.split('\n');
  return { url, admin, full, passfile, pgpass: readFileSync(passfile, 'utf8') };
};

describe('pg_password_file_td_1351', () => {
  it('moves the passwords of both URLs into a private PGPASSFILE and keeps the full URL for Node', () => {
    const app = 'postgresql://papital:s3cr%3Aet+1%5Cc@localhost:5432/papital_erp?sslmode=disable';
    const s = setup({ DATABASE_URL: app, RESTORE_ADMIN_URL: 'postgres://postgres:adm%40in@[::1]:5433/postgres' });
    expect(s.url).toBe('postgresql://papital@localhost:5432/papital_erp?sslmode=disable');
    expect(s.admin).toBe('postgres://postgres@[::1]:5433/postgres');
    expect(s.full).toBe(app);
    expect(s.passfile).toBe(path.join(dir, 'pgpass'));
    // a colon or backslash in a field is escaped, an IPv6 host included
    expect(s.pgpass).toBe('localhost:5432:*:papital:s3cr\\:et+1\\\\c\n\\:\\:1:5433:*:postgres:adm@in\n');
    expect(statSync(s.passfile).mode & 0o777).toBe(0o600);
  });

  it('keeps the lines of an inherited PGPASSFILE and leaves a URL without a password as it is', () => {
    const inherited = mkdtempSync(path.join(tmpdir(), 'pg-password-parent-'));
    try {
      writeFileSync(path.join(inherited, 'pgpass'), 'db:5432:*:app:fromparent\n');
      const s = setup({ DATABASE_URL: 'postgresql://app@db:5432/erp', PGPASSFILE: path.join(inherited, 'pgpass') });
      expect(s.url).toBe('postgresql://app@db:5432/erp');
      expect(s.pgpass).toBe('db:5432:*:app:fromparent\n');
    } finally {
      rmSync(inherited, { recursive: true, force: true });
    }
  });

  it('restore.sh and upgrade-rehearsal.sh set it up before their first database call', () => {
    for (const file of ['scripts/restore.sh', 'scripts/upgrade-rehearsal.sh']) {
      const text = read(file);
      const setupAt = text.indexOf('pg_password_setup "$WORK_DIR"');
      expect(setupAt, file).toBeGreaterThan(0);
      // the cleanup trap that removes WORK_DIR is set before the password file is written (#346 review M1)
      const trapAt = text.indexOf('trap cleanup EXIT');
      expect(trapAt, file).toBeGreaterThan(text.indexOf('WORK_DIR="$(mktemp -d)"'));
      expect(trapAt, file).toBeLessThan(setupAt);
      const firstCall = Math.min(...['psql "$', 'pg_restore --'].map(c => text.indexOf(c, trapAt)).filter(i => i >= 0));
      expect(setupAt, file).toBeLessThan(firstCall);
    }
    // the migrations of the rehearsal still get the password, through their environment
    expect(read('scripts/upgrade-rehearsal.sh')).toContain('DATABASE_URL="$(url_for_db "$DRILL_DB" "$PG_FULL_DATABASE_URL")" "$TSX"');
  });

  it('restore.sh that stops before the restore leaves no password file behind (#346 review M1)', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-password-early-'));
    const bin = path.join(dir, 'bin');
    const tmp = path.join(dir, 'tmp');
    mkdirSync(bin);
    mkdirSync(tmp);
    // the role check answers nothing: no CREATEDB, and sudo is not allowed, so restore.sh stops at once
    writeFileSync(path.join(bin, 'psql'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(path.join(bin, 'psql'), 0o755);
    const dump = path.join(dir, 'erp_x.dump.gz');
    writeFileSync(dump, '');
    const r = spawnSync('bash', [path.join(ROOT, 'scripts/restore.sh'), dump], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, TMPDIR: tmp, APP_DIR: ROOT, RESTORE_ALLOW_SUDO: '0',
        DATABASE_URL: 'postgresql://papital:early-secret@localhost:5432/papital_erp' },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('cannot create databases');
    expect(readdirSync(tmp)).toEqual([]);
  });
});
