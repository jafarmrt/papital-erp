import fs from 'fs';
import path from 'path';

/**
 * v8.0.45 — کارهای دفتری یک انتشار v8.0.x (AGENTS.md §7، §13، §23)، از ریشه مخزن:
 *   npm run release:v8 -- <spec.json>   سپس   npm run check:version
 *
 * فایل spec (JSON):
 *   version, prev            «v8.0.46» و «v8.0.45»
 *   entry                    { date, title, summary, changes[≥۱], fixes[] } — مدخل بالای src/data/changelogs/8.ts
 *   mdTitle, mdLine          سرخط و یک خط CHANGELOG.md
 *   td?                      «TD-###»: ردیف از TECH_DEBT.md برداشته و archiveRow بالای جدول نسخه ۸ آرشیو گذاشته می‌شود
 *   archiveRow?              ردیف کامل آرشیو (با td الزامی)
 *   knownClass?, testId?     کلاس رفع‌شده خط پایه src/tests/simulation/knownFindings.ts جای خود را به توضیح «رفع شد» می‌دهد
 *   lastReview?              متن «آخرین بازبینی» TECH_DEBT.md (بی ستاره)
 *   edits?                   [[مسیر، متن قدیم (دقیقاً یک بار در فایل)، متن تازه], ...] — نقشه راه، گزارش ممیزی، AGENTS.md
 * چهار محل نسخه (package.json و package-lock.json، مدخل 8.ts، k8s، README) با هم عوض می‌شوند.
 */

interface ReleaseSpec {
  version: string;
  prev: string;
  td?: string;
  archiveRow?: string;
  knownClass?: string;
  testId?: string;
  lastReview?: string;
  edits?: Array<[string, string, string]>;
  mdTitle: string;
  mdLine: string;
  entry: { date: string; title: string; summary: string; changes: string[]; fixes?: string[] };
}

const ROOT = process.cwd();
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (n: number) => String(n).replace(/\d/g, d => FA_DIGITS[Number(d)]);
const toEn = (s: string) => Number(s.replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d))));

const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p: string, s: string) => fs.writeFileSync(path.join(ROOT, p), s);
function edit(p: string, oldText: string, newText: string): void {
  const s = read(p);
  const count = s.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${p}: متن قدیم باید دقیقاً یک بار باشد (${count} بار): ${oldText.slice(0, 90)}`);
  write(p, s.replace(oldText, () => newText));
}

function closeTechDebtRow(spec: ReleaseSpec): { active: number; archived: number } {
  const td = spec.td as string;
  if (!spec.archiveRow) throw new Error('archiveRow برای td الزامی است');
  let lines = read('TECH_DEBT.md').split('\n');
  if (!lines.some(l => l.startsWith(`| ${td} |`))) throw new Error(`ردیف ${td} در TECH_DEBT.md نیست`);
  lines = lines.filter(l => !l.startsWith(`| ${td} |`));
  const active = lines.filter(l => /^\| TD-\d+ \|/.test(l)).length;
  if (active === 0) {
    const header = lines.indexOf('|----|------|-----|--------------|-------|');
    lines.splice(header + 1, 0, '| — | — | هیچ قلم فعالی نیست | — | — |');
  }
  let s = lines.join('\n');
  const m = s.match(/- \*\*آرشیو شده \(resolved\):\*\* ([۰-۹0-9]+) ردیف/);
  if (!m) throw new Error('شمارنده آرشیو در TECH_DEBT.md پیدا نشد');
  const archived = toEn(m[1]) + 1;
  s = s.replace(/- \*\*فعال:\*\* [۰-۹0-9]+ ردیف/, `- **فعال:** ${toFa(active)} ردیف`);
  s = s.replace(m[0], `- **آرشیو شده (resolved):** ${toFa(archived)} ردیف`);
  write('TECH_DEBT.md', s);

  const archive = read('TECH_DEBT_ARCHIVE.md');
  const sep = '|----|------|-----|--------------|-------|\n';
  const at = archive.indexOf(sep, archive.indexOf('## 🔬 نسخه ۸')) + sep.length;
  write('TECH_DEBT_ARCHIVE.md', archive.slice(0, at) + spec.archiveRow + '\n' + archive.slice(at));
  return { active, archived };
}

function changelogEntry(spec: ReleaseSpec): string {
  const q = (t: string) => `'${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const list = (items: string[]) => (items.length === 0 ? '[]' : `[\n${items.map(t => `      ${q(t)}`).join(',\n')}\n    ]`);
  const e = spec.entry;
  return `  {
    version: '${spec.version}',
    date: ${q(e.date)},
    title: ${q(e.title)},
    summary: ${q(e.summary)},
    changes: ${list(e.changes)},
    fixes: ${list(e.fixes ?? [])}
  },
`;
}

