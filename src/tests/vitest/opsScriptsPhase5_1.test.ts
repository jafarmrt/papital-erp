import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { alertText, monitorHarness } from './helpers/monitorHarness';

// v11 phase 5.1: the backup and monitor scripts, findings O3, O7, O13, O14, O16 and O18 of the phase 2 server evaluation.
// The scripts run for real in made-up folders; nothing here needs a database (O15, the restore log, is checked by the
// backup-restore recovery suite against PostgreSQL).

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const dirs: string[] = [];
const tmp = (prefix: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** Runs bash code with scripts/ops-lock.sh sourced; resolves with its exit code and output once it ends */
function opsLock(code: string, env: Record<string, string> = {}) {
  const child = spawn('bash', ['-c', `set -euo pipefail\nsource "${path.join(ROOT, 'scripts/ops-lock.sh')}"\n${code}`], {
    env: { ...process.env, OPS_LOCK_POLL_SECONDS: '1', ...env },
  });
  let out = '';
  child.stdout.on('data', c => { out += String(c); });
  child.stderr.on('data', c => { out += String(c); });
  const done = new Promise<{ code: number | null; out: string; at: number }>(resolve => child.on('close', c => resolve({ code: c, out, at: Date.now() })));
  return { done, output: () => out };
}
const waitFor = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 50));
  }
};

describe('ops_locks_o13_o18: a daily backup and an update never run their database work at the same time', () => {
  it('a daily backup that starts during an update waits for it, and lets the busy lock go while it waits', async () => {
    const app = tmp('ops-lock-');
    // the update: holds .update.lock, then waits for the busy lock like update.sh, and ends after 3 s
    const update = opsLock(`exec 9>"$1/.update.lock"; flock -n 9; echo update-started
sleep 1; ops_wait_idle "$1" 20 && echo update-idle; sleep 2; echo update-done`.replace(/\$1/g, app));
    await waitFor(() => update.output().includes('update-started'));
    const backup = opsLock(`ops_backup_wait_for_update "${app}" 60; echo backup-runs`);
    const [u, b] = await Promise.all([update.done, backup.done]);
    expect(u.code, u.out).toBe(0);
    // the update was not held up by the waiting backup (no deadlock), and the backup ran only after the update ended
    expect(u.out).toContain('update-idle');
    expect(b.code, b.out).toBe(0);
    expect(b.out).toContain('An update is running');
    expect(b.out).not.toContain('runs anyway');
    expect(b.at).toBeGreaterThanOrEqual(u.at);
  }, 30_000);

  it('an update that starts during a backup waits for it to finish; one that waits too long stops before changing anything', async () => {
    const app = tmp('ops-lock-');
    const backup = opsLock(`ops_busy_hold "${app}"; echo backup-started; sleep 3; echo backup-done`);
    await waitFor(() => backup.output().includes('backup-started'));
    const update = opsLock(`exec 9>"${app}/.update.lock"; flock -n 9; ops_wait_idle "${app}" 20 && echo update-idle`);
    const [b, u] = await Promise.all([backup.done, update.done]);
    expect(u.out).toContain('waiting for it to finish');
    expect(u.out).toContain('update-idle');
    expect(u.at).toBeGreaterThanOrEqual(b.at);

    const long = opsLock(`ops_busy_hold "${app}"; echo held; sleep 6`);
    await waitFor(() => long.output().includes('held'));
    const refused = await opsLock(`ops_wait_idle "${app}" 2 || echo gave-up`).done;
    expect(refused.out).toContain('gave-up');
    await long.done;
  }, 30_000);

  it('a stuck update does not cost the night its backup', async () => {
    const app = tmp('ops-lock-');
    const update = opsLock(`exec 9>"${app}/.update.lock"; flock -n 9; echo held; sleep 8`);
    await waitFor(() => update.output().includes('held'));
    const backup = await opsLock(`ops_backup_wait_for_update "${app}" 2; echo backup-runs`).done;
    expect(backup.out).toContain('the backup runs anyway');
    expect(backup.out).toContain('backup-runs');
    await update.done;
  }, 30_000);

  it('the scripts use the locks: the daily backup waits, the other backups, restores and rehearsals hold the busy lock, update.sh waits for them', () => {
    const backup = read('scripts/backup.sh');
    expect(backup).toMatch(/if \[ "\$BACKUP_KIND" = "daily" \]; then\n\s+ops_backup_wait_for_update "\$APP_DIR"/);
    expect(backup).toMatch(/else\n\s+ops_busy_hold "\$APP_DIR"/);
    for (const f of ['scripts/restore.sh', 'scripts/upgrade-rehearsal.sh']) expect(read(f), f).toMatch(/^ops_busy_hold "\$APP_DIR"$/m);
    expect(read('update.sh')).toContain('ops_wait_idle "$APP_DIR" "${UPDATE_OPS_WAIT_SECONDS:-1800}"');
    // update.sh runs its own pre-deployment backup inside the update: that kind must not wait for the update
    expect(read('update.sh')).toContain('BACKUP_KIND=pre-deployment');
  });
});

