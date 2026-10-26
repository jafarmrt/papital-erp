import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v11 (failed v11.2.0 server update): the build ran out of memory on a server without swap and the kernel killed it
// («Killed»); update.sh only said «Build failed» after the backup and the pull. Now it checks RAM available plus free
// swap before it starts and names the lack of memory when the kernel stopped the build.

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
const meminfo = (availableMb: number, swapFreeMb: number) =>
  `MemTotal:        2014000 kB\nMemFree:          120000 kB\nMemAvailable:    ${availableMb * 1024} kB\nSwapTotal:       ${swapFreeMb * 1024} kB\nSwapFree:        ${swapFreeMb * 1024} kB\n`;

function steps(script: string, env: Record<string, string>) {
  return spawnSync('bash', ['-c', `source "${path.join(ROOT, 'scripts/update-steps.sh')}"\n${script}`], {
    encoding: 'utf8', env: { ...process.env, UPDATE_MIN_MEMORY_MB: '2048', ...env },
  });
}

describe('update_memory_check', () => {
  it('counts RAM available plus free swap and refuses the update below UPDATE_MIN_MEMORY_MB', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mem-'));
    const file = path.join(dir, 'meminfo');
    write(file, meminfo(1500, 0));
    const low = steps('update_memory_check || { echo "refused"; echo "$UPDATE_MEMORY_MESSAGE"; }; echo "free=$UPDATE_MEMORY_FREE_MB"', { UPDATE_MEMINFO: file });
    expect(low.stdout).toContain('refused');
    expect(low.stdout).toContain('needs about 2048 MB of free RAM and swap together, 1500 MB is free');
    expect(low.stdout).toContain('Nothing was changed');
    expect(low.stdout).toContain('sudo fallocate -l 2G /swapfile');
    expect(low.stdout).toContain('sudo UPDATE_MIN_MEMORY_MB=<MB> ./update.sh sets a lower bar');
    expect(low.stdout).toContain('free=1500');

    write(file, meminfo(1500, 2048));
    const withSwap = steps('update_memory_check && echo "ok $UPDATE_MEMORY_FREE_MB"', { UPDATE_MEMINFO: file });
    expect(withSwap.stdout.trim()).toBe('ok 3548');

    // after the pull the message says what is already in place
    write(file, meminfo(900, 0));
    const after = steps('update_memory_check 1 || echo "$UPDATE_MEMORY_MESSAGE"', { UPDATE_MEMINFO: file });
    expect(after.stdout).toContain('the new source are in place; the running build and the service are untouched');

    const lowered = steps('update_memory_check && echo ok', { UPDATE_MEMINFO: file, UPDATE_MIN_MEMORY_MB: '800' });
    expect(lowered.stdout.trim()).toBe('ok');
    const invalid = steps('update_memory_check || echo "$UPDATE_MEMORY_MESSAGE"', { UPDATE_MEMINFO: file, UPDATE_MIN_MEMORY_MB: '2G' });
    expect(invalid.stdout).toContain('UPDATE_MIN_MEMORY_MB must be a whole number');
  });

  it('does not block an update where the memory cannot be read', () => {
    const run = steps('update_memory_check && echo "ok [$UPDATE_MEMORY_FREE_MB]"', { UPDATE_MEMINFO: '/nonexistent/meminfo' });
    expect(run.stdout.trim()).toBe('ok []');
  });

  it('reads the kernel count of processes killed for lack of memory', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mem-'));
    write(path.join(dir, 'vmstat'), 'pgfault 10\noom_kill 3\n');
    expect(execFileSync('bash', ['-c', `source "${path.join(ROOT, 'scripts/update-steps.sh')}"; update_oom_kills`],
      { encoding: 'utf8', env: { ...process.env, UPDATE_VMSTAT: path.join(dir, 'vmstat') } }).trim()).toBe('3');
  });
});

