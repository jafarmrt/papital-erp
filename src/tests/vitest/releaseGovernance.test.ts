// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { findDebtRegistryViolations, findFrozenArchiveViolations, findMissingNpmScripts, findReleaseLayoutViolations, npmScriptDocs } from '../../../scripts/governance/releaseGuards';
import { findChangelogSeriesViolations } from '../../../src/data/changelogs/seriesGuard';
import { ACTIVE_CHANGELOG } from '../../../src/data/changelogs/index';
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
      .toEqual(['TD-2 is both active (TECH_DEBT.md) and closed (docs/rules/DEBT_LESSONS.md or the frozen archive)']);
    expect(findDebtRegistryViolations(debt('| TD-1 | a |', '| TD-1 | a |'), '| TD-2 | b |\n| TD-2 | c |\n'))
      .toEqual(['TD-1 appears 2 times in TECH_DEBT.md', 'TD-2 appears 2 times among the closed rows']);
  });

  it('passes on the repository', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    expect(findDebtRegistryViolations(read('TECH_DEBT.md'), read('docs/rules/DEBT_LESSONS.md') + read('docs/rules/archive/TECH_DEBT_ARCHIVE_V10.md'))).toEqual([]);
    expect(findFrozenArchiveViolations(read('docs/rules/archive/TECH_DEBT_ARCHIVE_V10.md'))).toEqual([]);
  });

  it('refuses a row or a series 11 section added to the frozen archive (v11.0.3)', () => {
    const frozen = fs.readFileSync(path.join(process.cwd(), 'docs/rules/archive/TECH_DEBT_ARCHIVE_V10.md'), 'utf8');
    expect(findFrozenArchiveViolations(`${frozen}| TD-1400 | x | resolved |\n`)[0]).toMatch(/1124 rows instead of 1123/);
    expect(findFrozenArchiveViolations(`## 🧭 نسخه ۱۱ — x\n${frozen}`)).toHaveLength(1);
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

  it('reads the active roadmap and leaves the archived roadmaps of closed series out', () => {
    const docs = npmScriptDocs(process.cwd());
    expect(docs.has('docs/roadmap/V11_MASTER_ROADMAP.md')).toBe(true);
    expect([...docs.keys()].filter(rel => rel.startsWith('docs/roadmap/archive/'))).toEqual([]);
  });
});

/** v11 (1.3, product-owner decision): a version per server update; changes wait under «### Unreleased». */
describe('release layout gate (v11, 1.3)', () => {
  const md = (body: string) => `## Version 11.x Series (Active — see \`src/data/changelogs/11.ts\`)\n\n${body}\n---\n\n## Version 10.x Series\n\n### Unreleased\n`;

  it('accepts Unreleased at the top and versions that step by one patch or one minor', () => {
    expect(findReleaseLayoutViolations(md('### Unreleased\n- x.\n\n### v11.1.0 — a\n- a.\n'), 11, ['v11.1.0', 'v11.0.9'])).toEqual([]);
    expect(findReleaseLayoutViolations(md('### Unreleased\n\n### v11.0.2 — a\n'), 11, ['v11.0.2', 'v11.0.1'])).toEqual([]);
  });

  it('refuses a missing or misplaced Unreleased and a skipped version', () => {
    expect(findReleaseLayoutViolations(md('### v11.0.2 — a\n- a.\n'), 11, ['v11.0.2'])[0]).toMatch(/Unreleased/);
    expect(findReleaseLayoutViolations(md('### v11.0.2 — a\n\n### Unreleased\n'), 11, ['v11.0.2'])[0]).toMatch(/Unreleased/);
    expect(findReleaseLayoutViolations(md('### Unreleased\n\n### v11.0.4 — a\n'), 11, ['v11.0.4', 'v11.0.2'])[0]).toMatch(/does not follow/);
    expect(findReleaseLayoutViolations(md('### Unreleased\nnot a list line\n\n### v11.0.2 — a\n'), 11, ['v11.0.2'])[0]).toMatch(/must start with "- "/);
    expect(findReleaseLayoutViolations(md('### Unreleased\n\n### Unreleased\n- x.\n'), 11, [])[0]).toMatch(/more than once/);
  });

  it('holds for the repository', () => {
    const changelog = fs.readFileSync(path.resolve(__dirname, '../../../CHANGELOG.md'), 'utf8');
    expect(findReleaseLayoutViolations(changelog, ACTIVE_CHANGELOG.series, ACTIVE_CHANGELOG.updates.map(u => u.version))).toEqual([]);
  });
});
