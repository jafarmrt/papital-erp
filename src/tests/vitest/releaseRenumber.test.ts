// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addedLineIndexes, planRenumber, sortChangelogMd, type RenumberInput } from '../../../scripts/renumber/plan';
import { resolveHunks, resolveReleaseConflict } from '../../../scripts/renumber/conflicts';

/**
 * v9.0.107 (TD-473): `npm run release:renumber` moves a branch's versions, migrations and audit sections after
 * those of the merged base (v9/PHASE4_LANES.md §7.7–§7.8) and touches only the text the branch added.
 */

const ACTIVE = 'src/data/changelogs/9.ts';

const entry = (v: string, title: string) => `  {\n    version: '${v}',\n    title: '${title}',\n    fixes: []\n  }`;
const changelog = (...entries: string[]) =>
  `import { AIUpdateLog } from './types';\n\nexport const v9Updates: AIUpdateLog[] = [\n${entries.join(',\n')}\n];\n`;
const md = (...blocks: string[]) =>
  `# Changelog\n\n## Version 9.x Series (Active — see \`src/data/changelogs/9.ts\`)\n\n${blocks.join('\n\n')}\n\n---\n\n## Version 8.x Series (Archived)\n\n### v9.0.0 — pre-reset\n- old\n`;
const journal = (...tags: Array<[string, number]>) => `${JSON.stringify({
  version: '7', dialect: 'postgresql',
  entries: tags.map(([tag, when]) => ({ idx: Number(tag.slice(0, 4)), version: '7', when, tag, breakpoints: true })),
}, null, 2)}\n`;
const debt = (rows: string[], active: string, archived: string) =>
  `| ID | x |\n|----|---|\n${rows.join('\n')}\n\n- **فعال:** ${active} ردیف\n- **آرشیو شده (resolved):** ${archived} ردیف — تاریخچه\n`;
const pkg = (v: string) => `{\n  "name": "x",\n  "version": "${v}",\n  "type": "module"\n}\n`;
const lock = (v: string) => `{\n  "name": "x",\n  "version": "${v}",\n  "packages": {\n    "": {\n      "version": "${v}"\n    },\n    "node_modules/a": {\n      "version": "9.0.1"\n    }\n  }\n}\n`;
const k8s = (v: string) => `        image: registry.example.com/erp:v${v}\n        env:\n        - name: APP_VERSION\n          value: "${v}"\n`;
const readme = (v: string) => `> سری فعال (نسخه مستقر: \`v${v}\`)\n`;

