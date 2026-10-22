import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// v10.2.24 (OBS-R1-16 / OT-A-07, 10.2 package 13): install.sh finished on /health/live (up even when the database
// password was wrong), kept the old password of a database role left by an earlier install, kept a token of the clone
// URL in .git/config; setup-domain.sh deleted any default Nginx site and left the app port open on every address.
// The blocks of the real scripts run here against scratch folders; CI runs the whole install on Ubuntu 26.04.

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
const scratch = () => (dir = mkdtempSync(path.join(tmpdir(), 'obs-r1-16-')));

/** The text of `file` from the line holding `from` up to (not including) the line holding `to` */
const block = (file: string, from: string, to: string): string => {
  const text = read(file);
  const start = text.lastIndexOf('\n', text.indexOf(from)) + 1;
  const end = text.lastIndexOf('\n', text.indexOf(to, start)) + 1;
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

const bash = (script: string, env: Record<string, string> = {}) =>
  spawnSync('bash', ['-c', `set -euo pipefail\nlog() { echo "$*"; }\nwarn() { echo "WARN: $*"; }\n${script}`], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });

describe('obs_r1_16_install: install.sh', () => {
  const install = read('install.sh');

  it('drops the token of the clone URL from .git/config and warns when one is still there', () => {
    const d = scratch();
    const repo = path.join(d, 'app');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://user:secret-token@example.com/o/r.git']);
    const scrub = block('install.sh', '# v10.2.24 (OBS-R1-16): a token in the clone URL', 'fi\nif git -C "$APP_DIR" remote get-url origin');
    const r = bash(`cd ${JSON.stringify(repo)}\nREPO_URL="$(git remote get-url origin)"\n${scrub}`);
    expect(r.status, r.stderr).toBe(0);
    expect(execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()).toBe('https://example.com/o/r.git');
    expect(r.stdout).toContain('access token in the repository URL was removed');
    expect(r.stdout + r.stderr).not.toContain('secret-token');

    const check = block('install.sh', 'if git -C "$APP_DIR" remote get-url origin', 'success "Source ready');
    execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', 'https://tok@example.com/o/r.git']);
    const warned = bash(`APP_DIR=${JSON.stringify(repo)}\n${check}`);
    expect(warned.stdout).toContain('holds an access token in .git/config');
    expect(warned.stdout).not.toContain('tok@');
    execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', 'git@example.com:o/r.git']);
    expect(bash(`APP_DIR=${JSON.stringify(repo)}\n${check}`).stdout).toBe('');
  });

  it('gives an existing database role the new password through stdin', () => {
    const sql = block('install.sh', '$SUDO -u postgres psql -v ON_ERROR_STOP=1 <<SQL', 'if ! $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database');
    expect(sql).toContain("CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';");
    expect(sql).toMatch(/ELSE\n\s+ALTER ROLE \$\{DB_USER\} LOGIN PASSWORD '\$\{DB_PASS\}';/);
    expect(install).toContain('already exists; its password is replaced');
    expect(install).not.toMatch(/psql[^\n]*-c[^\n]*PASSWORD/);
  });

  // v10.2.26 (#344 review L1): a reinstall without .env over a database with tables would give it new keys
  it('refuses to reuse a database that holds tables unless INSTALL_REUSE_DB=1', () => {
    const guard = block('install.sh', '# v10.2.26 (#344 review L1)', '# v10.2.24 (OBS-R1-16): a role left by an earlier install');
    const stub = (tables: string) => `die() { echo "ERROR: $*"; exit 1; }
SUDO=fake
fake() { shift 2; case "$*" in *pg_database*) echo 1 ;; *information_schema*) echo ${tables} ;; esac; }
DB_NAME=papital_erp
APP_DIR=/opt/papital-erp
`;
    const refused = bash(`${stub('130')}${guard}echo continued`);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('already holds 130 tables');
    expect(refused.stdout).not.toContain('continued');
    const reused = bash(`${stub('130')}${guard}echo continued`, { INSTALL_REUSE_DB: '1' });
    expect(reused.stdout).toContain('reusing database papital_erp (130 tables)');
    expect(reused.stdout).toContain('continued');
    const empty = bash(`${stub('0')}${guard}echo continued`);
    expect(empty.stdout.trim()).toBe('continued');
  });

  it('keeps the role password out of the server log (L2)', () => {
    const sql = block('install.sh', '$SUDO -u postgres psql -v ON_ERROR_STOP=1 <<SQL', 'if ! $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database');
    expect(sql.indexOf("SET log_statement = 'none';")).toBeGreaterThan(0);
    expect(sql.indexOf("SET log_statement = 'none';")).toBeLessThan(sql.indexOf('PASSWORD'));
    expect(sql).toContain('SET log_min_duration_statement = -1;');
  });

  it('ends on the readiness probe, with time for the first migrations', () => {
    const probe = block('install.sh', '# ---------- 7) Health probe', 'echo ""');
    expect(probe).toContain('curl -fsS "http://localhost:${APP_PORT}/health/ready"');
    expect(probe).toContain('for _ in $(seq 1 150); do');
    expect(probe).toMatch(/if \[ "\$HEALTH_OK" -ne 1 \]; then[\s\S]*exit 2/);
    expect(install).toContain('TD-1354');
  });
});

