// @vitest-environment node
/**
 * v11 phase 8.6: the storefront's server files (deploy/storefront/) keep the rules the site depends on. The nginx site
 * passes Host on unchanged (React Router accepts forms only from the host of STOREFRONT_SITE_URL), writes X-Real-IP and
 * X-Forwarded-For itself (STOREFRONT_TRUST_PROXY=1 reads them for the SMS-code and sign-in limits), caps bodies at 5 MB
 * and never lets www. reach the app; the unit keeps the settings out of the service's reach; the settings template
 * holds no secret. The CI job storefront-install runs the same scripts on a fresh Ubuntu.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const DIR = 'deploy/storefront';
const tmpRoots: string[] = [];

function nginxSite(env: Record<string, string>): { site: string; snippet: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-nginx-'));
  tmpRoots.push(root);
  execFileSync('bash', [path.join(DIR, 'storefront-nginx.sh')], {
    env: { PATH: process.env.PATH ?? '', DRY_RUN: '1', NGINX_DIR: root, ENV_FILE: path.join(root, 'none.env'), FORCE_IPV6: '0', ...env },
    stdio: 'pipe',
  });
  return {
    site: fs.readFileSync(path.join(root, 'sites-available/papital-storefront.conf'), 'utf8'),
    snippet: fs.readFileSync(path.join(root, 'snippets/papital-storefront-proxy.conf'), 'utf8'),
  };
}

/** The server blocks of a site file, each as its text */
function serverBlocks(site: string): string[] {
  return site.split(/^server \{$/m).slice(1).map(b => b.slice(0, b.indexOf('\n}\n') + 1));
}

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('storefront_deploy_nginx_v11_8_6', () => {
  const { site, snippet } = nginxSite({ DOMAIN: 'papitalgallery.com', TLS: 'existing', CERT_FILE: '/x/fullchain.pem', KEY_FILE: '/x/privkey.pem' });

  it('passes Host unchanged and writes the visitor address itself, never the browser’s', () => {
    expect(snippet).toContain('proxy_set_header Host $host;');
    expect(snippet).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(snippet).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(snippet).not.toContain('$proxy_add_x_forwarded_for');
    expect(snippet).not.toMatch(/proxy_pass_request_headers\s+off/);
  });

  it('caps bodies at 5 MB (receipt photos are at most 3 MB)', () => {
    expect(snippet).toMatch(/^client_max_body_size 5m;$/m);
  });

  it('keeps product photos and build files, never pages', () => {
    const cached = [...snippet.matchAll(/location (\S+) \{[^}]*proxy_cache papital_storefront;/g)].map(m => m[1]);
    expect(cached.sort()).toEqual(['/assets/', '/media/']);
    const pages = /location \/ \{([^}]*)\}/.exec(snippet)?.[1] ?? '';
    expect(pages).not.toContain('proxy_cache');
    expect(pages).toContain('limit_req zone=papital_storefront_pages');
  });

  it('serves the app only on the domain itself over https; www. and http only redirect to it', () => {
    const blocks = serverBlocks(site);
    const app = blocks.filter(b => b.includes('include '));
    expect(app).toHaveLength(1);
    expect(app[0]).toMatch(/server_name papitalgallery\.com;/);
    expect(app[0]).toMatch(/listen 443 ssl/);
    for (const b of blocks.filter(x => !x.includes('include '))) {
      expect(b).not.toContain('proxy_pass');
      expect(b).toContain('return 301 https://papitalgallery.com$request_uri;');
    }
    expect(blocks.some(b => /server_name www\.papitalgallery\.com;/.test(b))).toBe(true);
  });

  it('sends a short HSTS without sub-domains (the ERP has its own) so a DNS rollback stays open', () => {
    expect(site).toContain('add_header Strict-Transport-Security "max-age=300" always;');
    expect(site).not.toContain('includeSubDomains');
  });

  it('a sub-domain test address gets no www. block, and http-only mode still proxies only the domain', () => {
    const test = nginxSite({ DOMAIN: 'new.papitalgallery.com', TLS: 'none' });
    expect(test.site).not.toContain('www.new.papitalgallery.com');
    const blocks = serverBlocks(test.site);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('server_name new.papitalgallery.com;');
  });

  it('refuses a domain that is not a plain host name', () => {
    expect(() => nginxSite({ DOMAIN: 'papitalgallery.com;include /etc/passwd', TLS: 'none' })).toThrow();
    expect(() => nginxSite({ DOMAIN: 'papitalgallery.com', TLS: 'none', RATE: '10r/s;' })).toThrow();
  });
});

describe('storefront_deploy_service_v11_8_6', () => {
  const script = fs.readFileSync(path.join(DIR, 'storefront.sh'), 'utf8');
  const unit = script.slice(script.indexOf('[Unit]'), script.indexOf('\nUNIT\n'));

  it('the unit runs as a throwaway user, reads its settings through systemd and cannot write anywhere', () => {
    expect(unit).toContain('DynamicUser=yes');
    expect(unit).toContain('EnvironmentFile=${ENV_FILE}');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toMatch(/MemoryMax=\d+[MG]/);
    expect(unit).not.toContain('--env-file');
    // V8 compiles code at run time
    expect(unit).not.toContain('MemoryDenyWriteExecute');
  });

  it('the settings file is root only and is never overwritten', () => {
    expect(script).toContain('chmod 600 "$ENV_FILE"');
    expect(script).toMatch(/if \[ ! -f "\$ENV_FILE" \]; then/);
  });

  it('never touches the ERP service, its .env or the monitor, backup and alert scripts', () => {
    for (const s of [script, fs.readFileSync(path.join(DIR, 'storefront-nginx.sh'), 'utf8')]) {
      expect(s).not.toMatch(/systemctl \w+ papital-erp\b/);
      expect(s).not.toMatch(/scripts\/(monitor|backup|alert)/);
      expect(s).not.toMatch(/papital-erp\/\.env/);
    }
  });
});

describe('storefront_deploy_env_template_v11_8_6', () => {
  const env = fs.readFileSync(path.join(DIR, 'storefront.env.example'), 'utf8');
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1];

  it('holds no secret and starts safe: empty key, loopback, not indexed', () => {
    expect(value('STOREFRONT_API_KEY')).toBe('');
    expect(value('STOREFRONT_HOST')).toBe('127.0.0.1');
    expect(value('STOREFRONT_TRUST_PROXY')).toBe('1');
    expect(value('STOREFRONT_NOINDEX')).toBe('1');
    expect(value('STOREFRONT_PWA')).toBe('0');
    expect(value('STOREFRONT_SITE_URL')).toMatch(/^https:\/\/[^/]+$/);
  });

  it('names every variable the app reads', () => {
    const appVars = new Set<string>();
    for (const file of ['storefront/server.mjs', 'storefront/app/lib/site.server.ts']) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/process\.env\.(STOREFRONT_[A-Z_]+)/g)) appVars.add(m[1]);
    }
    expect(appVars.size).toBeGreaterThan(5);
    for (const v of appVars) expect(value(v), v).toBeDefined();
  });
});
