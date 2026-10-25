import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMigrationsFolder } from '../../db/migrator.js';

// v11 phase 3.3 (independent evaluation, findings O1, O2, O4 and O5): the update and the migrations it starts.
// O1: the built server read the migrations of the source drizzle/ in its working directory before its own dist/drizzle,
//     so a restart of the old build while update.sh had the new source in place applied the new migrations.
// O2: after a failed update whose migrations ran, the rollback hint offered «keep the database» with the previous
//     build, which refuses a database newer than itself.
// O4: any npm ci failure regenerated package-lock.json and wrote it into the git checkout, blocking the next pull.
// O5: each script read .env with `grep "^KEY=" | head -1`, unlike the service (node --env-file).

const ROOT = path.resolve(__dirname, '../../..');
const HAS_RSYNC = spawnSync('bash', ['-c', 'command -v rsync'], { encoding: 'utf8' }).status === 0;
const SKIP_WITHOUT_RSYNC = !HAS_RSYNC && !process.env.CI;
function itRunsUpdate(name: string, fn: () => unknown) {
  it(name, ctx => {
    ctx.skip(SKIP_WITHOUT_RSYNC, 'rsync is not installed and update.sh copies the source with it (CI always runs this case)');
    return fn();
  }, 60_000);
}

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const read = (file: string) => readFileSync(file, 'utf8');
const journal = (n: number) => JSON.stringify({ entries: Array.from({ length: n }, (_, idx) => ({ idx, when: 1000 + idx, tag: `000${idx}_m` })) });

// ---------- O1 ----------
describe('migrations_folder_of_the_built_server_o1', () => {
  it('a built server reads only its own dist/drizzle, never the newer source drizzle/ of its working directory', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'o1-'));
    const app = path.join(dir, 'app');
    write(path.join(app, 'drizzle/0000_v3_baseline.sql'), '-- baseline');
    write(path.join(app, 'drizzle/0136_new_release.sql'), '-- a migration of the next release, pulled before the swap');
    write(path.join(app, 'dist/server.cjs'), '// the running build');
    write(path.join(app, 'dist/drizzle/0000_v3_baseline.sql'), '-- baseline');
    expect(resolveMigrationsFolder(app, path.join(app, 'dist'))).toBe(path.join(app, 'dist/drizzle'));
    // a build without its own copy fails on the missing baseline instead of falling back to the source
    rmSync(path.join(app, 'dist/drizzle'), { recursive: true });
    expect(resolveMigrationsFolder(app, path.join(app, 'dist'))).toBe(path.join(app, 'dist/drizzle'));
  });

  it('tsx and the tests (no bundle) keep reading the source drizzle/', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'o1-'));
    write(path.join(dir, 'drizzle/0000_v3_baseline.sql'), '-- baseline');
    expect(resolveMigrationsFolder(dir, path.join(dir, 'src/db'))).toBe(path.join(dir, 'drizzle'));
    expect(resolveMigrationsFolder(path.join(dir, 'elsewhere'), path.join(dir, 'src/db'))).toBe(path.join(dir, 'drizzle'));
    expect(resolveMigrationsFolder(ROOT, path.join(ROOT, 'src/db'))).toBe(path.join(ROOT, 'drizzle'));
  });
});

// ---------- O5 ----------
const ENV_LINES = [
  'PORT=3000', '# a comment', '  PORT=4000', 'export A=1', 'B=abc # note', 'C="x # y"', "D='q'", 'E=pa#ss', 'F = spaced ',
  'G="a\\nb"', 'H=`bt`', 'J=', 'K=a=b', 'M=  "lead"', 'N=crlf\r', 'export   O=2', 'P', '#Q=1', 'U="a"#b', 'V="  sp  "',
  "W='a\\nb'", 'X=postgresql://erp:p%40ss@localhost:5432/erp?sslmode=disable',
];
const ENV_KEYS = ['PORT', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'O', 'P', 'Q', 'U', 'V', 'W', 'X', 'MISSING'];

