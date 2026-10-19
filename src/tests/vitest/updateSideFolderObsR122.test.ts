import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v10.2.20 (OBS-R1-22 / OBS-R1-17, 10.2 package 13): update.sh ran `npm ci` and the build in the application directory,
// so node_modules changed under the running process and the old server served the new index.html with its old API;
// a manual update synced the source without --delete, leaving removed files behind, and kept no previous source for
// the rollback it printed. Now the update is installed and built in .build-next, swapped in right before the restart
// with the previous build kept as dist.prev / node_modules.prev, and a manual update keeps .previous-source.
// The real update.sh runs here against a scratch application directory, with npm, systemctl and sudo stubbed.

const ROOT = path.resolve(__dirname, '../../..');
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const read = (file: string) => readFileSync(file, 'utf8');

/** A stub `npm`: `ci` writes node_modules/marker, `run build` writes dist/; both record the folder and what the running dist held */
const NPM_STUB = `#!/usr/bin/env bash
set -e
echo "$1 $(pwd) running-dist=$(cat "$STUB_APP_DIR/dist/version.txt" 2>/dev/null) running-modules=$(cat "$STUB_APP_DIR/node_modules/marker" 2>/dev/null)" >> "$STUB_LOG"
case "$1" in
  ci) mkdir -p node_modules && echo new > node_modules/marker ;;
  install) ;;
  run) [ -z "$STUB_BUILD_FAILS" ] || exit 1; mkdir -p dist && echo new > dist/version.txt && echo '// new' > dist/server.cjs ;;
esac
`;