describe('ops_lock_files_readable: a non-root service still sees the locks root made', () => {
  it('the busy lock file of its owner becomes readable by all, and update.sh keeps lock files readable when it tightens logs/', () => {
    const app = tmp('ops-lock-mode-');
    fs.mkdirSync(path.join(app, 'logs'));
    const lock = path.join(app, 'logs/.ops-busy.lock');
    fs.writeFileSync(lock, '', { mode: 0o600 });
    fs.chmodSync(lock, 0o600);
    const r = spawnSync('bash', ['-c', `source "${path.join(ROOT, 'scripts/ops-lock.sh')}"; ops_busy_hold "${app}"`], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.statSync(lock).mode & 0o777).toBe(0o644);
    // the line update.sh runs on logs/ before the restart
    const line = /^\s*(find logs -maxdepth 1 -type f .*-exec chmod o-rwx \{\} \+).*$/m.exec(read('update.sh'))?.[1];
    expect(line).toBeTruthy();
    fs.writeFileSync(path.join(app, 'logs/application.log'), 'x', { mode: 0o644 });
    fs.chmodSync(path.join(app, 'logs/application.log'), 0o644);
    const u = spawnSync('bash', ['-c', line ?? 'false'], { cwd: app, encoding: 'utf8' });
    expect(u.status, u.stderr).toBe(0);
    expect(fs.statSync(path.join(app, 'logs/application.log')).mode & 0o777).toBe(0o640);
    expect(fs.statSync(lock).mode & 0o777).toBe(0o644);
  });

  it('update.sh makes .update.lock readable whatever root umask, and waits a moment for a lock check instead of refusing', () => {
    const update = read('update.sh');
    const make = update.indexOf('( umask 022; : >> "$APP_DIR/$UPDATE_LOCK_NAME" ) && chmod 644 "$APP_DIR/$UPDATE_LOCK_NAME"');
    expect(make).toBeGreaterThan(0);
    expect(make).toBeLessThan(update.indexOf('exec 9>"$APP_DIR/$UPDATE_LOCK_NAME"'));
    expect(update).toContain('flock -w 10 9 || die');
    expect(update).not.toContain('flock -n 9');
  });

  it('the daily backup lets the busy lock go before the off-server upload', () => {
    const backup = read('scripts/backup.sh');
    expect(backup.indexOf('ops_busy_release')).toBeGreaterThan(0);
    expect(backup.indexOf('ops_busy_release')).toBeLessThan(backup.indexOf('scripts/backup-offsite.sh" "$BASE"'));
  });
});