// ---------- update.sh, manual mode ----------
/** npm: the build fails with STUB_BUILD_FAILS; with STUB_OOM it is killed for lack of memory (the kernel's count grows) */
const NPM_STUB = `#!/usr/bin/env bash
case "$1" in
  ci) if [ -n "$STUB_CI_OOM" ]; then echo "oom_kill 1" > "$UPDATE_VMSTAT"; echo "Killed"; exit 137; fi
      mkdir -p node_modules ;;
  run) [ -z "$STUB_OOM_ELSEWHERE" ] || echo "oom_kill 1" > "$UPDATE_VMSTAT"
       if [ -n "$STUB_OOM" ]; then echo "oom_kill 1" > "$UPDATE_VMSTAT"; echo "Killed"; exit 137; fi
       [ -z "$STUB_BUILD_FAILS" ] || exit 1
       mkdir -p dist && echo '// new' > dist/server.cjs ;;
esac
`;
function scratch(availableMb: number) {
  dir = mkdtempSync(path.join(tmpdir(), 'mem-update-'));
  const app = path.join(dir, 'app');
  const src = path.join(dir, 'new-source');
  const bin = path.join(dir, 'bin');
  for (const root of [app, src]) {
    for (const f of ['update.sh', 'scripts/update-steps.sh', 'scripts/env-file.sh', 'scripts/ops-lock.sh', 'scripts/ensure-env-secrets.sh']) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      copyFileSync(path.join(ROOT, f), path.join(root, f));
    }
    write(path.join(root, 'scripts/verify-startup.sh'), 'echo "startup ok"\n');
  }
  write(path.join(app, 'package.json'), '{"version":"1.0.0"}');
  write(path.join(app, 'server.ts'), '// old');
  write(path.join(app, 'dist/server.cjs'), '// old');
  write(path.join(app, 'node_modules/marker'), 'old');
  write(path.join(app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\n`);
  write(path.join(src, 'package.json'), '{"version":"2.0.0"}');
  write(path.join(src, 'server.ts'), '// new');
  write(path.join(src, 'package-lock.json'), '{}');
  write(path.join(bin, 'npm'), NPM_STUB);
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  write(path.join(dir, 'meminfo'), meminfo(availableMb, 0));
  write(path.join(dir, 'vmstat'), 'oom_kill 0\n');
  return { app, src, bin };
}
function run(s: ReturnType<typeof scratch>, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', s.src], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, NODE_ENV: '', STUB_BUILD_FAILS: '', STUB_OOM: '', STUB_CI_OOM: '', STUB_OOM_ELSEWHERE: '',
      NPM_CI_RETRY_DELAY: '0',
      UPDATE_MIN_MEMORY_MB: '2048', UPDATE_MEMINFO: path.join(dir, 'meminfo'), UPDATE_VMSTAT: path.join(dir, 'vmstat'), ...extraEnv },
  });
}

describe('update_refuses_or_explains_a_build_without_memory', () => {
  itRunsUpdate('a server short of memory is refused before the source or the build is touched', () => {
    const s = scratch(1200);
    const r = run(s);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('Not enough memory to build the update');
    expect(r.stdout).toContain('Nothing was changed');
    expect(read(path.join(s.app, 'server.ts'))).toBe('// old');
    expect(existsSync(path.join(s.app, '.previous-source'))).toBe(false);
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// old');
  });

  itRunsUpdate('enough memory: the update says how much it found and goes on', () => {
    const s = scratch(4000);
    const r = run(s);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('Free memory: 4000 MB of RAM and swap (the build needs about 2048 MB)');
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// new\n');
  });

  itRunsUpdate('a build the kernel killed for lack of memory is named as such, and the running build stays', () => {
    const s = scratch(4000);
    const r = run(s, { STUB_OOM: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('The server ran out of memory: the kernel killed a process during the build');
    expect(r.stdout).toContain('sudo fallocate -l 2G /swapfile');
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// old');
  });

  itRunsUpdate('npm ci killed for lack of memory stops at once instead of being retried as a network failure', () => {
    const s = scratch(4000);
    const r = run(s, { STUB_CI_OOM: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('the kernel killed a process during npm ci');
    expect(r.stdout).not.toContain('retrying in');
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// old');
  });

  itRunsUpdate('the first run of an update can be an older update.sh without the check: the new one checks before the build', () => {
    const s = scratch(1200);
    // the running version's update.sh: this one without the check before the backup (as v11.2.0 had none)
    const current = read(path.join(s.app, 'update.sh'));
    const first = /\n {2}update_memory_check \|\| die "\$UPDATE_MEMORY_MESSAGE"\n[\s\S]*?\n {2}fi\n/;
    expect(current).toMatch(first);
    write(path.join(s.app, 'update.sh'), current.replace(first, '\n'));
    const r = run(s);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('The new version brings another update.sh; continuing with it.');
    expect(r.stdout).toContain('Not enough memory to build the update');
    expect(r.stdout).toContain('the new source are in place; the running build and the service are untouched');
    // the rollback steps put the previous source back; the running build was never touched
    expect(r.stdout).toContain('restore-source');
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// old');
  });

  itRunsUpdate('a build that passed while the kernel killed another process warns', () => {
    const s = scratch(4000);
    const r = run(s, { STUB_OOM_ELSEWHERE: '1' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('WARN: The build passed, but the kernel killed a process for lack of memory meanwhile');
    expect(read(path.join(s.app, 'dist/server.cjs'))).toBe('// new\n');
  });

  itRunsUpdate('any other build failure keeps its own message', () => {
    const s = scratch(4000);
    const r = run(s, { STUB_BUILD_FAILS: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('ran out of memory');
    expect(r.stdout).toContain('Build failed - the service was NOT restarted');
  });
});