function scratch() {
  dir = mkdtempSync(path.join(tmpdir(), 'obs-r1-22-'));
  const app = path.join(dir, 'app');
  const src = path.join(dir, 'new-source');
  const bin = path.join(dir, 'bin');
  for (const f of ['update.sh', 'scripts/update-steps.sh', 'scripts/ensure-env-secrets.sh']) {
    mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    copyFileSync(path.join(ROOT, f), path.join(app, f));
  }
  write(path.join(app, 'scripts/verify-startup.sh'), 'echo "startup ok"\n');
  // the running version
  write(path.join(app, 'package.json'), '{"version":"1.0.0"}');
  write(path.join(app, 'server.ts'), '// old');
  write(path.join(app, 'src/removed-in-new.ts'), '// only in the old version');
  write(path.join(app, 'dist/version.txt'), 'old');
  write(path.join(app, 'dist/server.cjs'), '// old');
  write(path.join(app, 'node_modules/marker'), 'old');
  // live state
  write(path.join(app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\nMEDIA_DIR=./my-media\n`);
  write(path.join(app, 'public/uploads/x.png'), 'image');
  write(path.join(app, 'logs/app.log'), 'log');
  write(path.join(app, 'my-media/clip.mp4'), 'media');
  write(path.join(app, 'media-library/a.webp'), 'media');
  // the new version
  write(path.join(src, 'package.json'), '{"version":"2.0.0"}');
  write(path.join(src, 'server.ts'), '// new');
  write(path.join(src, 'package-lock.json'), '{}');
  write(path.join(src, 'update.sh'), read(path.join(app, 'update.sh')));
  write(path.join(src, 'scripts/update-steps.sh'), read(path.join(app, 'scripts/update-steps.sh')));
  write(path.join(src, 'scripts/ensure-env-secrets.sh'), read(path.join(app, 'scripts/ensure-env-secrets.sh')));
  write(path.join(src, 'scripts/verify-startup.sh'), 'echo "startup ok"\n');
  write(path.join(src, '.env.example'), 'PORT=3000\n');
  // stubs
  write(path.join(bin, 'npm'), NPM_STUB);
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  return { app, src, bin, log: path.join(dir, 'npm.log') };
}

function runUpdate(s: ReturnType<typeof scratch>, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', s.src], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, STUB_APP_DIR: s.app, STUB_LOG: s.log, STUB_BUILD_FAILS: '', NODE_ENV: '', ...extraEnv },
  });
}

describe('update_side_folder_build_obs_r1_22', () => {
  it('installs and builds in .build-next while the running build stays, then swaps it in and keeps the previous one', () => {
    const s = scratch();
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const npm = read(s.log).trim().split('\n');
    expect(npm.map(l => l.split(' ')[0])).toEqual(['ci', 'run']);
    for (const line of npm) {
      expect(line).toContain(`${path.join(s.app, '.build-next')} `);
      // the running process saw its own build until the swap
      expect(line).toContain('running-dist=old running-modules=old');
    }
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('new\n');
    expect(read(path.join(s.app, 'node_modules/marker'))).toBe('new\n');
    expect(read(path.join(s.app, 'dist.prev/version.txt'))).toBe('old');
    expect(read(path.join(s.app, 'node_modules.prev/marker'))).toBe('old');
    // the side folder (a second node_modules) is gone
    expect(existsSync(path.join(s.app, '.build-next'))).toBe(false);
    expect(run.stdout).toContain('Update finished successfully. Running v2.0.0');
  });

  it('a failed build leaves the running dist and node_modules untouched and prints a rollback without a rebuild', () => {
    const s = scratch();
    const run = runUpdate(s, { STUB_BUILD_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('old');
    expect(read(path.join(s.app, 'node_modules/marker'))).toBe('old');
    expect(existsSync(path.join(s.app, 'dist.prev'))).toBe(false);
    expect(existsSync(path.join(s.app, '.build-next'))).toBe(false);
    expect(run.stdout).toContain('Build failed - the service was NOT restarted');
    expect(run.stdout).toContain(`bash scripts/update-steps.sh restore-source ${s.app}`);
    expect(run.stdout).not.toContain('npm run build');
  });
});

describe('update_manual_sync_deletes_and_keeps_previous_obs_r1_17', () => {
  it('removes files the new source no longer has, keeps live state and the previous source, and restores it', () => {
    const s = scratch();
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(existsSync(path.join(s.app, 'src/removed-in-new.ts'))).toBe(false);
    expect(read(path.join(s.app, 'server.ts'))).toBe('// new');
    expect(existsSync(path.join(s.app, '.env.example'))).toBe(true);
    for (const live of ['.env', 'public/uploads/x.png', 'logs/app.log', 'my-media/clip.mp4', 'media-library/a.webp']) {
      expect(existsSync(path.join(s.app, live)), live).toBe(true);
    }
    expect(read(path.join(s.app, '.env'))).toContain('PORT=3999');
    // the previous source, without live state
    const prev = path.join(s.app, '.previous-source');
    expect(read(path.join(prev, 'server.ts'))).toBe('// old');
    expect(existsSync(path.join(prev, 'src/removed-in-new.ts'))).toBe(true);
    for (const live of ['.env', 'public/uploads', 'logs', 'my-media', 'media-library', 'node_modules', 'dist']) {
      expect(existsSync(path.join(prev, live)), live).toBe(false);
    }

    execFileSync('bash', [path.join(s.app, 'scripts/update-steps.sh'), 'restore-source', s.app], { encoding: 'utf8' });
    expect(read(path.join(s.app, 'server.ts'))).toBe('// old');
    expect(existsSync(path.join(s.app, 'src/removed-in-new.ts'))).toBe(true);
    expect(existsSync(path.join(s.app, '.env.example'))).toBe(false);
    expect(existsSync(path.join(s.app, 'public/uploads/x.png'))).toBe(true);
    expect(existsSync(path.join(s.app, 'my-media/clip.mp4'))).toBe(true);
    expect(read(path.join(s.app, 'node_modules/marker'))).toBe('new\n');
  });

  it('refuses a new source inside the application directory, which --delete would remove mid-sync', () => {
    const s = scratch();
    const inside = path.join(s.app, 'incoming');
    execFileSync('cp', ['-a', s.src, inside]);
    const run = spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', inside], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, STUB_APP_DIR: s.app, STUB_LOG: s.log },
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout + run.stderr).toContain('must be outside the application directory');
    expect(read(path.join(s.app, 'server.ts'))).toBe('// old');
  });
});

describe('update_free_space_preflight_obs_r1_22', () => {
  it('stops before the backup, the source or the build is touched when the disk cannot hold the side build', () => {
    const s = scratch();
    const run = runUpdate(s, { UPDATE_SPACE_MARGIN_MB: '999999999' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toMatch(/Not enough free disk space for the update: it needs about \d+ MB on the disk of .+, \d+ MB is free\. Nothing was changed/);
    expect(read(path.join(s.app, 'server.ts'))).toBe('// old');
    expect(existsSync(path.join(s.app, 'src/removed-in-new.ts'))).toBe(true);
    for (const untouched of ['.previous-source', '.build-next', 'dist.prev', 'node_modules.prev']) {
      expect(existsSync(path.join(s.app, untouched)), untouched).toBe(false);
    }
    expect(existsSync(s.log)).toBe(false);
    expect(run.stdout).not.toContain('Rollback:');
  });

  it('counts the side copy of the source, node_modules and dist, and one more source copy for a manual update', () => {
    const s = scratch();
    write(path.join(s.app, 'node_modules/big.bin'), 'x'.repeat(4 * 1024 * 1024));
    const check = (mode: string) => Number(execFileSync('bash', ['-c', `source scripts/update-steps.sh; UPDATE_SPACE_MARGIN_MB=0 update_space_check "$1" "$2" || true; echo "$UPDATE_SPACE_NEED_KB"`, 'x', s.app, mode], { cwd: s.app, encoding: 'utf8' }).trim());
    const git = check('git');
    expect(git).toBeGreaterThanOrEqual(4 * 1024);
    expect(check('manual')).toBeGreaterThan(git);
  });
});