describe('cron_exec_bits_o3: a zip without unix modes no longer stops the backup and the monitor', () => {
  it('every shell script of the source is executable in git, and a manual sync puts the bits back', () => {
    const tracked = spawnSync('git', ['ls-files', '-s', '--', '*.sh'], { cwd: ROOT, encoding: 'utf8' });
    if (tracked.status === 0 && tracked.stdout.trim()) {
      const rows = tracked.stdout.trim().split('\n').map(l => l.split(/\s+/)).filter(([, , , f]) => /^(scripts\/)?[^/]+\.sh$/.test(f));
      expect(rows.length).toBeGreaterThan(15);
      expect(rows.filter(([mode]) => mode !== '100755').map(([, , , f]) => f)).toEqual([]);
    }
    const app = tmp('exec-bits-');
    fs.mkdirSync(path.join(app, 'scripts'));
    for (const f of ['update.sh', 'scripts/backup.sh', 'scripts/monitor.sh']) fs.writeFileSync(path.join(app, f), '#!/bin/bash\n', { mode: 0o644 });
    fs.writeFileSync(path.join(app, 'scripts/notes.txt'), 'x', { mode: 0o644 });
    const r = spawnSync('bash', ['-c', `source "${path.join(ROOT, 'scripts/update-steps.sh')}"; update_fix_exec_bits "$1"`, 'x', app], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    for (const f of ['update.sh', 'scripts/backup.sh', 'scripts/monitor.sh']) expect(fs.statSync(path.join(app, f)).mode & 0o111, f).toBe(0o111);
    expect(fs.statSync(path.join(app, 'scripts/notes.txt')).mode & 0o111).toBe(0);
    expect(read('scripts/update-steps.sh').match(/update_fix_exec_bits "\$app_dir"/g)).toHaveLength(2);
    expect(read('install.sh')).toContain('chmod a+x ./*.sh scripts/*.sh');
  });

  it('every cron job runs its script through bash, so a script without its executable bit still runs', () => {
    const dir = tmp('ops-cron-');
    const cronFile = path.join(dir, 'papital-erp');
    const run = spawnSync('bash', [path.join(ROOT, 'scripts/install-ops-cron.sh'), os.userInfo().username], {
      encoding: 'utf8', env: { ...process.env, CRON_FILE: cronFile, APP_DIR: ROOT },
    });
    expect(run.status, run.stderr).toBe(0);
    const jobs = fs.readFileSync(cronFile, 'utf8').split('\n').filter(l => /^[0-9*]/.test(l));
    expect(jobs).toHaveLength(4);
    for (const job of jobs) expect(job).toMatch(new RegExp(`^\\S+ \\S+ \\* \\* \\* \\S+ bash ${ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/scripts/[a-z-]+\\.sh >> `));
  });
});

describe('pg_password_env_o14: an exported PGPASSWORD no longer beats the password file the scripts write', () => {
  it('becomes the last line for any server and leaves the environment; the URL lines come first', () => {
    const dir = tmp('pg-password-');
    const r = spawnSync('bash', ['-c', `set -euo pipefail
. "$1/scripts/pg-password.sh"
pg_password_setup "$2"
echo "env=\${PGPASSWORD-unset}"`, 'x', ROOT, dir], {
      encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DATABASE_URL: 'postgresql://app:right@localhost:5432/erp', PGPASSWORD: 'other:db' },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('env=unset');
    expect(fs.readFileSync(path.join(dir, 'pgpass'), 'utf8')).toBe('localhost:5432:*:app:right\n*:*:*:*:other\\:db\n');
    expect(read('scripts/nightly-verify.sh')).toMatch(/^pg_password_fold_env$/m);
  });
});

describe('monitor_media_copy_o7: the monitor watches the copy of the media library', () => {
  const h = monitorHarness();
  const report = (r: Record<string, unknown>) => fs.writeFileSync(path.join(h.dir, 'logs', 'media-offsite.json'),
    `${JSON.stringify({ version: 1, files: 3, bytes: 99, remote: 'papital-crypt', error: '', ...r })}\n`);
  const hoursAgo = (n: number) => Math.floor(Date.now() / 1000) - n * 3600;
  const fresh = (remote = true) => {
    h.fresh(remote ? 'MEDIA_RCLONE_REMOTE=papital-crypt:\n' : '');
    fs.mkdirSync(path.join(h.dir, 'logs'), { recursive: true });
  };

  it('a failed night, an old copy and no copy after a day are each reported once; a recent copy is quiet', async () => {
    fresh();
    report({ state: 'ok', at: hoursAgo(5), lastOkAt: hoursAgo(5) });
    expect((await h.monitor()).code).toBe(0);
    expect(h.srv.sent).toEqual([]);

    report({ state: 'failed', at: hoursAgo(1), lastOkAt: hoursAgo(25), error: 'copy-failed' });
    expect((await h.monitor()).code).toBe(1);
    expect(h.srv.sent.join('\n')).toContain(alertText('media_failed'));

    fresh();
    report({ state: 'ok', at: hoursAgo(30), lastOkAt: hoursAgo(30) });
    await h.monitor();
    expect(h.srv.sent.join('\n')).toContain(alertText('media_stale', 30));

    fresh();
    fs.mkdirSync(h.stateDir, { recursive: true });
    fs.writeFileSync(path.join(h.stateDir, 'first_run'), String(hoursAgo(30)));
    await h.monitor();
    expect(h.srv.sent.join('\n')).toContain(alertText('media_missing'));

    // a report of the time before the remote was set: no copy yet, quiet on the first day
    fresh();
    report({ state: 'off', at: hoursAgo(2), lastOkAt: null, remote: '' });
    expect((await h.monitor()).code).toBe(0);
  }, 60_000);

  it('without MEDIA_RCLONE_REMOTE the copy is off and nothing is said about it', async () => {
    fresh(false);
    report({ state: 'failed', at: hoursAgo(1), lastOkAt: null });
    expect((await h.monitor()).code).toBe(0);
    expect(h.srv.sent).toEqual([]);
  }, 30_000);
});

describe('restore_media_o7: the media library comes back from its off-server copy', () => {
  /** An app folder and a stand-in rclone whose «papital-crypt:» remote is a local folder */
  function fakeMedia(remoteType = 'crypt') {
    const dir = tmp('restore-media-');
    const app = path.join(dir, 'app');
    const remote = path.join(dir, 'remote');
    const bin = path.join(dir, 'bin');
    for (const d of [path.join(app, 'scripts'), path.join(remote, 'media-library/originals/ab'), bin]) fs.mkdirSync(d, { recursive: true });
    for (const f of ['restore-media.sh', 'env-file.sh']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(app, 'scripts', f));
    fs.writeFileSync(path.join(app, '.env'), 'MEDIA_RCLONE_REMOTE=papital-crypt:\n');
    fs.writeFileSync(path.join(remote, 'media-library/originals/ab/abc.jpg'), 'photo');
    fs.writeFileSync(path.join(remote, 'media-library/originals/ab/abd.jpg'), 'other');
    fs.writeFileSync(path.join(bin, 'rclone'), `#!/bin/bash
echo "rclone $*" >> "${dir}/calls.log"
map() { echo "\${1/papital-crypt:/${remote}/}"; }
case "$1" in
  listremotes) echo "papital-crypt: ${remoteType}" ;;
  copy) src="$(map "$2")"; mkdir -p "$3"; (cd "$src" && find . -type f) | while read -r f; do [ -e "$3/$f" ] || { mkdir -p "$(dirname "$3/$f")"; cp "$src/$f" "$3/$f"; }; done ;;
  check) diff -r "$(map "$2")" "$3" >/dev/null ;;
esac`, { mode: 0o755 });
    const run = () => spawnSync('bash', [path.join(app, 'scripts/restore-media.sh')], {
      encoding: 'utf8', env: { ...process.env, APP_DIR: app, PATH: `${bin}:${process.env.PATH}`, MEDIA_RCLONE_REMOTE: '', MEDIA_DIR: '' },
    });
    return { app, dir, run, calls: () => fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') };
  }

  it('copies the originals the server lacks, keeps those it has, checks them and names the next step', () => {
    const m = fakeMedia();
    fs.mkdirSync(path.join(m.app, 'media-library/originals/ab'), { recursive: true });
    fs.writeFileSync(path.join(m.app, 'media-library/originals/ab/abd.jpg'), 'other');
    const r = m.run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(m.app, 'media-library/originals/ab/abc.jpg'), 'utf8')).toBe('photo');
    expect(m.calls()).toContain('rclone copy papital-crypt:media-library/originals');
    expect(m.calls()).toContain('--ignore-existing');
    expect(r.stdout).toContain('npm run media:rebuild-light -- --apply');
  });

  it.runIf(process.getuid?.() === 0)('run by root for an install of another user it stops and names the command, and copies nothing', () => {
    const m = fakeMedia();
    spawnSync('chown', ['-R', 'nobody', m.app]);
    const r = m.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`sudo -u nobody bash ${m.app}/scripts/restore-media.sh`);
    expect(fs.existsSync(path.join(m.app, 'media-library'))).toBe(false);
  });

  it('refuses a remote that is not encrypted and a missing setting, and changes nothing', () => {
    const plain = fakeMedia('drive');
    const r = plain.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('not crypt');
    expect(fs.existsSync(path.join(plain.app, 'media-library'))).toBe(false);
    const none = fakeMedia();
    fs.writeFileSync(path.join(none.app, '.env'), '');
    expect(none.run().status).toBe(1);
  });
});

