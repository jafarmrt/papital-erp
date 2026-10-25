// @vitest-environment node
/**
 * v10.2.13 (O-06, draft PR #207 brought up to date): the operations documents named retired tools and steps: three version locations and the series 3
 * changelog, a push to master, pm2, `GEMINI_API_KEY` (read by no code), `git revert` instead of the reset `update.sh`
 * prints, a `.env.production.example` that does not exist, the backup-only cron file `install-ops-cron.sh` replaced and
 * the in-app changelog page removed in v10.1.15. The review added what an operator of a running server must never be
 * led to: ensure-env-secrets.sh for any key but ERP_SECRETS_KEY (it would add ERP_WEBHOOK_SECRET_TOKEN or METRICS_TOKEN),
 * a secret in a URL, on a command line or printed (a token in the clone address or setup link, `cat .env`, a bot token),
 * a sourced .env, and the unit's retired MemoryLimit.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OPS_DOCS = ['README.md', 'docs/GO_LIVE_CHECKLIST.md', 'deploy/DEPLOY_LINUX.md', 'docs/OFFSITE_BACKUP.md'];
const RETIRED = [
  /changelogs\/3\.ts/, /\(3 locations\)/, /git push origin master/, /\bpm2\b/, /GEMINI_API_KEY/,
  /git revert/, /\.env\.production\.example/, /cron\.d\/papital-erp-backup`?:? *`?[0-9*]/,
  // without key names it adds ERP_WEBHOOK_SECRET_TOKEN and METRICS_TOKEN, which a running server must not get by accident
  /ensure-env-secrets\.sh\s+\S*\.env"?(?!\s+ERP_SECRETS_KEY\b)/, /setup\?token=/, /cat \S*\.env\b/, /Personal Access Token/,
  /bot<TOKEN>/, /<TOKEN>@github/, /ADMIN_TOKEN=<[^>]+>/, /\. \.\/\.env/, /MemoryLimit/,
  /معرفی و به‌روزرسانی‌ها/,
];

describe('ops_docs_current_o_06', () => {
  it.each(OPS_DOCS)('%s names no retired tool or step', file => {
    const text = readFileSync(file, 'utf8');
    for (const pattern of RETIRED) expect(text, String(pattern)).not.toMatch(pattern);
  });

  it('every example environment file the documents copy exists, and it holds no retired key', () => {
    for (const file of OPS_DOCS) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/cp (\.env[\w.-]*) \.env/g)) expect(existsSync(name), name).toBe(true);
    }
    expect(readFileSync('.env.example', 'utf8')).not.toMatch(/GEMINI_API_KEY/);
  });

  it('the documents name the four synced version locations and the active changelog', () => {
    const checklist = readFileSync('docs/GO_LIVE_CHECKLIST.md', 'utf8');
    expect(checklist).toContain('(4 locations)');
    expect(checklist).toContain('npm run check:version');
    expect(readFileSync('README.md', 'utf8')).toContain('src/data/changelogs/11.ts');
  });
});
