import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v11 (phase 4, card ت۵۳ question 5): a migration that changes a column type rewrites its table, so update.sh refuses
// to start when the disk of the database has less free space than twice the database.

const ROOT = path.resolve(__dirname, '../../..');
const HAS_RSYNC = spawnSync('bash', ['-c', 'command -v rsync'], { encoding: 'utf8' }).status === 0;
const SKIP_WITHOUT_RSYNC = !HAS_RSYNC && !process.env.CI;
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

const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };

/**
 * An app on the update.sh of 11.2 (no database check) updated with --source to this
 * source: the old script syncs the source, sees the new update.sh and hands over to it (UPDATE_RESUME), which skips
 * the checks before the backup. The database check after the source step must still stop it.
 */
function runFromOlderUpdate(dbBytes: (pgDir: string) => string) {
  dir = mkdtempSync(path.join(tmpdir(), 'dbspace-run-'));
  const app = path.join(dir, 'app');
  const src = path.join(dir, 'new-source');
  const bin = path.join(dir, 'bin');
  const pgDir = path.join(dir, 'postgresql');
  mkdirSync(pgDir, { recursive: true });
  for (const root of [app, src]) {
    for (const f of ['update.sh', 'scripts/update-steps.sh', 'scripts/env-file.sh', 'scripts/ops-lock.sh', 'scripts/ensure-env-secrets.sh']) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      copyFileSync(path.join(ROOT, f), path.join(root, f));
    }
    write(path.join(root, 'scripts/verify-startup.sh'), 'echo "startup ok"\n');
  }
  // the update steps of 11.2 had no database check
  write(path.join(app, 'scripts/update-steps.sh'), `${readFileSync(path.join(app, 'scripts/update-steps.sh'), 'utf8')}
update_database_space_check() { UPDATE_DB_SPACE_NEED_KB=""; return 0; }
`);
  write(path.join(app, 'package.json'), '{"version":"1.0.0"}');
  write(path.join(app, 'server.ts'), '// old');
  write(path.join(app, 'dist/server.cjs'), '// old');
  write(path.join(app, 'node_modules/marker'), 'old');
  write(path.join(app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\nDATABASE_URL=postgresql://erp:secret@localhost:5432/papital_erp\n`);
  write(path.join(src, 'package.json'), '{"version":"2.0.0"}');
  write(path.join(src, 'server.ts'), '// new');
  write(path.join(src, 'package-lock.json'), '{}');
  write(path.join(bin, 'npm'), '#!/usr/bin/env bash\ncase "$1" in ci) mkdir -p node_modules ;; run) mkdir -p dist && echo "// new" > dist/server.cjs ;; esac\n');
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  return spawnSync('bash', [path.join(app, 'update.sh'), '--no-backup', '--source', src], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, NODE_ENV: '', UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: dbBytes(pgDir) },
  });
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
    const local = ['postgresql://erp:secret@[::1]:5432/db', 'postgres://erp@localhost/db', 'postgresql:///db?host=/var/run/postgresql',
      'postgresql://erp:secret@LOCALHOST?sslmode=disable', 'postgresql://erp@127.0.1.1/db', 'postgresql://erp@%2Fvar%2Frun%2Fpostgresql/db',
      'postgresql://erp:p@ss:w@localhost:5432/db'];
    for (const url of local) {
      const { appDir, pgDir } = app(`DATABASE_URL=${url}\n`);
      expect(check(appDir, { UPDATE_PG_DIR: pgDir, UPDATE_DB_BYTES: '1024' }), url).toContain('need=2 ');
      rmSync(dir, { recursive: true, force: true });
    }
    const remote = app('DATABASE_URL=postgresql://erp:secret@db.example.net:5432/db\n');
    expect(check(remote.appDir, { UPDATE_PG_DIR: remote.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('ok\nneed= free=');
    expect(check(remote.appDir, { UPDATE_DB_DATA_DIR: remote.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('need=2 ');
    rmSync(dir, { recursive: true, force: true });
    const remoteParam = app('DATABASE_URL=postgresql://erp@/db?sslmode=require&host=db.example.net\n');
    expect(check(remoteParam.appDir, { UPDATE_PG_DIR: remoteParam.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('ok\nneed= free=');
    rmSync(dir, { recursive: true, force: true });

    const sqlHost = app('SQL_HOST=localhost\nSQL_DB_NAME=papital_erp\n');
    expect(check(sqlHost.appDir, { UPDATE_PG_DIR: sqlHost.pgDir, UPDATE_DB_BYTES: '1024' })).toContain('need=2 ');
    expect(check(sqlHost.appDir, { UPDATE_PG_DIR: path.join(dir, 'none'), UPDATE_DB_BYTES: '1024' })).toContain('ok\nneed= free=');
  });

  it('passes when the database size cannot be read', () => {
    const { appDir, pgDir } = app('DATABASE_URL=postgresql://erp:secret@localhost:1/none\n');
    expect(check(appDir, { UPDATE_PG_DIR: pgDir })).toContain('ok\nneed= free=');
  });

  it('stops an update started by an older update.sh after the source step, before anything is built', ctx => {
    ctx.skip(SKIP_WITHOUT_RSYNC, 'rsync is not installed and update.sh copies the source with it (CI always runs this case)');
    const refused = runFromOlderUpdate(pgDir => String(freeKb(pgDir) * 1024));
    expect(refused.status, refused.stdout.slice(-3000) + refused.stderr.slice(-1500)).not.toBe(0);
    expect(refused.stdout + refused.stderr).toContain('Not enough free disk space for the database migrations');
    expect(refused.stdout + refused.stderr).toContain('the new source are in place; the running build and the service are untouched');
    expect(readFileSync(path.join(dir, 'app/dist/server.cjs'), 'utf8')).toBe('// old');
    rmSync(dir, { recursive: true, force: true });

    const passed = runFromOlderUpdate(() => String(1024 * 1024));
    expect(passed.stdout + passed.stderr).toContain('Free disk space for the database');
    expect(passed.status, passed.stdout.slice(-2000)).toBe(0);
  }, 120_000);
});