/** master released one version and migration 0060; the branch, started from the same base, released two versions and its own 0060 */
function mergedTree(): { base: Map<string, string>; current: Map<string, string> } {
  const masterEntry = entry('v9.0.52', 'master');
  const base = new Map<string, string>([
    [ACTIVE, changelog(masterEntry, entry('v9.0.51', 'old'))],
    ['CHANGELOG.md', md('### v9.0.52 — Master\n- **M:** master line.', '### v9.0.51 — Old\n- **O:** old.')],
    ['drizzle/meta/_journal.json', journal(['0059_old', 1000], ['0060_master', 2000])],
    ['drizzle/0060_master.sql', 'SELECT 1;\n'],
    ['TECH_DEBT.md', debt(['| TD-500 | a |'], '۱', '۲')],
    ['TECH_DEBT_ARCHIVE.md', '| TD-461 | x | resolved (v9.0.51) |\n| TD-480 | y | resolved (v9.0.52) |\n'],
    ['AGENTS.md', '- Rule A (v9.0.52, TD-480, migration 0060).\n- Rule B (v9.0.37).\n'],
    ['docs/audit/STABILITY_AUDIT_V9.md', '## ۳. بسته ۱۴\n\n### ۳.۱. خلاصه\n\n## ۴. بسته ۶\n\n### ۴.۱. خلاصه\n'],
    ['package.json', pkg('9.0.52')],
    ['package-lock.json', lock('9.0.52')],
    ['deploy/k8s/erp-deployment.yaml', k8s('9.0.52')],
    ['README.md', readme('9.0.52')],
  ]);
  const current = new Map<string, string>([
    // conflicts resolved by keeping both sides, branch side first
    [ACTIVE, changelog(entry('v9.0.53', 'branch two'), entry('v9.0.52', 'branch one'), masterEntry, entry('v9.0.51', 'old'))],
    ['CHANGELOG.md', md('### v9.0.53 — Two\n- **T:** see v9.0.52.', '### v9.0.52 — One\n- **B:** migration 0060 (TD-473).', '### v9.0.52 — Master\n- **M:** master line.', '### v9.0.51 — Old\n- **O:** old.')],
    ['drizzle/meta/_journal.json', journal(['0059_old', 1000], ['0060_branch', 1500], ['0060_master', 2000])],
    ['drizzle/0060_master.sql', 'SELECT 1;\n'],
    ['drizzle/0060_branch.sql', '-- 0060_branch (v9.0.52)\nSELECT 2;\n'],
    ['TECH_DEBT.md', debt(['| TD-500 | a |', '| TD-581 | b |'], '۱', '۲')],
    ['TECH_DEBT_ARCHIVE.md', '| TD-473 | z | resolved (v9.0.53) |\n| TD-461 | x | resolved (v9.0.51) |\n| TD-480 | y | resolved (v9.0.52) |\n'],
    ['AGENTS.md', '- Rule A (v9.0.52, TD-480, migration 0060).\n- Rule B (v9.0.37; v9.0.52, TD-473, migration 0060).\n'],
    ['docs/audit/STABILITY_AUDIT_V9.md', '## ۳. بسته ۱۴\n\n### ۳.۱. خلاصه\n\n## ۴. بسته ۶\n\n### ۴.۱. خلاصه\n\n## ۴. بسته ۱\n\n### ۴.۱. خلاصه\n\n### ۴.۲. یافته‌ها\n'],
    ['V9_MASTER_ROADMAP.md', 'phase 4: package 1 in `docs/audit/STABILITY_AUDIT_V9.md` §۴ (v9.0.53)\n'],
    ['package.json', pkg('9.0.53')],
    ['package-lock.json', lock('9.0.53')],
    ['deploy/k8s/erp-deployment.yaml', k8s('9.0.53')],
    ['README.md', readme('9.0.53')],
  ]);
  return { base, current };
}

function input(t: { base: Map<string, string>; current: Map<string, string> }): RenumberInput {
  return {
    base: rel => t.base.get(rel) ?? null,
    current: rel => t.current.get(rel) ?? null,
    changed: [...t.current.keys()].filter(rel => t.base.get(rel) !== t.current.get(rel)),
    activeFile: ACTIVE,
  };
}

