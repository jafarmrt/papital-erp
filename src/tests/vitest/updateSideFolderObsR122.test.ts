import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v10.2.23 (OBS-R1-22 / OBS-R1-17, 10.2 package 13): update.sh ran `npm ci` and the build in the application directory,
// so node_modules changed under the running process and the old server served the new index.html with its old API;
// a manual update synced the source without --delete, leaving removed files behind, and kept no previous source for
// the rollback it printed. Now the update is installed and built in .build-next, swapped in right before the restart
// with the previous build kept as dist.prev / node_modules.prev, and a manual update keeps .previous-source.
// The real update.sh runs here against a scratch application directory, with npm, systemctl and sudo stubbed.

const ROOT = path.resolve(__dirname, '../../..');

// 10.3 (ARCH review finding 5): update.sh copies the source with rsync. On a computer without rsync the cases that need
// it are skipped with a note instead of failing; CI has rsync, and there a missing rsync still fails them.
const HAS_RSYNC = spawnSync('bash', ['-c', 'command -v rsync'], { encoding: 'utf8' }).status === 0;
const SKIP_WITHOUT_RSYNC = !HAS_RSYNC && !process.env.CI;
const RSYNC_MISSING = 'rsync is not installed and update.sh copies the source with it; install rsync to run this case (CI always runs it)';
function itRunsUpdate(name: string, fn: () => unknown, timeout?: number) {
  it(name, ctx => {
    ctx.skip(SKIP_WITHOUT_RSYNC, RSYNC_MISSING);
    return fn();
  }, timeout);
}
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
  run) [ -z "$STUB_BUILD_HANGS" ] || { : > "$STUB_BUILD_HANGS"; sleep 20; }
       [ -z "$STUB_BUILD_FAILS" ] || exit 1; mkdir -p dist && echo new > dist/version.txt && echo '// new' > dist/server.cjs
       echo "build-env=$(cat .env.production 2>/dev/null)" >> "$STUB_LOG" ;;
esac
`;

const VERIFY_STUB = '[ -z "${STUB_STARTUP_FAILS:-}" ] || { echo "startup failed"; exit 1; }\necho "startup ok"\n';
/** A stub `mv` that fails on its STUB_MV_FAIL_AT-th call (the swap is the only place the update runs mv) */
const MV_STUB = `#!/usr/bin/env bash
n=$(( $(cat "$STUB_MV_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_MV_COUNT"
m=0; [ ! -e "$STUB_APP_DIR/.update-swapping" ] || m=1
o=0; [ ! -e "$STUB_APP_DIR/.build-next/.old-dist" ] && [ ! -e "$STUB_APP_DIR/.build-next/.old-node_modules" ] || o=1
echo "$n marker=$m old=$o $*" >> "$STUB_MV_COUNT.log"
[ "$n" != "\${STUB_MV_FAIL_AT:-}" ] || exit 1
exec /bin/mv "$@"
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
  write(path.join(app, 'scripts/verify-startup.sh'), VERIFY_STUB);
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
  write(path.join(src, 'scripts/verify-startup.sh'), VERIFY_STUB);
  write(path.join(src, '.env.example'), 'PORT=3000\n');
  // stubs
  write(path.join(bin, 'npm'), NPM_STUB);
  write(path.join(bin, 'mv'), MV_STUB);
  write(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "$1" = list-unit-files ] && echo "papital-erp.service enabled"\nexit 0\n');
  write(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
  for (const f of ['npm', 'mv', 'systemctl', 'sudo']) chmodSync(path.join(bin, f), 0o755);
  return { app, src, bin, log: path.join(dir, 'npm.log') };
}

function runUpdate(s: ReturnType<typeof scratch>, extraEnv: Record<string, string> = {}, extraArgs: string[] = []) {
  try { rmSync(path.join(dir, 'mv.count')); } catch { /* first run */ }
  return spawnSync('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', s.src, ...extraArgs], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, STUB_APP_DIR: s.app, STUB_LOG: s.log, STUB_MV_COUNT: path.join(dir, 'mv.count'), STUB_BUILD_FAILS: '', NODE_ENV: '', ...extraEnv },
  });
}

