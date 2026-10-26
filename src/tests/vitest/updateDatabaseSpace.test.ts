import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v11 (phase 4, card ت۵۳ question 5): a migration that changes a column type rewrites its table, so update.sh refuses
// to start when the disk of the database has less free space than twice the database.

const ROOT = path.resolve(__dirname, '../../..');
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

function app(env: string) {
  dir = mkdtempSync(path.join(tmpdir(), 'dbspace-'));
  const appDir = path.join(dir, 'app');
  const pgDir = path.join(dir, 'postgresql');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(pgDir, { recursive: true });
  writeFileSync(path.join(appDir, '.env'), env);
  return { appDir, pgDir };
}

function check(appDir: string, env: Record<string, string>) {
  const script = `source "${path.join(ROOT, 'scripts/update-steps.sh')}"
update_database_space_check "${appDir}" \${AFTER:-0} && echo "ok" || { echo "refused"; echo "$UPDATE_DB_SPACE_MESSAGE"; }
echo "need=$UPDATE_DB_SPACE_NEED_KB free=$UPDATE_DB_SPACE_FREE_KB"`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, UPDATE_SPACE_NEED_KB: '0', ...env } }).stdout;
}

const freeKb = (folder: string) => Number(spawnSync('bash', ['-c', `df -Pk "${folder}" | awk 'NR == 2 { print $4 }'`], { encoding: 'utf8' }).stdout.trim());

describe('update_database_space_check', () => {
  it('passes with room for twice the database on its disk and refuses below that', () => {
    const { appDir, pgDir } = app('DATABASE_URL=postgresql://erp:secret@localhost:5432/papital_erp\n');
    const ok = check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: String(23 * 1024 * 1024) });
    expect(ok).toContain('ok');
    expect(ok).toContain(`need=${23 * 2 * 1024} free=`);

    const huge = String(freeKb(pgDir) * 1024);
    const refused = check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: huge });
    expect(refused).toContain('refused');
    expect(refused).toContain('Not enough free disk space for the database migrations');
    expect(refused).toContain(`the disk of the database (${pgDir}, mounted at`);
    expect(refused).toContain('twice the database');
    expect(refused).toContain('Nothing was changed');

    const after = check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: huge, AFTER: '1' });
    expect(after).toContain('the new source are in place; the running build and the service are untouched');
  });

  it("counts the update's own need first when the database shares the application's disk", () => {
    const { appDir, pgDir } = app('DATABASE_URL=postgresql://erp:secret@127.0.0.1/papital_erp\n');
    const free = freeKb(pgDir);
    const out = check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: String(1024 * 1024), UPDATE_SPACE_NEED_KB: String(free) });
    expect(out).toContain('refused');
  });

  it('finds the database folder only for a database on this server, or where UPDATE_DB_DATA_DIR says', () => {
    const local = ['postgresql://erp:secret@[::1]:5432/db', 'postgres://erp@localhost/db', 'postgresql:///db?host=/var/run/postgresql'];
    for (const url of local) {
      const { appDir, pgDir } = app(`DATABASE_URL=${url}\n`);
      expect(check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: '1024' }), url).toContain('need=2 ');
      rmSync(dir, { recursive: true, force: true });
    }
    const remote = app('DATABASE_URL=postgresql://erp:secret@db.example.net:5432/db\n');
    expect(check(remote.appDir, { UPDATE_PG_DIR: remote.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('ok\nneed= free=');
    expect(check(remote.appDir, { UPDATE_DB_DATA_DIR: remote.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('need=2 ');
    rmSync(dir, { recursive: true, force: true });

    const sqlHost = app('SQL_HOST=localhost\nSQL_DB_NAME=papital_erp\n');
    expect(check(sqlHost.appDir, { UPDATE_PG_DIR: sqlHost.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('need=2 ');
    expect(check(sqlHost.appDir, { UPDATE_PG_DIR: path.join(dir, 'none'), UPDATE_DB_BYTES: '1024' })).toContain('ok\nneed= free=');
  });

  it('passes when the database size cannot be read', () => {
    const { appDir, pgDir } = app('DATABASE_URL=postgresql://erp:secret@localhost:1/none\n');
    expect(check(appDir, { UPDATE_PG_DIR: pgDir })).toContain('ok\nneed= free=');
  });
});
