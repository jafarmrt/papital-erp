// @vitest-environment node
/**
 * v10.0.210 (O-06): the operations documents named retired tools and steps: three version locations and the series 3
 * changelog, a push to master, pm2, `GEMINI_API_KEY` (read by no code), `git revert` instead of the reset `update.sh`
 * prints, a `.env.production.example` that does not exist and the backup-only cron file `install-ops-cron.sh` replaced.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OPS_DOCS = ['README.md', 'docs/GO_LIVE_CHECKLIST.md'];
const RETIRED = [
  /changelogs\/3\.ts/, /\(3 locations\)/, /git push origin master/, /\bpm2\b/, /GEMINI_API_KEY/,
  /git revert/, /\.env\.production\.example/, /# \/etc\/cron\.d\/papital-erp-backup/,
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
    expect(readFileSync('README.md', 'utf8')).toContain('src/data/changelogs/10.ts');
  });
});