describe('scripts/release-renumber.ts (TD-473)', () => {
  it('moves the branch versions after the base and sorts the active changelog newest first', () => {
    const plan = planRenumber(input(mergedTree()));
    expect(plan.versions).toEqual([['v9.0.52', 'v9.0.53'], ['v9.0.53', 'v9.0.54']]);
    expect(plan.top).toBe('v9.0.54');
    const active = plan.writes.get(ACTIVE)!;
    const order = [...active.matchAll(/version: '(v[\d.]+)',\n {4}title: '([^']+)'/g)].map(m => `${m[1]} ${m[2]}`);
    expect(order).toEqual(['v9.0.54 branch two', 'v9.0.53 branch one', 'v9.0.52 master', 'v9.0.51 old']);
    expect(active).toMatch(/fixes: \[\]\n {2}\},\n {2}\{/);
    expect(active.endsWith("fixes: []\n  }\n];\n")).toBe(true);
  });

  it('renumbers only lines the branch added and sets the four version locations', () => {
    const plan = planRenumber(input(mergedTree()));
    const changelogMd = plan.writes.get('CHANGELOG.md')!;
    const heads = [...changelogMd.matchAll(/^### (v[\d.]+ — \w+)/gm)].map(m => m[1]);
    expect(heads).toEqual(['v9.0.54 — Two', 'v9.0.53 — One', 'v9.0.52 — Master', 'v9.0.51 — Old', 'v9.0.0 — pre']);
    expect(changelogMd).toContain('- **T:** see v9.0.53.');
    expect(changelogMd).toContain('- **B:** migration 0061 (TD-473).');
    expect(plan.writes.get('TECH_DEBT_ARCHIVE.md')).toBe('| TD-473 | z | resolved (v9.0.54) |\n| TD-461 | x | resolved (v9.0.51) |\n| TD-480 | y | resolved (v9.0.52) |\n');
    expect(plan.writes.get('AGENTS.md')).toBe('- Rule A (v9.0.52, TD-480, migration 0060).\n- Rule B (v9.0.37; v9.0.53, TD-473, migration 0061).\n');
    expect(plan.writes.get('package.json')).toContain('"version": "9.0.54"');
    expect(plan.writes.get('package-lock.json')!.split('"version": "9.0.54"').length - 1).toBe(2);
    expect(plan.writes.get('package-lock.json')).toContain('"version": "9.0.1"');
    expect(plan.writes.get('deploy/k8s/erp-deployment.yaml')).toBe(k8s('9.0.54'));
    expect(plan.writes.get('README.md')).toBe(readme('9.0.54'));
  });

  it('moves the branch migration after the base migrations with a later `when`', () => {
    const plan = planRenumber(input(mergedTree()));
    expect(plan.migrations).toEqual([['0060_branch', '0061_branch']]);
    expect(plan.renames).toEqual([['drizzle/0060_branch.sql', 'drizzle/0061_branch.sql']]);
    expect(plan.writes.get('drizzle/0061_branch.sql')).toBe('-- 0061_branch (v9.0.53)\nSELECT 2;\n');
    const entries = (JSON.parse(plan.writes.get('drizzle/meta/_journal.json')!) as { entries: Array<{ idx: number; tag: string; when: number }> }).entries;
    expect(entries.map(e => [e.idx, e.tag])).toEqual([[59, '0059_old'], [60, '0060_master'], [61, '0061_branch']]);
    expect(entries[2].when).toBeGreaterThan(entries[1].when);
  });

  it('gives a branch audit section the next free number with its subsections and references', () => {
    const plan = planRenumber(input(mergedTree()));
    expect(plan.sections).toEqual([[4, 5]]);
    expect(plan.writes.get('docs/audit/STABILITY_AUDIT_V9.md')).toBe(
      '## ۳. بسته ۱۴\n\n### ۳.۱. خلاصه\n\n## ۴. بسته ۶\n\n### ۴.۱. خلاصه\n\n## ۵. بسته ۱\n\n### ۵.۱. خلاصه\n\n### ۵.۲. یافته‌ها\n');
    expect(plan.writes.get('V9_MASTER_ROADMAP.md')).toBe('phase 4: package 1 in `docs/audit/STABILITY_AUDIT_V9.md` §۵ (v9.0.54)\n');
  });

  it('recounts the TECH_DEBT.md counters from both tables', () => {
    const plan = planRenumber(input(mergedTree()));
    expect(plan.writes.get('TECH_DEBT.md')).toContain('- **فعال:** ۲ ردیف');
    expect(plan.writes.get('TECH_DEBT.md')).toContain('- **آرشیو شده (resolved):** ۳ ردیف');
  });

  it('changes nothing when the branch already follows the base', () => {
    const t = mergedTree();
    const once = planRenumber(input(t));
    for (const [from, to] of once.renames) { t.current.set(to, t.current.get(from)!); t.current.delete(from); }
    for (const [rel, content] of once.writes) t.current.set(rel, content);
    const twice = planRenumber(input(t));
    expect(twice.writes.size).toBe(0);
    expect(twice.versions).toEqual([]);
    expect(twice.migrations).toEqual([]);
  });

  it('refuses a tree where the base is not merged or a conflict is left', () => {
    const t = mergedTree();
    t.current.set(ACTIVE, changelog(entry('v9.0.52', 'branch one'), entry('v9.0.51', 'old')));
    expect(() => planRenumber(input(t))).toThrow(/merge the base branch first/);
    const u = mergedTree();
    u.current.set('AGENTS.md', '<<<<<<< HEAD\n- a\n=======\n- b\n>>>>>>> origin/master\n');
    expect(() => planRenumber(input(u))).toThrow(/merge conflict/);
    const w = mergedTree();
    w.current.set('drizzle/meta/_journal.json', journal(['0059_old', 1000], ['0060_branch', 1500]));
    expect(() => planRenumber(input(w))).toThrow(/0060_master/);
  });

  it('finds added lines with a line diff', () => {
    expect([...addedLineIndexes(['a', 'b', 'c'], ['a', 'x', 'b', 'c', 'y'])]).toEqual([1, 4]);
    expect([...addedLineIndexes(['a', 'b'], ['b', 'a'])]).toHaveLength(1);
    expect(sortChangelogMd('no section', 9)).toBe('no section');
  });

  it('keeps the blank lines of the changelog section and moves only misplaced entries', () => {
    const head = '# Changelog\n\n## Version 9.x Series (Active)\n\n';
    const tail = '\n---\n\n## Version 8.x Series (Archived)\n';
    const sorted = `${head}### v9.0.3 — C\n- c\n\n### v9.0.2 — B\n- b\n### v9.0.1 — A\n- a\n${tail}`;
    expect(sortChangelogMd(sorted, 9)).toBe(sorted);
    const unsorted = `${head}### v9.0.2 — B\n- b\n\n### v9.0.3 — C\n- c\n### v9.0.1 — A\n- a\n${tail}`;
    expect(sortChangelogMd(unsorted, 9)).toBe(`${head}### v9.0.3 — C\n- c\n\n### v9.0.2 — B\n- b\n### v9.0.1 — A\n- a\n${tail}`);
  });

  it('resolves the conflicts of the release files and refuses any other', () => {
    const t = mergedTree();
    const ours = changelog(entry('v9.0.52', 'branch one'), entry('v9.0.51', 'old'));
    const theirs = t.base.get(ACTIVE)!;
    const merged = planRenumber(input({ base: t.base, current: new Map([...t.base, [ACTIVE, resolveReleaseConflict(ACTIVE, '', { ours, theirs }, ACTIVE)!]]) }));
    expect(merged.versions).toEqual([['v9.0.52', 'v9.0.53']]);

    const pkgConflict = '{\n<<<<<<< HEAD\n  "version": "9.0.52",\n=======\n  "version": "9.0.53",\n>>>>>>> origin/master\n  "type": "module"\n}\n';
    expect(resolveReleaseConflict('package.json', pkgConflict, { ours: '', theirs: '' }, ACTIVE)).toBe('{\n  "version": "9.0.52",\n  "type": "module"\n}\n');
    const depConflict = '<<<<<<< HEAD\n  "a": "1",\n=======\n  "a": "2",\n>>>>>>> origin/master\n';
    expect(resolveReleaseConflict('package.json', depConflict, { ours: '', theirs: '' }, ACTIVE)).toBeNull();
    expect(resolveReleaseConflict('AGENTS.md', '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> m\n', { ours: 'a', theirs: 'b' }, ACTIVE)).toBeNull();

    const debtConflict = '| TD-500 | a |\n<<<<<<< HEAD\n| TD-581 | b |\n=======\n| TD-480 | c |\n>>>>>>> m\n\n<<<<<<< HEAD\n- **فعال:** ۲ ردیف\n||||||| base\n- **فعال:** ۱ ردیف\n=======\n- **فعال:** ۳ ردیف\n>>>>>>> m\n';
    expect(resolveReleaseConflict('TECH_DEBT.md', debtConflict, { ours: '', theirs: '' }, ACTIVE)).toBe('| TD-500 | a |\n| TD-581 | b |\n| TD-480 | c |\n\n- **فعال:** ۲ ردیف\n');

    const j = resolveReleaseConflict('drizzle/meta/_journal.json', '', {
      ours: journal(['0059_old', 1000], ['0060_branch', 1500]),
      theirs: journal(['0059_old', 1000], ['0060_master', 2000]),
    }, ACTIVE)!;
    expect((JSON.parse(j) as { entries: Array<{ tag: string }> }).entries.map(e => e.tag)).toEqual(['0059_old', '0060_master', '0060_branch']);

    const mdOurs = md('### v9.0.52 — One\n- **B:** b.', '### v9.0.51 — Old\n- **O:** old.');
    const mdMerged = resolveReleaseConflict('CHANGELOG.md', '', { ours: mdOurs, theirs: t.base.get('CHANGELOG.md')! }, ACTIVE)!;
    expect([...mdMerged.matchAll(/^### (v[\d.]+ — \w+)/gm)].map(m => m[1])).toEqual(['v9.0.52 — One', 'v9.0.52 — Master', 'v9.0.51 — Old', 'v9.0.0 — pre']);
    expect(resolveHunks('a\n<<<<<<< HEAD\nb\n', () => [])).toBeNull();
  });
});
