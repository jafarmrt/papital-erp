// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { applyRelease, toFa, type ReleaseFiles, type ReleaseSpec } from '../../../scripts/release';
import { ACTIVE_CHANGELOG } from '../../data/changelogs/index';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * v9.0.0: ابزار انتشار عمومی (scripts/release.ts) سری و فایل چنج‌لاگ را از سری فعال می‌گیرد،
 * چند ردیف TD را در یک نسخه می‌بندد و ردیف باز تازه (نسخه مستند فاز ۴) می‌افزاید.
 */

const ACTIVE = { series: 9, file: 'src/data/changelogs/9.ts' };

function fixture(activeRows: string[]): Map<string, string> {
  return new Map<string, string>([
    ['TECH_DEBT.md', [
      '## 🔵 اقلام فعال نسخه ۹ (open / scheduled / in_progress)',
      '',
      '| ID | حوزه | شرح | منبع (فایل) | وضعیت |',
      '|----|------|-----|--------------|-------|',
      ...(activeRows.length ? activeRows : ['| — | — | هیچ قلم فعالی نیست | — | — |']),
      '',
      `- **فعال:** ${'۰۱۲۳۴۵۶۷۸۹'[activeRows.length]} ردیف`,
      '- **آرشیو شده (resolved):** ۳۶۵ ردیف — تاریخچه کامل در `TECH_DEBT_ARCHIVE.md`',
      '',
      '*آخرین بازبینی: v9.0.0 — آغاز سری ۹.*',
    ].join('\n')],
    ['TECH_DEBT_ARCHIVE.md', [
      '## 🧭 نسخه ۹ — ممیزی پایداری — آرشیو',
      '',
      '| ID | حوزه | شرح | منبع (فایل) | وضعیت |',
      '|----|------|-----|--------------|-------|',
      '',
      '## 🔬 نسخه ۸ — ارزیابی صحت منطق کاری — آرشیو',
      '',
      '| ID | حوزه | شرح | منبع (فایل) | وضعیت |',
      '|----|------|-----|--------------|-------|',
      '| TD-413 | حسابداری | P3 — قدیمی | x.ts | resolved (v8.0.114) |',
    ].join('\n')],
    ['CHANGELOG.md', '## Version 9.x Series (Active — see `src/data/changelogs/9.ts`)\n\n### v9.0.0 — آغاز\n- آغاز سری ۹.\n'],
    ['src/data/changelogs/9.ts', "export const v9Updates: AIUpdateLog[] = [\n  {\n    version: 'v9.0.0',\n  }\n];\n"],
    ['README.md', 'نسخه مستقر: `v9.0.0`'],
    ['deploy/k8s/erp-deployment.yaml', 'image: erp:v9.0.0\n  - name: APP_VERSION\n    value: "9.0.0"\n'],
    ['package.json', '{\n  "version": "9.0.0"\n}'],
    ['package-lock.json', '{\n  "version": "9.0.0",\n  "packages": { "": { "version": "9.0.0" }, "x": { "version": "9.0.0" } }\n}'],
    ['src/tests/simulation/knownFindings.ts', "export const KNOWN_FINDINGS = {\n  'stock_x': 'TD-414',\n};\n"],
  ]);
}

function memoryFiles(store: Map<string, string>): ReleaseFiles {
  return {
    read: rel => {
      const s = store.get(rel);
      if (s === undefined) throw new Error(`no file ${rel}`);
      return s;
    },
    write: (rel, content) => { store.set(rel, content); },
  };
}

const baseSpec = (over: Partial<ReleaseSpec>): ReleaseSpec => ({
  version: 'v9.0.1',
  prev: 'v9.0.0',
  mdTitle: 'عنوان',
  mdLine: 'یک خط.',
  entry: { date: '۱۴ مهر ۱۴۰۵', title: 'عنوان', summary: 'خلاصه', changes: ['تغییر'], fixes: [] },
  ...over,
});

const row = (id: string, status = 'open') => `| ${id} | انبار | P2 — شرح | a.ts | ${status} |`;