function main(): void {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('استفاده: npm run release:v8 -- <spec.json>');
  if (!fs.existsSync(path.join(ROOT, 'package.json'))) throw new Error('از ریشه مخزن اجرا کنید');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as ReleaseSpec;
  if (!/^v8\.\d+\.\d+$/.test(spec.version) || !/^v8\.\d+\.\d+$/.test(spec.prev)) throw new Error('version و prev باید v8.x.y باشند');
  if (!spec.entry?.changes?.length) throw new Error('entry.changes دست‌کم یک مورد لازم دارد');

  if (spec.knownClass) {
    if (!spec.td || !spec.testId) throw new Error('knownClass به td و testId نیاز دارد');
    edit('src/tests/simulation/knownFindings.ts', `  '${spec.knownClass}': '${spec.td}',\n`, `  // ${spec.td} در ${spec.version} رفع شد (${spec.testId})\n`);
  }
  const counts = spec.td ? closeTechDebtRow(spec) : null;
  if (spec.lastReview) {
    const s = read('TECH_DEBT.md');
    if (!/\*آخرین بازبینی: v8\.\d+\.\d+.*\*/.test(s)) throw new Error('خط «آخرین بازبینی» در TECH_DEBT.md پیدا نشد');
    write('TECH_DEBT.md', s.replace(/\*آخرین بازبینی: v8\.\d+\.\d+.*\*/, () => `*${spec.lastReview}*`));
  }
  for (const [p, oldText, newText] of spec.edits ?? []) edit(p, oldText, newText);

  const header = '## Version 8.x Series (Active — see `src/data/changelogs/8.ts`)\n\n';
  edit('CHANGELOG.md', header, `${header}### ${spec.version} — ${spec.mdTitle}\n- ${spec.mdLine}\n\n`);
  const listHead = 'export const v8Updates: AIUpdateLog[] = [\n';
  edit('src/data/changelogs/8.ts', listHead, listHead + changelogEntry(spec));

  const next = spec.version.slice(1);
  const prev = spec.prev.slice(1);
  edit('README.md', `نسخه مستقر: \`${spec.prev}\``, `نسخه مستقر: \`${spec.version}\``);
  edit('deploy/k8s/erp-deployment.yaml', `erp:${spec.prev}`, `erp:${spec.version}`);
  edit('deploy/k8s/erp-deployment.yaml', `value: "${prev}"`, `value: "${next}"`);
  edit('package.json', `"version": "${prev}"`, `"version": "${next}"`);
  const lock = read('package-lock.json');
  const occurrences = lock.split(`"version": "${prev}"`).length - 1;
  if (occurrences < 2) throw new Error(`package-lock.json: نسخه ${prev} دو بار (ریشه و بسته ریشه) لازم است`);
  let replaced = 0;
  write('package-lock.json', lock.replace(new RegExp(`"version": "${prev.replace(/\./g, '\\.')}"`, 'g'), m => (replaced++ < 2 ? `"version": "${next}"` : m)));

  console.log(`✅ ${spec.version}${counts ? ` — فعال ${counts.active}، آرشیو ${counts.archived}` : ''}. اکنون npm run check:version`);
}

try {
  main();
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
