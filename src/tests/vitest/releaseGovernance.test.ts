// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { findDebtRegistryViolations, findMissingNpmScripts, npmScriptDocs } from '../../../scripts/governance/releaseGuards';
import { findChangelogSeriesViolations } from '../../../src/data/changelogs/seriesGuard';
import type { AIUpdateLog } from '../../../src/data/changelogs/types';

/**
 * TD-981 / OT-A-03: the gates `npm run check:version` (and so `npm run release:renumber`) runs on every merge:
 * a debt row is never both active and archived nor listed twice, the active changelog has no entry twice, and every
 * `npm run <script>` the governance documents name exists in package.json.
 */

const debt = (...rows: string[]) => `| ID | x |\n|----|---|\n${rows.join('\n')}\n\n- **فعال:** ۱ ردیف\n`;

describe('debt registry gate (TD-981)', () => {
  it('refuses an id that is both active and archived, or listed twice', () => {
    expect(findDebtRegistryViolations(debt('| TD-1 | a | open |'), '| TD-2 | b | resolved |\n')).toEqual([]);
    expect(findDebtRegistryViolations(debt('| TD-1 | a | open |', '| TD-2 | b | open |'), '| TD-2 | b | resolved |\n'))
      .toEqual(['TD-2 is both active (TECH_DEBT.md) and archived (TECH_DEBT_ARCHIVE.md)']);
    expect(findDebtRegistryViolations(debt('| TD-1 | a |', '| TD-1 | a |'), '| TD-2 | b |\n| TD-2 | c |\n'))
      .toEqual(['TD-1 appears 2 times in TECH_DEBT.md', 'TD-2 appears 2 times in TECH_DEBT_ARCHIVE.md']);
  });

  it('passes on the repository', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    expect(findDebtRegistryViolations(read('TECH_DEBT.md'), read('TECH_DEBT_ARCHIVE.md'))).toEqual([]);
  });
});

describe('active changelog gate (TD-981)', () => {
  const update = (version: string, title: string) => ({ version, date: 'd', title, summary: 's', changes: [], fixes: [] } as unknown as AIUpdateLog);
  it('refuses the same entry twice under two versions', () => {
    const active = { series: 3, file: '3.ts', updates: [update('v3.0.2', 'B'), update('v3.0.1', 'A'), update('v3.0.0', 'A')] };
    expect(findChangelogSeriesViolations('3.0.2', active, [])).toEqual(['entry "A" appears twice in 3.ts (v3.0.1, v3.0.0)']);
  });
});


describe('npm script guard (OT-A-03)', () => {
  it('lists every documented npm script missing from package.json', () => {
    const docs = new Map([
      ['AGENTS.md', 'run `npm run ratchet:permissions` and `npm run check:version -- --x`; never `npm run db:push`'],
      ['ci.yml', 'run: npm run lint'],
    ]);
    expect(findMissingNpmScripts(docs, { 'check:version': 'x', lint: 'y' })).toEqual(['AGENTS.md names `npm run ratchet:permissions`, which package.json does not define']);
  });

  it('passes on the repository', () => {
    const scripts = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    const docs = npmScriptDocs(process.cwd());
    expect(docs.has('AGENTS.md')).toBe(true);
    expect(docs.has('.github/workflows/ci.yml')).toBe(true);
    expect(findMissingNpmScripts(docs, scripts)).toEqual([]);
  });
});