describe('scripts_read_env_like_the_service_o5', () => {
  const readAll = (file: string, plain: boolean) => Object.fromEntries(ENV_KEYS.map(k => [k, execFileSync('bash', ['-c',
    `source "${path.join(ROOT, 'scripts/env-file.sh')}"; ${plain ? 'env_file_get_plain' : 'env_file_get'} "$1" "$2"`, 'x', file, k],
    { encoding: 'utf8' })]));

  it('env_file_get and its fallback give the values node --env-file gives', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'o5-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, `${ENV_LINES.join('\n')}\n`);
    const parsed = parseEnv(read(file));
    const expected = Object.fromEntries(ENV_KEYS.map(k => [k, (parsed[k] ?? '').replace(/\n+$/, '')]));
    expect(expected.PORT).toBe('4000');
    expect(expected.B).toBe('abc');
    expect(readAll(file, false)).toEqual(expected);
    expect(readAll(file, true)).toEqual(expected);
  });

  it('no shell script reads .env with its own grep any more', () => {
    const scripts = [
      ...['update.sh', 'install.sh', 'setup-domain.sh'],
      ...readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.sh') && f !== 'env-file.sh').map(f => `scripts/${f}`),
    ];
    // a value read with grep and head or cut, or a value compared inside the grep pattern ('^FLAG=1')
    const reader = /grep\b[^\n]*["']\^\$?\{?[A-Za-z_0-9]+\}?=[^\n]*\|\s*(head|cut)|grep -qE? ["']\^[A-Z_]+=[^"'\n]+["']/;
    const offenders = scripts.filter(f => reader.test(read(path.join(ROOT, f))));
    expect(offenders).toEqual([]);
  });

  itRunsUpdate('update.sh checks the startup on the PORT the service listens on when .env names it twice', () => {
    const s = manualScratch();
    write(path.join(s.app, '.env'), `PORT=3000\nERP_SECRETS_KEY=${'a'.repeat(64)}\n  PORT=3999 # the later line wins in the service\n`);
    const run = runManual(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(read(path.join(dir, 'verify.args')).trim().split(' ')[0]).toBe('3999');
  });
});

// ---------- a manual-update scratch (O2, O5) ----------
const NPM_STUB = `#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) [ -z "$STUB_BUILD_FAILS" ] || exit 1
       mkdir -p dist && echo '// new' > dist/server.cjs && { [ ! -d drizzle ] || cp -r drizzle dist/; } ;;
esac
`;
function manualScratch() {
  dir = mkdtempSync(path.join(tmpdir(), 'v11-3-3-'));
  const app = path.join(dir, 'app');
  const src = path.join(dir, 'new-source');
  const bin = path.join(dir, 'bin');
  const verify = `echo "$*" > "${path.join(dir, 'verify.args')}"\n[ -z "\${STUB_STARTUP_FAILS:-}" ] || { echo "startup failed"; exit 1; }\necho "startup ok"\n`;
  for (const root of [app, src]) {
    for (const f of ['update.sh', 'scripts/update-steps.sh', 'scripts/env-file.sh', 'scripts/ensure-env-secrets.sh']) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      copyFileSync(path.join(ROOT, f), path.join(root, f));
    }
    write(path.join(root, 'scripts/verify-startup.sh'), verify);
  }
  write(path.join(app, 'package.json'), '{"version":"1.0.0"}');
  write(path.join(app, 'server.ts'), '// old');
  write(path.join(app, 'dist/server.cjs'), '// old');
  write(path.join(app, 'dist/drizzle/meta/_journal.json'), journal(2));
  write(path.join(app, 'node_modules/marker'), 'old');
  write(path.join(app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\n`);
  write(path.join(src, 'package.json'), '{"version":"2.0.0"}');
  write(path.join(src, 'server.ts'), '// new');
  write(path.join(src, 'package-lock.json'), '{}');
  write(path.join(src, 'drizzle/meta/_journal.json'), journal(2));
  write(path.join(bin, 'npm'), NPM_STUB);
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  return { app, src, bin };
}
function runManual(s: ReturnType<typeof manualScratch>, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', s.src], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, STUB_BUILD_FAILS: '', NODE_ENV: '', ...extraEnv },
  });
}

// ---------- O2 ----------
describe('rollback_follows_what_the_update_did_to_the_database_o2', () => {
  itRunsUpdate('an update without new migrations rolls back the code alone, with no backup restore', () => {
    const s = manualScratch();
    const run = runManual(s, { STUB_STARTUP_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('this update changed nothing in the database, so no restore is needed');
    expect(run.stdout).toContain('[ ! -d dist.prev ] || { rm -rf dist && mv dist.prev dist; }');
    expect(run.stdout).not.toContain('restore.sh');
  });

  itRunsUpdate('an update with new migrations never offers the previous build on the migrated database', () => {
    const s = manualScratch();
    write(path.join(s.src, 'drizzle/meta/_journal.json'), journal(3));
    const run = runManual(s, { STUB_STARTUP_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain('keep the database');
    expect(run.stdout).toContain('A) Go forward');
    expect(run.stdout).toContain('B) Go back completely: restoring the backup erases every change made after it');
    expect(run.stdout).toContain('scripts/restore.sh');
  });

  it('counts the migrations in the database newer than the previous build, whoever applied them', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'o2-'));
    const changed = (newerInDb: string, newer: number, older: number | null) => {
      rmSync(path.join(dir, 'dist.prev'), { recursive: true, force: true });
      write(path.join(dir, 'dist/drizzle/meta/_journal.json'), journal(newer));
      if (older !== null) write(path.join(dir, 'dist.prev/drizzle/meta/_journal.json'), journal(older));
      return execFileSync('bash', ['-c', `source "${path.join(ROOT, 'scripts/update-steps.sh')}"
        update_applied_migrations_after() { echo "after=$2" >> "$STUB_ARGS"; echo "$STUB_NEWER"; }
        update_migrations_changed "$1"`, 'x', dir], { encoding: 'utf8', env: { ...process.env, STUB_NEWER: newerInDb, STUB_ARGS: path.join(dir, 'args') } }).trim();
    };
    expect(changed('2', 138, 136)).toBe('2');
    // the newest migration the previous build knows is 0135, «when» 1135
    expect(read(path.join(dir, 'args'))).toContain('after=1135');
    // the previous build itself may have applied them before the swap (its migrator read the source drizzle/)
    expect(changed('1', 137, 136)).toBe('1');
    expect(changed('0', 138, 136)).toBe('0');
    expect(changed('', 136, 136)).toBe('0');
    expect(changed('', 137, 136)).toBe('unknown');
    expect(changed('', 137, null)).toBe('unknown');
  });
});

// ---------- O4 (git mode) ----------
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
/** npm: `ci` fails with a network error STUB_CI_FAILS times (or always with STUB_CI_EUSAGE); every call is logged */
const GIT_NPM_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_NPM_LOG"
case "$1" in
  ci) n=$(( $(cat "$STUB_CI_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_CI_COUNT"
      if [ -n "$STUB_CI_EUSAGE" ]; then echo "npm error code EUSAGE"; echo "npm error \\\`npm ci\\\` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync."; exit 1; fi
      if [ "$n" -le "\${STUB_CI_FAILS:-0}" ]; then echo "npm error code ETIMEDOUT"; echo "npm error network request to https://registry.npmjs.org failed"; exit 1; fi
      mkdir -p node_modules ;;
  install) echo '{"regenerated":true}' > package-lock.json ;;
  run) mkdir -p dist && echo '// new' > dist/server.cjs ;;
esac
`;
function gitScratch() {
  dir = mkdtempSync(path.join(tmpdir(), 'o4-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const app = path.join(dir, 'app');
  const bin = path.join(dir, 'bin');
  git(dir, ['init', '-q', '--bare', '-b', 'master', origin]);
  git(dir, ['clone', '-q', origin, work]);
  for (const f of ['update.sh', 'scripts/update-steps.sh', 'scripts/env-file.sh', 'scripts/ensure-env-secrets.sh', 'scripts/untrack-node-modules-link.sh']) {
    mkdirSync(path.dirname(path.join(work, f)), { recursive: true });
    copyFileSync(path.join(ROOT, f), path.join(work, f));
  }
  write(path.join(work, 'scripts/verify-startup.sh'), 'echo "startup ok"\n');
  write(path.join(work, '.gitignore'), 'dist\ndist.prev\nnode_modules\nnode_modules.prev\n.env\n*.log\n.update.lock\n');
  write(path.join(work, 'server.ts'), '');
  write(path.join(work, 'package.json'), '{"version":"1.0.0"}\n');
  write(path.join(work, 'package-lock.json'), '{"released":1}\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'one']);
  git(work, ['push', '-q', 'origin', 'HEAD:master']);
  git(dir, ['clone', '-q', origin, app]);
  write(path.join(work, 'package.json'), '{"version":"2.0.0"}\n');
  write(path.join(work, 'package-lock.json'), '{"released":2}\n');
  git(work, ['commit', '-q', '-am', 'two']);
  git(work, ['push', '-q', 'origin', 'HEAD:master']);
  write(path.join(app, 'dist/server.cjs'), '// old');
  write(path.join(app, 'node_modules/marker'), 'old');
  write(path.join(app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\n`);
  write(path.join(bin, 'npm'), GIT_NPM_STUB);
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  return { app, bin, npmLog: path.join(dir, 'npm.log') };
}
function runGit(s: ReturnType<typeof gitScratch>, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, NODE_ENV: '', NPM_CI_RETRY_DELAY: '0',
      STUB_NPM_LOG: s.npmLog, STUB_CI_COUNT: path.join(dir, 'ci.count'), STUB_CI_FAILS: '', STUB_CI_EUSAGE: '', ...extraEnv },
  });
}
const npmCalls = (s: ReturnType<typeof gitScratch>) => (existsSync(s.npmLog) ? read(s.npmLog).trim().split('\n') : []).map(l => l.split(' ')[0]);

describe('npm_ci_failure_never_rewrites_the_lock_o4', () => {
  itRunsUpdate('a network failure of npm ci is retried, and the released lock stays untouched in a clean checkout', () => {
    const s = gitScratch();
    const run = runGit(s, { STUB_CI_FAILS: '1' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('not a lock file mismatch');
    expect(npmCalls(s)).toEqual(['ci', 'ci', 'run']);
    expect(read(path.join(s.app, 'package-lock.json'))).toBe('{"released":2}\n');
    expect(git(s.app, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
  });

  itRunsUpdate('a lasting network failure stops the update after the retries without regenerating the lock', () => {
    const s = gitScratch();
    const run = runGit(s, { STUB_CI_FAILS: '9' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('npm ci failed 3 times');
    expect(npmCalls(s)).toEqual(['ci', 'ci', 'ci']);
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// old');
    expect(git(s.app, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
  });

  itRunsUpdate('a released lock that npm refuses stops the update; the lock is never regenerated in a git checkout', () => {
    const s = gitScratch();
    const run = runGit(s, { STUB_CI_EUSAGE: '1' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('This is a fault of the release');
    expect(npmCalls(s)).toEqual(['ci']);
    expect(git(s.app, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
  });

  itRunsUpdate('a lock an earlier update wrote into the checkout is put back, so the pull goes through', () => {
    const s = gitScratch();
    write(path.join(s.app, 'package-lock.json'), '{"regenerated":true}\n');
    const run = runGit(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('package-lock.json was changed by an earlier update');
    expect(read(path.join(s.app, 'package-lock.json'))).toBe('{"released":2}\n');
  });

  itRunsUpdate('any other local change still stops the pull, and the lock change is left for the owner to see', () => {
    const s = gitScratch();
    write(path.join(s.app, 'package-lock.json'), '{"regenerated":true}\n');
    write(path.join(s.app, 'server.ts'), '// edited by hand');
    const run = runGit(s);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('git pull failed');
    expect(read(path.join(s.app, 'package-lock.json'))).toBe('{"regenerated":true}\n');
  });
});