describe('obs_r1_16_setup_domain: setup-domain.sh', () => {
  /** Runs the default-site block with /etc/nginx moved into a scratch folder and dpkg-query stubbed */
  const runDefaultSite = (opts: { stock: boolean; symlink?: boolean }) => {
    const d = scratch();
    const nginx = path.join(d, 'nginx');
    mkdirSync(path.join(nginx, 'sites-available'), { recursive: true });
    mkdirSync(path.join(nginx, 'sites-enabled'), { recursive: true });
    const site = path.join(nginx, 'sites-available', 'default');
    writeFileSync(site, 'server { listen 80 default_server; root /var/www/html; }\n');
    const md5 = execFileSync('md5sum', [site], { encoding: 'utf8' }).split(' ')[0];
    if (!opts.stock) writeFileSync(site, 'server { listen 80 default_server; root /srv/other-site; }\n');
    if (opts.symlink === false) writeFileSync(path.join(nginx, 'sites-enabled', 'default'), 'copy');
    else symlinkSync(site, path.join(nginx, 'sites-enabled', 'default'));
    const bin = path.join(d, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'dpkg-query'), `#!/usr/bin/env bash\nprintf ' %s %s\\n' "${site}" "${md5}"\n`);
    chmodSync(path.join(bin, 'dpkg-query'), 0o755);
    const code = block('setup-domain.sh', 'DEFAULT_SITE="/etc/nginx/sites-available/default"', 'nginx -t ||').split('/etc/nginx').join(nginx);
    const r = bash(`DOMAIN=erp.example.com\n${code}`, { PATH: `${bin}:${process.env.PATH}` });
    expect(r.status, r.stderr).toBe(0);
    return { r, enabled: existsSync(path.join(nginx, 'sites-enabled', 'default')) };
  };

  it('disables the default site only while it is the unchanged nginx page', () => {
    expect(runDefaultSite({ stock: true }).enabled).toBe(false);
    const edited = runDefaultSite({ stock: false });
    expect(edited.enabled).toBe(true);
    expect(edited.r.stdout).toContain('was changed on this server and is kept');
    expect(runDefaultSite({ stock: true, symlink: false }).enabled).toBe(true);
    expect(read('setup-domain.sh')).not.toMatch(/^rm -f \/etc\/nginx\/sites-enabled\/default$/m);
  });

  it('binds the app to 127.0.0.1 once, keeping a value already in .env', () => {
    const d = scratch();
    const newline = block('setup-domain.sh', '# v10.2.26 (#344 review L3)', 'if grep -q \'^ALLOWED_ORIGINS=\'');
    const append = newline + block('setup-domain.sh', "if ! grep -q '^ERP_LISTEN_HOST=' \"$APP_DIR/.env\"", 'chmod 600 "$APP_DIR/.env"');
    writeFileSync(path.join(d, '.env'), 'PORT=3000\n');
    expect(bash(`APP_DIR=${JSON.stringify(d)}\nAPP_PORT=3000\nDOMAIN=erp.example.com\n${append}`).status).toBe(0);
    expect(bash(`APP_DIR=${JSON.stringify(d)}\nAPP_PORT=3000\nDOMAIN=erp.example.com\n${append}`).status).toBe(0);
    expect(readFileSync(path.join(d, '.env'), 'utf8')).toBe('PORT=3000\nERP_LISTEN_HOST=127.0.0.1\n');
    // a .env without its final newline keeps its last line whole (L3)
    writeFileSync(path.join(d, '.env'), 'PORT=3000');
    bash(`APP_DIR=${JSON.stringify(d)}\nAPP_PORT=3000\nDOMAIN=erp.example.com\n${append}`);
    expect(readFileSync(path.join(d, '.env'), 'utf8')).toBe('PORT=3000\nERP_LISTEN_HOST=127.0.0.1\n');
    writeFileSync(path.join(d, '.env'), 'ERP_LISTEN_HOST=0.0.0.0\n');
    bash(`APP_DIR=${JSON.stringify(d)}\nAPP_PORT=3000\nDOMAIN=erp.example.com\n${append}`);
    expect(readFileSync(path.join(d, '.env'), 'utf8')).toBe('ERP_LISTEN_HOST=0.0.0.0\n');
  });
});

describe('obs_r1_16_listen_host: the server and CI', () => {
  it('server.ts listens on ERP_LISTEN_HOST, every address when empty; .env.example lists it', () => {
    const server = read('server.ts');
    expect(server).toContain("const LISTEN_HOST = process.env.ERP_LISTEN_HOST?.trim() || '0.0.0.0';");
    expect(server).toContain('app.listen(PORT, LISTEN_HOST, listenCallback(PORT, logger))');
    expect(read('.env.example')).toMatch(/^ERP_LISTEN_HOST=$/m);
  });

  it('CI installs on Ubuntu 26.04 and the image push waits for it (OT-A-07)', () => {
    const ci = read('.github/workflows/ci.yml');
    const job = ci.slice(ci.indexOf('  linux-install:'), ci.indexOf('  docker-publish:'));
    expect(job).toContain('runs-on: ubuntu-26.04');
    expect(job).toContain('run: bash install.sh');
    expect(job).toContain("echo 'ERP_LISTEN_HOST=127.0.0.1' >> .env");
    expect(ci).toMatch(/needs: \[[^\]]*linux-install\]/);
  });
});