describe('private_logs_o16: the server logs are not readable by other users', () => {
  it('the log folder is 0750 (an older 0755 one is tightened) and its files 0640, with no colour codes off a terminal', () => {
    const dir = tmp('log-mode-');
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs, { mode: 0o755 });
    fs.chmodSync(logs, 0o755);
    const script = path.join(dir, 'log.mts');
    fs.writeFileSync(script, `import '${path.join(ROOT, 'src/lib/processFileMode.ts')}';
const { logger } = await import('${path.join(ROOT, 'src/middleware/logger.ts')}');
logger.error('mode probe');
await new Promise(r => setTimeout(r, 500));
process.exit(0);
`);
    const r = spawnSync(path.join(ROOT, 'node_modules/.bin/tsx'), [script], {
      encoding: 'utf8', cwd: dir, env: { ...process.env, LOG_DIR: logs, NODE_ENV: 'production' }, timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.statSync(logs).mode & 0o777).toBe(0o750);
    const files = fs.readdirSync(logs).filter(f => f.endsWith('.log'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.statSync(path.join(logs, f)).mode & 0o777, f).toBe(0o640);
    expect(r.stdout).toContain('mode probe');
    // eslint-disable-next-line no-control-regex
    expect(r.stdout).not.toMatch(/\x1b\[/);
    expect(read('server.ts').indexOf("import './src/lib/processFileMode.js'")).toBeLessThan(read('server.ts').indexOf('./src/middleware/logger.js'));
    // a mode option of the rotate transports changes the name of their audit file: logs written before would stay forever
    expect(read('src/middleware/logger.ts')).not.toMatch(/options:\s*\{[^}]*mode/);
  }, 90_000);

  it('update.sh makes the files of an older version private and keeps its own logs for 90 days, readable by root only', () => {
    const update = read('update.sh');
    expect(update).toContain('chmod 750 logs');
    expect(update).toContain('-perm /o=r -exec chmod o-rwx {} +');
    expect(update).toContain("-name 'update-*.log'");
    expect(update).toContain('-mtime +90 -delete');
    for (const f of ['update.sh', 'install.sh', 'setup-domain.sh']) expect(read(f), f).toContain('( umask 077; : >> "$LOG_FILE" )');
  });
});