describe('scripts/release.ts (v9.0.0)', () => {
  it('writes the entry of the active series and bumps the four version locations', () => {
    const store = fixture([]);
    applyRelease(memoryFiles(store), baseSpec({}), ACTIVE);
    expect(store.get('src/data/changelogs/9.ts')).toMatch(/export const v9Updates: AIUpdateLog\[\] = \[\n {2}\{\n {4}version: 'v9\.0\.1'/);
    expect(store.get('CHANGELOG.md')).toContain('### v9.0.1 — عنوان\n- یک خط.\n\n### v9.0.0');
    expect(store.get('README.md')).toBe('نسخه مستقر: `v9.0.1`');
    expect(store.get('deploy/k8s/erp-deployment.yaml')).toContain('erp:v9.0.1');
    expect(store.get('deploy/k8s/erp-deployment.yaml')).toContain('value: "9.0.1"');
    expect(store.get('package.json')).toContain('"version": "9.0.1"');
    expect(store.get('package-lock.json')!.split('"version": "9.0.1"').length - 1).toBe(2);
  });

  it('closes several TD rows into the active series archive section and updates the counters', () => {
    const store = fixture([row('TD-414'), row('TD-415'), row('TD-416')]);
    const counts = applyRelease(memoryFiles(store), baseSpec({
      closes: [
        { td: 'TD-414', archiveRow: row('TD-414', 'resolved (v9.0.1)'), knownClass: 'stock_x', testId: 'inv_td_414' },
        { td: 'TD-415', archiveRow: row('TD-415', 'resolved (v9.0.1)') },
      ],
    }), ACTIVE);
    expect(counts).toEqual({ active: 1, archived: 367 });
    const debt = store.get('TECH_DEBT.md')!;
    expect(debt).not.toContain('| TD-414 |');
    expect(debt).toContain('| TD-416 |');
    expect(debt).toContain('- **فعال:** ۱ ردیف');
    expect(debt).toContain('- **آرشیو شده (resolved):** ۳۶۷ ردیف');
    const archive = store.get('TECH_DEBT_ARCHIVE.md')!;
    expect(archive.indexOf('| TD-414 |')).toBeLessThan(archive.indexOf('## 🔬 نسخه ۸'));
    expect(archive.indexOf('| TD-415 |')).toBeLessThan(archive.indexOf('## 🔬 نسخه ۸'));
    expect(store.get('src/tests/simulation/knownFindings.ts')).toContain('// TD-414 در v9.0.1 رفع شد (inv_td_414)');
  });

  it('adds open rows of a documentation release and replaces the empty placeholder', () => {
    const store = fixture([]);
    const counts = applyRelease(memoryFiles(store), baseSpec({ openRows: [row('TD-414'), row('TD-415')] }), ACTIVE);
    expect(counts.active).toBe(2);
    const debt = store.get('TECH_DEBT.md')!;
    expect(debt).not.toContain('هیچ قلم فعالی نیست');
    expect(debt.indexOf('| TD-414 |')).toBeLessThan(debt.indexOf('| TD-415 |'));
    expect(debt).toContain('- **فعال:** ۲ ردیف');
  });

  it('puts the empty placeholder back when the last active row is closed', () => {
    const store = fixture([row('TD-414')]);
    applyRelease(memoryFiles(store), baseSpec({ td: 'TD-414', archiveRow: row('TD-414', 'resolved (v9.0.1)') }), ACTIVE);
    expect(store.get('TECH_DEBT.md')).toContain('| — | — | هیچ قلم فعالی نیست | — | — |');
    expect(store.get('TECH_DEBT.md')).toContain('- **فعال:** ۰ ردیف');
  });

  it('refuses a version outside the active series, a dash-prefixed CHANGELOG line and a reused TD id', () => {
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ version: 'v8.0.129' }), ACTIVE)).toThrow(/active series 9/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ mdLine: '- یک خط.' }), ACTIVE)).toThrow(/mdLine/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ openRows: [row('TD-413')] }), ACTIVE)).toThrow(/TD-413/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ td: 'TD-999', archiveRow: row('TD-999') }), ACTIVE)).toThrow(/TD-999/);
  });
});

/**
 * v10.0.0: series 9 is closed and series 10 is active. The tool takes a two-digit series from the active changelog,
 * closes rows into the «نسخه ۱۰ —» archive section and never into the section of the closed series below it.
 */
const ACTIVE_10 = { series: 10, file: 'src/data/changelogs/10.ts' };

function fixture10(activeRows: string[]): Map<string, string> {
  const store = fixture(activeRows);
  store.set('TECH_DEBT.md', store.get('TECH_DEBT.md')!.replace('اقلام فعال نسخه ۹', 'اقلام فعال نسخه ۱۰'));
  store.set('TECH_DEBT_ARCHIVE.md', [
    '## 🧭 نسخه ۱۰ — بدهی‌ها و مشاهده‌های سری ۹ — آرشیو',
    '',
    '| ID | حوزه | شرح | منبع (فایل) | وضعیت |',
    '|----|------|-----|--------------|-------|',
    '',
    store.get('TECH_DEBT_ARCHIVE.md')!,
  ].join('\n'));
  store.set('CHANGELOG.md', '## Version 10.x Series (Active — see `src/data/changelogs/10.ts`)\n\n### v10.0.0 — آغاز\n- آغاز سری ۱۰.\n\n---\n\n## Version 9.x Series (Archived at v9.0.450)\n\n### v9.0.450 — پایان\n- پایان سری ۹.\n');
  store.set('src/data/changelogs/10.ts', "export const v10Updates: AIUpdateLog[] = [\n  {\n    version: 'v10.0.0',\n  }\n];\n");
  store.set('README.md', 'نسخه مستقر: `v10.0.0`');
  store.set('deploy/k8s/erp-deployment.yaml', 'image: erp:v10.0.0\n  - name: APP_VERSION\n    value: "10.0.0"\n');
  store.set('package.json', '{\n  "version": "10.0.0"\n}');
  store.set('package-lock.json', '{\n  "version": "10.0.0",\n  "packages": { "": { "version": "10.0.0" }, "x": { "version": "10.0.0" } }\n}');
  return store;
}

