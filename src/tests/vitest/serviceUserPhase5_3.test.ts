// @vitest-environment node
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

// v11 phase 5.3 (TD-1354): a new install runs the service as its own user, and root never works by path in that user's
// folders. The scripts run for real in made-up folders; the whole install runs in CI (linux-install).

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const isRoot = process.getuid?.() === 0;
const dirs: string[] = [];
const tmp = (prefix: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const bash = (code: string, env: NodeJS.ProcessEnv = {}) => spawnSync('bash', ['-c', code], { encoding: 'utf8', env: { ...process.env, ...env } });

describe('service_user_detection: update.sh takes the user of the service from its unit', () => {
  function detect(systemctlUser: string, unitBody: string | null) {
    const dir = tmp('svc-user-');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/bash\necho "${systemctlUser}"`, { mode: 0o755 });
    if (unitBody !== null) fs.writeFileSync(path.join(dir, 'papital-erp.service'), unitBody);
    const r = bash(`source "${ROOT}/scripts/update-steps.sh"; update_service_user papital-erp`,
      { PATH: `${bin}:${process.env.PATH}`, SYSTEMD_UNIT_DIR: dir });
    return r.stdout.trim();
  }

  it('User= of the unit, else root; a user that does not exist is root', () => {
    expect(detect('nobody', null)).toBe('nobody');
    expect(detect('', '[Service]\nUser=nobody\nGroup=nogroup\n')).toBe('nobody');
    expect(detect('', '[Service]\nExecStart=/usr/bin/node dist/server.cjs\n')).toBe('root');
    expect(detect('', null)).toBe('root');
    expect(detect('no-such-user-5-3', null)).toBe('root');
  });

  it('the cron jobs keep the user of the cron file, and without one take the user of the service', () => {
    const dir = tmp('svc-cron-user-');
    const cron = path.join(dir, 'cron');
    const user = (env: NodeJS.ProcessEnv) => bash(`source "${ROOT}/scripts/update-steps.sh"; update_ops_cron_user "${dir}"`, { CRON_FILE: cron, ...env }).stdout.trim();
    expect(user({ UPDATE_SERVICE_USER: 'nobody' })).toBe('nobody');
    fs.writeFileSync(cron, `30 2 * * * root bash ${dir}/scripts/backup.sh >> ${dir}/logs/backup.log 2>&1\n`);
    expect(user({ UPDATE_SERVICE_USER: 'nobody' })).toBe('root');
  });

  it('the pre-deployment backup runs as the service user, and logs/ modes change only in a folder of root', () => {
    const update = read('update.sh');
    expect(update).toContain('UPDATE_SERVICE_USER="$(update_service_user "$SERVICE_NAME")"');
    expect(update).toMatch(/as_service_user env BACKUP_KIND=pre-deployment [^\n]*bash scripts\/backup\.sh/);
    expect(update).toContain('if [ -d logs ] && [ ! -L logs ] && [ -O logs ]; then');
  });
});

describe('service_user_cron: the nightly check runs as root and its log is written by the service user', () => {
  function cronFor(user: string) {
    const app = tmp('svc-cron-');
    fs.mkdirSync(path.join(app, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts/install-ops-cron.sh'), path.join(app, 'scripts/install-ops-cron.sh'));
    fs.writeFileSync(path.join(app, 'scripts/backup.sh'), '');
    const cron = path.join(app, 'cron');
    const r = spawnSync('bash', [path.join(app, 'scripts/install-ops-cron.sh'), user], { encoding: 'utf8', env: { ...process.env, APP_DIR: app, CRON_FILE: cron } });
    expect(r.status, r.stderr).toBe(0);
    return { app, cron: fs.readFileSync(cron, 'utf8') };
  }

  it('a service user: root never opens the log in that user\'s folder', () => {
    const { app, cron } = cronFor('nobody');
    expect(cron).toContain(`root bash ${app}/scripts/nightly-verify.sh 2>&1 | runuser -u nobody -- tee -a ${app}/logs/nightly-verify.log >/dev/null`);
    expect(cron).toContain(`nobody bash ${app}/scripts/backup.sh >> ${app}/logs/backup.log 2>&1`);
  });

  it('a root install keeps its line as it was', () => {
    const { app, cron } = cronFor('root');
    expect(cron).toContain(`root bash ${app}/scripts/nightly-verify.sh >> ${app}/logs/nightly-verify.log 2>&1`);
    expect(cron).not.toContain('runuser');
  });
});

describe('service_user_env_mode: .env stays readable for the group of the service', () => {
  function modeAfter(group: string | null, mode = 0o640) {
    const dir = tmp('svc-env-');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'NODE_ENV=production\n', { mode });
    fs.chmodSync(env, mode);
    if (group) spawnSync('chgrp', [group, env]);
    const r = spawnSync('bash', [path.join(ROOT, 'scripts/ensure-env-secrets.sh'), env, 'METRICS_TOKEN'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return (fs.statSync(env).mode & 0o777).toString(8);
  }

  it('a .env of the owner\'s own group is 600, one given to another group (install.sh) is 640', () => {
    expect(modeAfter(null)).toBe('600');
    if (isRoot) expect(modeAfter('nogroup')).toBe('640');
    // a root .env of another group (root:adm) that nobody gave the group read keeps none
    if (isRoot) expect(modeAfter('nogroup', 0o600)).toBe('600');
    for (const rel of ['scripts/ensure-env-secrets.sh', 'setup-domain.sh']) {
      expect(read(rel)).not.toMatch(/^chmod 600 /m);
    }
  });
});

describe('service_user_restore: restore.sh puts the uploads back owned by the user that owns them', () => {
  /** the backup readers, unpack_archive and place_archive of restore.sh, run on their own */
  function restoreFunctions() {
    const s = read('scripts/restore.sh');
    return s.slice(s.indexOf('as_owner() {'), s.indexOf('# end of the backup readers'))
      + s.slice(s.indexOf('unpack_archive() {'), s.indexOf('unpack_archive "$UPLOADS_ARCHIVE" "$UPLOADS_DIR"'));
  }
  /** unpacks <archive> into <target> as restore.sh apply does; the dump sits beside the archive */
  function unpackInto(dir: string, archive: string, target: string, uploads = target) {
    return bash(`set -euo pipefail
log() { echo "$*"; }; fail() { echo "FAIL $*"; exit 1; }
UNPACK_DIRS=(); UPLOADS_DIR="${uploads}"; TIMESTAMP=t; WORK_DIR="$(mktemp -d)"
BACKUP_FILE="${path.join(path.dirname(archive), 'erp_daily_1.dump.gz')}"
${restoreFunctions()}
unpack_archive "${archive}" "${target}"
place_archive "${archive}" "$UNPACKED" "${target}"`);
  }
  /** a backup archive of one folder <name> under <dir>/src, made by <fill> */
  function archiveOf(dir: string, name: string, fill: (folder: string) => void) {
    const src = path.join(dir, 'src', name);
    fs.mkdirSync(src, { recursive: true });
    fill(src);
    const archive = path.join(dir, `erp_daily_1_${name}.tar.gz`);
    const r = spawnSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), name]);
    expect(r.status, String(r.stderr)).toBe(0);
    return archive;
  }

  it.runIf(isRoot)('the owner of the folder unpacks the files, in a folder root made for it beside them', () => {
    const dir = tmp('svc-restore-');
    fs.chmodSync(dir, 0o755);
    const app = path.join(dir, 'app');
    const uploads = path.join(app, 'public/uploads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, 'old.png'), 'old');
    spawnSync('chown', ['-R', 'nobody', uploads]);
    // the archive of a backup: one folder, its files owned by root
    const src = path.join(dir, 'src/uploads');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.png'), 'a');
    const archive = path.join(dir, 'erp_daily_1_uploads.tar.gz');
    spawnSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), 'uploads']);
    const r = unpackInto(dir, archive, uploads);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(uploads, 'a.png'), 'utf8')).toBe('a');
    expect(fs.statSync(uploads).uid).toBe(65534);
    expect(fs.statSync(path.join(uploads, 'a.png')).uid).toBe(65534);
    expect(fs.existsSync(path.join(`${uploads}.before_restore_t`, 'old.png'))).toBe(true);
  });

  it.runIf(isRoot)('in a folder of another user root unpacks as that user', () => {
    const dir = tmp('svc-restore-other-');
    fs.chmodSync(dir, 0o755);
    const state = path.join(dir, 'state');
    const target = path.join(state, 'attachments');
    fs.mkdirSync(target, { recursive: true });
    spawnSync('chown', ['-R', 'nobody', state]);
    const src = path.join(dir, 'src/attachments');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'b.pdf'), 'b');
    const archive = path.join(dir, 'erp_daily_1_attachments.tar.gz');
    spawnSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), 'attachments']);
    const r = unpackInto(dir, archive, target, `${dir}/elsewhere`);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.statSync(target).uid).toBe(65534);
    expect(fs.statSync(path.join(target, 'b.pdf')).uid).toBe(65534);
  });

  it('an archive of more than one folder is refused, and one folder is unpacked straight into the folder root moves', () => {
    expect(read('scripts/restore.sh')).toContain('--strip-components=1 -C "$unpack" < "$copy"');
    const dir = tmp('svc-restore-two-');
    const uploads = path.join(dir, 'app/public/uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const src = path.join(dir, 'src');
    for (const d of ['uploads', 'other']) { fs.mkdirSync(path.join(src, d), { recursive: true }); fs.writeFileSync(path.join(src, d, 'a'), d); }
    const archive = path.join(dir, 'erp_daily_1_uploads.tar.gz');
    spawnSync('tar', ['-czf', archive, '-C', src, 'uploads', 'other']);
    const r = unpackInto(dir, archive, uploads);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('does not hold exactly one folder');
    expect(fs.readdirSync(path.dirname(uploads))).toEqual(['uploads']);
  });

  it('an archive holding a link is refused and nothing is changed', () => {
    const dir = tmp('svc-restore-link-');
    const uploads = path.join(dir, 'app/public/uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const archive = archiveOf(dir, 'uploads', src => fs.symlinkSync('/etc/passwd', path.join(src, 'x.png')));
    const r = unpackInto(dir, archive, uploads);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('holds something other than folders and plain files');
    expect(fs.readdirSync(path.dirname(uploads))).toEqual(['uploads']);
  });

  it.runIf(isRoot)('a device or a set-id file in the archive is refused, so root never makes one', () => {
    for (const fill of [
      (src: string) => spawnSync('mknod', [path.join(src, 'sda'), 'b', '8', '0']),
      (src: string) => { fs.writeFileSync(path.join(src, 'run'), '#!/bin/sh\n'); fs.chmodSync(path.join(src, 'run'), 0o4755); },
    ]) {
      const dir = tmp('svc-restore-dev-');
      fs.chmodSync(dir, 0o755);
      const uploads = path.join(dir, 'app/public/uploads');
      fs.mkdirSync(uploads, { recursive: true });
      const r = unpackInto(dir, archiveOf(dir, 'uploads', fill), uploads);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toContain('holds something other than folders and plain files');
      expect(fs.readdirSync(path.dirname(uploads))).toEqual(['uploads']);
    }
  });

  it.runIf(isRoot)('root reads a backup of the service user as that user, so a link there reaches nothing of root\'s', () => {
    const dir = tmp('svc-restore-mixed-');
    fs.chmodSync(dir, 0o755);
    const backups = path.join(dir, 'backups');
    fs.mkdirSync(backups);
    const uploads = path.join(dir, 'app/public/uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const archive = archiveOf(backups, 'uploads', src => fs.writeFileSync(path.join(src, 'a.png'), 'a'));
    spawnSync('chown', ['-R', 'nobody', backups, uploads]);
    // the service user's archive is a link to a file only root reads: it is read as that user, so nothing comes of it
    const secret = path.join(dir, 'secret.tar.gz');
    fs.renameSync(archive, secret);
    fs.chmodSync(secret, 0o600);
    fs.symlinkSync(secret, archive);
    const linked = unpackInto(dir, archive, uploads);
    expect(linked.status).toBe(1);
    expect(linked.stdout).toContain('cannot read');
    expect(fs.readdirSync(uploads)).toEqual([]);
  });
});

describe('service_user_install: install.sh makes the user, gives it only what the app writes and hardens the unit', () => {
  const install = read('install.sh');

  it('a system user with a home of its own, .env through its group, the state folders and backups owned by it', () => {
    expect(install).toContain('SERVICE_USER="${SERVICE_USER:-papital}"');
    expect(install).toContain('useradd --system --user-group --home-dir "/var/lib/${SERVICE_USER}"');
    expect(install).toMatch(/chown "\$\(id -un\):\$\{SERVICE_GROUP\}" \.env\n\s+chmod 640 \.env/);
    expect(install).toContain('$SUDO install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$dir"');
    // a link in place of a state folder is left alone, and in a folder of the service user that user makes the folder
    expect(install).toMatch(/if \[ -L "\$dir" \]; then\n\s+warn "\$dir is a link/);
    expect(install).toContain('as_service_user install -d -m 750 "$dir"');
    expect(install).toContain('$SUDO install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "${BACKUP_DIR_ENV:-/var/backups/erp}"');
    expect(install).toContain('bash scripts/install-ops-cron.sh "$SERVICE_USER"');
    // the code is not writable for the service user, whatever a zip or the umask gave it
    expect(install).toMatch(/^umask 022$/m);
    expect(read('update.sh')).toMatch(/^umask 022$/m);
    expect(install).toContain('-prune -o ! -type l -perm /o=w -exec chmod o-w {} +');
  });

  it('the unit runs as that user with the hardening options', () => {
    for (const line of ['User=${SERVICE_USER}', 'Group=${SERVICE_GROUP}', 'UMask=0027', 'NoNewPrivileges=true', 'PrivateTmp=true',
      'ProtectSystem=full', 'ProtectKernelTunables=true', 'ProtectKernelModules=true', 'ProtectControlGroups=true',
      'RestrictSUIDSGID=true', 'LockPersonality=true']) {
      expect(install).toContain(`\n${line}\n`);
    }
    expect(install).not.toContain('User=$(id -un)');
  });

  it('PostgreSQL 16 only, never the contrib package of PGDG that pulls in its newest major', () => {
    expect(install).toContain('if [ -x /usr/lib/postgresql/16/bin/postgres ]; then');
    expect(install).not.toMatch(/apt-get install -y[^\n]*postgresql-contrib/);
    expect(install).not.toContain("grep -oE '^[0-9]+'");
  });
});