describe('update_side_folder_build_obs_r1_22', () => {
  itRunsUpdate('installs and builds in .build-next while the running build stays, then swaps it in and keeps the previous one', () => {
    const s = scratch();
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const npm = read(s.log).trim().split('\n').filter(l => !l.startsWith('build-env='));
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

  itRunsUpdate('a failed build leaves the running dist and node_modules untouched and prints a rollback without a rebuild', () => {
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
    // nothing was restarted or migrated: no stop, start or backup restore steps
    expect(run.stdout).not.toContain('systemctl stop');
    expect(run.stdout).not.toContain('restore.sh');
  });

  itRunsUpdate('a failed startup after the swap prints the whole rollback with the build restore and the data-loss warning', () => {
    const s = scratch();
    const run = runUpdate(s, { STUB_STARTUP_FAILS: '1' });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('systemctl stop papital-erp');
    expect(run.stdout).toContain('[ ! -d dist.prev ] || { rm -rf dist && mv dist.prev dist; }');
    expect(run.stdout).toContain('erases every change made after it');
  });

  itRunsUpdate('links the build-time .env files into the side folder', () => {
    const s = scratch();
    write(path.join(s.app, '.env.production'), 'VITE_X=1');
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(read(s.log)).toContain('build-env=VITE_X=1');
    expect(read(path.join(s.app, '.env.production'))).toBe('VITE_X=1');
  });

  itRunsUpdate('continues with the update.sh the new source brings', () => {
    const s = scratch();
    write(path.join(s.src, 'update.sh'), `${read(path.join(s.app, 'update.sh'))}\n# a later version\n`);
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('The new version brings another update.sh; continuing with it.');
    expect(run.stdout).toContain('Continuing with the update.sh of the new version');
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('new\n');
    expect((run.stdout.match(/Syncing source/g) ?? []).length).toBe(1);
  });
});

describe('update_swap_interrupted_obs_r1_22', () => {
  itRunsUpdate('a swap stopped half way keeps the side folder, prints a restore that repairs it, and blocks the next run', () => {
    const s = scratch();
    // the 4th rename (the new node_modules into place) fails: dist is new, node_modules is missing
    const run = runUpdate(s, { STUB_MV_FAIL_AT: '4' });
    expect(run.status).not.toBe(0);
    expect(existsSync(path.join(s.app, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(s.app, '.update-swapping'))).toBe(true);
    expect(existsSync(path.join(s.app, '.build-next/node_modules/marker'))).toBe(true);
    expect(run.stdout).toContain('the build swap stopped half way');

    const blocked = runUpdate(s);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stdout).toContain('An earlier update stopped while swapping the build in');

    const restore = /1\) cd \S+ && (.+?) && bash scripts\/update-steps\.sh/.exec(run.stdout)?.[1];
    expect(restore).toBeTruthy();
    execFileSync('bash', ['-c', restore as string], { cwd: s.app });
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('old');
    expect(read(path.join(s.app, 'node_modules/marker'))).toBe('old');
    expect(existsSync(path.join(s.app, '.update-swapping'))).toBe(false);
    // the same restore on a complete swap brings both folders back, and on no swap at all changes nothing
    execFileSync('bash', ['-c', restore as string], { cwd: s.app });
    expect(read(path.join(s.app, 'node_modules/marker'))).toBe('old');
  });
});

describe('update_single_run_lock_obs_r1_22', () => {
  it('refuses a second update while one holds the lock, changing nothing', () => {
    const s = scratch();
    const run = spawnSync('bash', ['-c', 'exec 9>"$APP_DIR/.update.lock"; flock 9; bash "$APP_DIR/update.sh" --no-backup --source "$SRC"'], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, SRC: s.src, STUB_APP_DIR: s.app, STUB_LOG: s.log },
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain('Another update is already running');
    expect(read(path.join(s.app, 'server.ts'))).toBe('// old');
    expect(existsSync(s.log)).toBe(false);
  });
});

describe('update_noop_keeps_rollback_obs_r1_22', () => {
  itRunsUpdate('a second run of the same source builds nothing and keeps dist.prev; --rebuild builds again', () => {
    const s = scratch();
    expect(runUpdate(s).status).toBe(0);
    const again = runUpdate(s);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    expect(again.stdout).toContain('dist/ is already built from this source');
    expect(read(path.join(s.app, 'dist.prev/version.txt'))).toBe('old');
    expect(read(s.log).trim().split('\n').filter(l => l.startsWith('ci ')).length).toBe(1);

    const rebuilt = runUpdate(s, {}, ['--rebuild']);
    expect(rebuilt.status, rebuilt.stdout + rebuilt.stderr).toBe(0);
    expect(read(path.join(s.app, 'dist.prev/version.txt'))).toBe('new\n');
    expect(rebuilt.stdout).toContain('dist.prev/ holds the previous build, of manual update of');
  });
});

describe('update_manual_sync_deletes_and_keeps_previous_obs_r1_17', () => {
  itRunsUpdate('removes files the new source no longer has, keeps live state and the previous source, and restores it', () => {
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
    expect(run.stdout).not.toContain('Rollback');
    expect(existsSync(path.join(s.app, '.previous-source'))).toBe(false);
  });

  itRunsUpdate('keeps folders .env names however they are written or reached (./, a link into the app)', () => {
    const s = scratch();
    write(path.join(s.app, 'media-alt/clip.mp4'), 'media');
    write(path.join(s.app, 'att-files/a.pdf'), 'pdf');
    execFileSync('ln', ['-s', path.join(s.app, 'att-files'), path.join(dir, 'att-link')]);
    write(path.join(s.app, '.env'), `PORT=3999\nERP_SECRETS_KEY=${'a'.repeat(64)}\nMEDIA_DIR=${s.app}/./media-alt\nATTACHMENTS_DIR=${path.join(dir, 'att-link')}\n`);
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(existsSync(path.join(s.app, 'media-alt/clip.mp4'))).toBe(true);
    expect(existsSync(path.join(s.app, 'att-files/a.pdf'))).toBe(true);
    // what the sync removes is listed before it runs
    expect(run.stdout).toContain('are not in the new source and will be removed');
    expect(run.stdout).toContain('src/removed-in-new.ts');
  });
});

describe('update_free_space_preflight_obs_r1_22', () => {
  itRunsUpdate('stops before the backup, the source or the build is touched when the disk cannot hold the side build', () => {
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

  itRunsUpdate('counts the side copy of the source, node_modules and dist, and one more source copy for a manual update', () => {
    const s = scratch();
    write(path.join(s.app, 'node_modules/big.bin'), 'x'.repeat(4 * 1024 * 1024));
    const check = (mode: string) => Number(execFileSync('bash', ['-c', `source scripts/update-steps.sh; UPDATE_SPACE_MARGIN_MB=0 update_space_check "$1" "$2" || true; echo "$UPDATE_SPACE_NEED_KB"`, 'x', s.app, mode], { cwd: s.app, encoding: 'utf8' }).trim());
    const git = check('git');
    expect(git).toBeGreaterThanOrEqual(4 * 1024);
    expect(check('manual')).toBeGreaterThan(git);
  });

  it('adds the pre-deployment backup when it is on the same disk and counts a stale side folder as free', () => {
    const s = scratch();
    const backups = path.join(dir, 'backups');
    write(path.join(backups, 'erp_pre-deployment_20261018_010000.dump.gz'), 'x'.repeat(3 * 1024 * 1024));
    write(path.join(backups, 'erp_pre-deployment_20261018_010000_uploads.tar.gz'), 'x'.repeat(2 * 1024 * 1024));
    const probe = (backup: string) => execFileSync('bash', ['-c', `source scripts/update-steps.sh; UPDATE_SPACE_MARGIN_MB=0 update_space_check "$1" git "$2" 0 || true; echo "$UPDATE_SPACE_NEED_KB $UPDATE_SPACE_FREE_KB $(update_disk_free_kb "$1")"`, 'x', s.app, backup], { cwd: s.app, encoding: 'utf8', env: { ...process.env, BACKUP_DIR: backups } }).trim().split(' ').map(Number);
    const [without] = probe('0');
    const [withBackup] = probe('1');
    expect(withBackup - without).toBeGreaterThanOrEqual(5 * 1024);
    write(path.join(s.app, '.build-next/stale.bin'), 'x'.repeat(3 * 1024 * 1024));
    const [, counted, diskFree] = probe('1');
    // the two free-space reads are a moment apart while other test files write and remove files on the same disk
    // (v10.3.21: 3056 KB seen in CI), so the 3 MB stale folder is proven by a 2 MB gap; without it the gap is about 0
    expect(counted - diskFree).toBeGreaterThanOrEqual(2 * 1024);
  });
});

describe('update_swap_old_prev_before_marker_obs_r1_22', () => {
  itRunsUpdate('removes the older .prev folders before the swap marker exists, so a kill there leaves nothing for the repair to move in', () => {
    const s = scratch();
    expect(runUpdate(s).status).toBe(0);
    rmSync(path.join(dir, 'mv.count.log'), { force: true });
    const again = runUpdate(s, {}, ['--rebuild']);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    const calls = read(path.join(dir, 'mv.count.log')).trim().split('\n');
    const aside = calls.filter(c => /\.build-next\/\.old-/.test(c));
    expect(aside.length).toBe(2);
    for (const c of aside) expect(c).toContain('marker=0');
    // every rename made under the marker happens after the older build is gone
    for (const c of calls.filter(c => c.includes('marker=1'))) expect(c).toContain('old=0');
    expect(existsSync(path.join(s.app, '.build-next/.old-dist'))).toBe(false);

    // a kill while the older build is set aside: no marker, the running build and its rollback stay whole
    const s2 = s;
    const cut = runUpdate(s2, { STUB_MV_FAIL_AT: '2' }, ['--rebuild']);
    expect(cut.status).not.toBe(0);
    expect(existsSync(path.join(s2.app, '.update-swapping'))).toBe(false);
    expect(read(path.join(s2.app, 'dist/version.txt'))).toBe('new\n');
    expect(read(path.join(s2.app, 'node_modules.prev/marker'))).toBe('new\n');
  });
});

describe('update_rehearsal_space_reads_database_obs_r1_22', () => {
  it('reads the database size with the URL in the environment, never on a command line, and falls back to the newest dump', () => {
    const s = scratch();
    write(path.join(s.bin, 'node'), '#!/usr/bin/env bash\necho "$*" >> "$STUB_NODE_ARGS"\n[ -n "$UPDATE_DB_URL" ] && [ -z "$STUB_NODE_FAILS" ] && echo 17301504 || exit 1\n');
    chmodSync(path.join(s.bin, 'node'), 0o755);
    const args = path.join(dir, 'node.args');
    const url = 'postgresql://erp:S3cret-pw@localhost:5432/erp';
    const backups = path.join(dir, 'backups');
    const need = (fails: string) => Number(execFileSync('bash', ['-c', 'source scripts/update-steps.sh; update_rehearsal_need_kb "$1" "$2" "$3"', 'x', s.app, url, backups], {
      cwd: s.app, encoding: 'utf8', env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, STUB_NODE_ARGS: args, STUB_NODE_FAILS: fails },
    }).trim());
    expect(need('')).toBe(Math.floor(17301504 * 2 / 1024));
    expect(read(args)).not.toContain('S3cret-pw');
    expect(need('1')).toBe(0);
    write(path.join(backups, 'erp_pre-deployment_20261018_010000.dump.gz'), 'x'.repeat(1024 * 1024));
    expect(need('1')).toBe(1024 * 1024 * 10 * 2 / 1024);
  });
});

describe('update_followups_obs_r1_22', () => {
  it('keeps the log writer alive when the SSH session drops', () => {
    expect(read(path.join(ROOT, 'update.sh'))).toContain(`exec > >(trap '' HUP; exec tee -a "$LOG_FILE") 2>&1`);
  });

  it('the check after the source step says the backup and source are done and the running build is untouched', () => {
    const s = scratch();
    const msg = execFileSync('bash', ['-c', 'source scripts/update-steps.sh; UPDATE_SPACE_MARGIN_MB=999999999 update_space_check "$1" git 0 0 1 || echo "$UPDATE_SPACE_MESSAGE"', 'x', s.app], { cwd: s.app, encoding: 'utf8' });
    expect(msg).toContain('the running build and the service are untouched');
    expect(msg).not.toContain('Nothing was changed');
  });

  itRunsUpdate('a run stopped by a signal ends non-zero and prints the rollback (N-A)', async () => {
    const s = scratch();
    const started = path.join(dir, 'build.started');
    const { spawn } = await import('node:child_process');
    const child = spawn('bash', [path.join(s.app, 'update.sh'), '--no-backup', '--source', s.src], {
      cwd: dir, env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, APP_DIR: s.app, STUB_APP_DIR: s.app, STUB_LOG: s.log,
        STUB_MV_COUNT: path.join(dir, 'mv.count'), STUB_BUILD_FAILS: '', STUB_BUILD_HANGS: started, NODE_ENV: '' },
      detached: true,
    });
    let out = '';
    child.stdout.on('data', d => { out += String(d); });
    const exited = new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));
    for (let i = 0; i < 100 && !existsSync(started); i++) await new Promise(r => setTimeout(r, 100));
    expect(existsSync(started)).toBe(true);
    // the whole process group, as a dropped SSH session does (the log writer ignores the hang-up)
    process.kill(-(child.pid as number), 'SIGHUP');
    expect(await exited).toBe(129);
    expect(out).toContain('Rollback: the service still runs the previous build');
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('old');
  }, 40_000);

  itRunsUpdate('names the commit of a build made before v10.2.23 from its build-info.json and says nothing of a missing dist.prev', () => {
    const s = scratch();
    // v10.2.28 (#339 review N-B): the format scripts/write-build-info.mjs writes
    write(path.join(s.app, 'dist/build-info.json'), `${JSON.stringify({ gitCommit: 'f6daa01d', buildTime: '2026-10-18T04:30:00.000Z' }, null, 2)}\n`);
    const commit = execFileSync('bash', ['-c', 'source scripts/update-steps.sh; update_dist_commit "$1/dist"', 'x', s.app], { cwd: s.app, encoding: 'utf8' }).trim();
    expect(commit).toBe('f6daa01d');
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('dist.prev/ holds the previous build, of f6daa01d');
    rmSync(path.join(s.app, 'dist.prev'), { recursive: true });
    const again = runUpdate(s);
    expect(again.stdout).toContain('dist/ is already built from this source');
    expect(again.stdout).not.toContain('dist.prev/ still holds');
  });

  itRunsUpdate('runs a new update.sh again only when it knows how to continue', () => {
    const s = scratch();
    write(path.join(s.src, 'update.sh'), '#!/usr/bin/env bash\necho "an update.sh without the resume step"\n');
    const run = runUpdate(s);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).not.toContain('continuing with it');
    expect(run.stdout).not.toContain('an update.sh without the resume step');
    expect(read(path.join(s.app, 'dist/version.txt'))).toBe('new\n');
  });
});
