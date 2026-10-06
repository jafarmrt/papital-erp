import { describe, expect, it } from 'vitest';
import { applyRelease, type ReleaseFiles, type ReleaseSpec } from '../../../scripts/release';

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
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ version: 'v8.0.129' }), ACTIVE)).toThrow(/سری فعال 9/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ mdLine: '- یک خط.' }), ACTIVE)).toThrow(/mdLine/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ openRows: [row('TD-413')] }), ACTIVE)).toThrow(/TD-413/);
    expect(() => applyRelease(memoryFiles(fixture([])), baseSpec({ td: 'TD-999', archiveRow: row('TD-999') }), ACTIVE)).toThrow(/TD-999/);
  });
});