describe('scripts/release.ts with series 10 (v10.0.0)', () => {
  it('releases v10.0.1 in 10.ts and closes rows into the series 10 archive section', () => {
    const store = fixture10([row('TD-1000'), row('TD-1001')]);
    const counts = applyRelease(memoryFiles(store), baseSpec({
      version: 'v10.0.1',
      prev: 'v10.0.0',
      closes: [{ td: 'TD-1000', archiveRow: row('TD-1000', 'resolved (v10.0.1)') }],
    }), ACTIVE_10);
    expect(counts).toEqual({ active: 1, archived: 366 });
    expect(store.get('src/data/changelogs/10.ts')).toMatch(/export const v10Updates: AIUpdateLog\[\] = \[\n {2}\{\n {4}version: 'v10\.0\.1'/);
    expect(store.get('CHANGELOG.md')).toContain('### v10.0.1 — عنوان\n- یک خط.\n\n### v10.0.0');
    expect(store.get('README.md')).toBe('نسخه مستقر: `v10.0.1`');
    expect(store.get('deploy/k8s/erp-deployment.yaml')).toContain('erp:v10.0.1');
    expect(store.get('deploy/k8s/erp-deployment.yaml')).toContain('value: "10.0.1"');
    expect(store.get('package-lock.json')!.split('"version": "10.0.1"').length - 1).toBe(2);
    const archive = store.get('TECH_DEBT_ARCHIVE.md')!;
    const at = archive.indexOf('| TD-1000 |');
    expect(at).toBeGreaterThan(archive.indexOf('## 🧭 نسخه ۱۰ —'));
    expect(at).toBeLessThan(archive.indexOf('## 🧭 نسخه ۹ —'));
    expect(store.get('TECH_DEBT.md')).not.toContain('| TD-1000 |');
  });

  it('refuses a version of a closed series', () => {
    expect(() => applyRelease(memoryFiles(fixture10([])), baseSpec({ version: 'v9.0.451', prev: 'v10.0.0' }), ACTIVE_10)).toThrow(/active series 10/);
  });

  it('works on the repository files with the active changelog series', () => {
    const files = ['TECH_DEBT.md', 'TECH_DEBT_ARCHIVE.md', 'CHANGELOG.md', ACTIVE_CHANGELOG.file, 'README.md',
      'deploy/k8s/erp-deployment.yaml', 'package.json', 'package-lock.json', 'src/tests/simulation/knownFindings.ts'];
    const store = new Map(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')] as [string, string]));
    const prev = `v${String(JSON.parse(store.get('package.json')!).version)}`;
    const [major, minor, patch] = prev.slice(1).split('.').map(Number);
    expect(major).toBe(ACTIVE_CHANGELOG.series);
    const version = `v${major}.${minor}.${patch + 1}`;
    // a synthetic open row, so that the archive section of the active series is always exercised
    const debtLines = store.get('TECH_DEBT.md')!.split('\n');
    debtLines.splice(debtLines.indexOf('|----|------|-----|--------------|-------|') + 1, 0, row('TD-99999'));
    store.set('TECH_DEBT.md', debtLines.join('\n'));
    const archiveRow = row('TD-99999', `resolved (${version})`);
    applyRelease(memoryFiles(store), baseSpec({ version, prev, closes: [{ td: 'TD-99999', archiveRow }] }),
      { series: ACTIVE_CHANGELOG.series, file: ACTIVE_CHANGELOG.file });
    expect(store.get(ACTIVE_CHANGELOG.file)).toContain(`export const v${major}Updates: AIUpdateLog[] = [\n  {\n    version: '${version}',`);
    expect(store.get('CHANGELOG.md')).toContain(`## Version ${major}.x Series (Active — see \`${ACTIVE_CHANGELOG.file}\`)\n\n### ${version} — `);
    expect(store.get('README.md')).toContain(`نسخه مستقر: \`${version}\``);
    expect(store.get('package.json')).toContain(`"version": "${version.slice(1)}"`);
    const archive = store.get('TECH_DEBT_ARCHIVE.md')!;
    const section = archive.indexOf(`نسخه ${toFa(major)} —`);
    expect(section).toBeGreaterThan(-1);
    const at = archive.indexOf(archiveRow);
    expect(at).toBeGreaterThan(section);
    expect(at).toBeLessThan(archive.indexOf('\n## ', section));
    expect(store.get('TECH_DEBT.md')).not.toContain('| TD-99999 |');
  });
});
