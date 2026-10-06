import fs from 'fs';
import path from 'path';

/**
 * v9.0.0 — کارهای دفتری یک انتشار در سری فعال (AGENTS.md §7، §13، §23)، از ریشه مخزن:
 *   npm run release -- <spec.json>   سپس   npm run check:version
 * سری و فایل چنج‌لاگ از ACTIVE_CHANGELOG (src/data/changelogs/index.ts) خوانده می‌شوند؛ گذار سری ابزار را عوض نمی‌کند.
 * (جانشین scripts/v8-release.ts نسخه v8.0.45.)
 *
 * فایل spec (JSON):
 *   version, prev            «v9.0.1» و «v9.0.0» (version در سری فعال)
 *   entry                    { date, title, summary, changes[≥۱], fixes[] } — مدخل بالای چنج‌لاگ فعال
 *   mdTitle, mdLine          سرخط و یک خط CHANGELOG.md (mdLine با «- » شروع نمی‌شود)
 *   closes?                  [{ td, archiveRow, knownClass?, testId? }] — ردیف از TECH_DEBT.md برداشته و archiveRow
 *                            بالای جدول آرشیو سری فعال گذاشته می‌شود؛ knownClass (با testId) در knownFindings.ts
 *                            جای خود را به توضیح «رفع شد» می‌دهد
 *   td?, archiveRow?, knownClass?, testId?   همان closes با یک ردیف (شکل v8)
 *   openRows?                ردیف‌های کامل تازه «| TD-### | … |» برای جدول فعال TECH_DEBT.md (نسخه مستند)
 *   lastReview?              متن «آخرین بازبینی» TECH_DEBT.md (بی ستاره)
 *   edits?                   [[مسیر، متن قدیم (دقیقاً یک بار در فایل)، متن تازه], ...] — نقشه راه، گزارش ممیزی، AGENTS.md
 * چهار محل نسخه (package.json و package-lock.json، مدخل چنج‌لاگ فعال، k8s، README) با هم عوض می‌شوند.
 */

export interface CloseRow {
  td: string;
  archiveRow: string;
  knownClass?: string;
  testId?: string;
}

export interface ReleaseSpec {
  version: string;
  prev: string;
  closes?: CloseRow[];
  td?: string;
  archiveRow?: string;
  knownClass?: string;
  testId?: string;
  openRows?: string[];
  lastReview?: string;
  edits?: Array<[string, string, string]>;
  mdTitle: string;
  mdLine: string;
  entry: { date: string; title: string; summary: string; changes: string[]; fixes?: string[] };
}

export interface ReleaseFiles {
  read(rel: string): string;
  write(rel: string, content: string): void;
}

export interface ActiveSeries {
  series: number;
  file: string;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const toFa = (n: number) => String(n).replace(/\d/g, d => FA_DIGITS[Number(d)]);
const toEn = (s: string) => Number(s.replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d))));

const TABLE_SEP = '|----|------|-----|--------------|-------|';
const EMPTY_ROW = '| — | — | هیچ قلم فعالی نیست | — | — |';
const rowId = (row: string) => row.match(/^\| (TD-\d+) \|/)?.[1];

function edit(files: ReleaseFiles, p: string, oldText: string, newText: string): void {
  const s = files.read(p);
  const count = s.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${p}: متن قدیم باید دقیقاً یک بار باشد (${count} بار): ${oldText.slice(0, 90)}`);
  files.write(p, s.replace(oldText, () => newText));
}

/** ردیف‌های بسته‌شونده، از closes یا شکل تک‌ردیفی v8 */
export function closeRowsOf(spec: ReleaseSpec): CloseRow[] {
  const rows = [...(spec.closes ?? [])];
  if (spec.td) {
    if (!spec.archiveRow) throw new Error('archiveRow برای td الزامی است');
    rows.push({ td: spec.td, archiveRow: spec.archiveRow, knownClass: spec.knownClass, testId: spec.testId });
  } else if (spec.knownClass) {
    throw new Error('knownClass به td و testId نیاز دارد');
  }
  for (const r of rows) {
    if (!/^TD-\d+$/.test(r.td)) throw new Error(`شناسه نامعتبر «${r.td}»`);
    if (!r.archiveRow?.startsWith(`| ${r.td} |`)) throw new Error(`archiveRow باید با «| ${r.td} |» شروع شود`);
    if (r.knownClass && !r.testId) throw new Error(`knownClass ردیف ${r.td} به testId نیاز دارد`);
  }
  return rows;
}

/** جدول فعال TECH_DEBT.md و بخش آرشیو سری فعال در TECH_DEBT_ARCHIVE.md را به‌روز می‌کند */
export function updateTechDebt(files: ReleaseFiles, spec: ReleaseSpec, active: ActiveSeries): { active: number; archived: number } {
  const closes = closeRowsOf(spec);
  const openRows = spec.openRows ?? [];
  if (closes.length === 0 && openRows.length === 0) {
    const s = files.read('TECH_DEBT.md');
    return { active: s.split('\n').filter(l => rowId(l)).length, archived: toEn(s.match(/- \*\*آرشیو شده \(resolved\):\*\* ([۰-۹0-9]+) ردیف/)?.[1] ?? '0') };
  }

  const archive = files.read('TECH_DEBT_ARCHIVE.md');
  let lines = files.read('TECH_DEBT.md').split('\n');
  const known = new Set([...lines, ...archive.split('\n')].map(rowId).filter(Boolean));

  for (const r of closes) {
    if (!lines.some(l => l.startsWith(`| ${r.td} |`))) throw new Error(`ردیف ${r.td} در TECH_DEBT.md نیست`);
    lines = lines.filter(l => !l.startsWith(`| ${r.td} |`));
  }
  for (const row of openRows) {
    const id = rowId(row);
    if (!id || !row.trimEnd().endsWith('|')) throw new Error(`ردیف باز باید «| TD-### | … |» باشد: ${row.slice(0, 60)}`);
    if (known.has(id)) throw new Error(`شناسه ${id} از پیش در TECH_DEBT.md یا آرشیو هست`);
    known.add(id);
  }

  lines = lines.filter(l => l !== EMPTY_ROW);
  const header = lines.indexOf(TABLE_SEP);
  if (header < 0) throw new Error('جدول فعال TECH_DEBT.md پیدا نشد');
  let at = header + 1;
  while (at < lines.length && rowId(lines[at])) at++;
  lines.splice(at, 0, ...openRows);
  const activeCount = lines.filter(l => rowId(l)).length;
  if (activeCount === 0) lines.splice(header + 1, 0, EMPTY_ROW);

  let s = lines.join('\n');
  const m = s.match(/- \*\*آرشیو شده \(resolved\):\*\* ([۰-۹0-9]+) ردیف/);
  if (!m) throw new Error('شمارنده آرشیو در TECH_DEBT.md پیدا نشد');
  const archived = toEn(m[1]) + closes.length;
  s = s.replace(/- \*\*فعال:\*\* [۰-۹0-9]+ ردیف/, `- **فعال:** ${toFa(activeCount)} ردیف`);
  s = s.replace(m[0], `- **آرشیو شده (resolved):** ${toFa(archived)} ردیف`);
  files.write('TECH_DEBT.md', s);

  if (closes.length > 0) {
    const section = archive.split('\n').find(l => l.startsWith('## ') && l.includes(`نسخه ${toFa(active.series)} —`));
    if (!section) throw new Error(`بخش «نسخه ${toFa(active.series)}» در TECH_DEBT_ARCHIVE.md نیست`);
    const sep = `${TABLE_SEP}\n`;
    const pos = archive.indexOf(sep, archive.indexOf(section)) + sep.length;
    files.write('TECH_DEBT_ARCHIVE.md', archive.slice(0, pos) + closes.map(r => `${r.archiveRow}\n`).join('') + archive.slice(pos));
  }
  return { active: activeCount, archived };
}

export function changelogEntry(spec: ReleaseSpec): string {
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

/** همه کارهای دفتری یک انتشار؛ خطا پیش از نوشتن هر فایلی که ورودی را رد کند */
export function applyRelease(files: ReleaseFiles, spec: ReleaseSpec, active: ActiveSeries): { active: number; archived: number } {
  const versionRe = new RegExp(`^v${active.series}\\.\\d+\\.\\d+$`);
  if (!versionRe.test(spec.version)) throw new Error(`version باید در سری فعال ${active.series} باشد (v${active.series}.x.y)`);
  if (!/^v\d+\.\d+\.\d+$/.test(spec.prev)) throw new Error('prev باید vX.Y.Z باشد');
  if (!spec.entry?.changes?.length) throw new Error('entry.changes دست‌کم یک مورد لازم دارد');
  if (!spec.mdLine?.trim() || /^\s*-/.test(spec.mdLine)) throw new Error('mdLine نباید خالی باشد یا با «-» شروع شود (خط فهرست را ابزار می‌سازد)');
  const closes = closeRowsOf(spec);

  for (const r of closes) {
    if (r.knownClass) {
      edit(files, 'src/tests/simulation/knownFindings.ts', `  '${r.knownClass}': '${r.td}',\n`, `  // ${r.td} در ${spec.version} رفع شد (${r.testId})\n`);
    }
  }
  const counts = updateTechDebt(files, spec, active);
  if (spec.lastReview) {
    const s = files.read('TECH_DEBT.md');
    const re = /\*آخرین بازبینی: v\d+\.\d+\.\d+.*\*/;
    if (!re.test(s)) throw new Error('خط «آخرین بازبینی» در TECH_DEBT.md پیدا نشد');
    files.write('TECH_DEBT.md', s.replace(re, () => `*${spec.lastReview}*`));
  }
  for (const [p, oldText, newText] of spec.edits ?? []) edit(files, p, oldText, newText);

  const header = `## Version ${active.series}.x Series (Active — see \`${active.file}\`)\n\n`;
  edit(files, 'CHANGELOG.md', header, `${header}### ${spec.version} — ${spec.mdTitle}\n- ${spec.mdLine}\n\n`);
  const listHead = `export const v${active.series}Updates: AIUpdateLog[] = [\n`;
  edit(files, active.file, listHead, listHead + changelogEntry(spec));

  const next = spec.version.slice(1);
  const prev = spec.prev.slice(1);
  edit(files, 'README.md', `نسخه مستقر: \`${spec.prev}\``, `نسخه مستقر: \`${spec.version}\``);
  edit(files, 'deploy/k8s/erp-deployment.yaml', `erp:${spec.prev}`, `erp:${spec.version}`);
  edit(files, 'deploy/k8s/erp-deployment.yaml', `value: "${prev}"`, `value: "${next}"`);
  edit(files, 'package.json', `"version": "${prev}"`, `"version": "${next}"`);
  const lock = files.read('package-lock.json');
  const occurrences = lock.split(`"version": "${prev}"`).length - 1;
  if (occurrences < 2) throw new Error(`package-lock.json: نسخه ${prev} دو بار (ریشه و بسته ریشه) لازم است`);
  let replaced = 0;
  files.write('package-lock.json', lock.replace(new RegExp(`"version": "${prev.replace(/\./g, '\\.')}"`, 'g'), m => (replaced++ < 2 ? `"version": "${next}"` : m)));
  return counts;
}

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('استفاده: npm run release -- <spec.json>');
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('از ریشه مخزن اجرا کنید');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as ReleaseSpec;
  const { ACTIVE_CHANGELOG } = await import('../src/data/changelogs/index.js');

  // همه نوشتن‌ها اول در حافظه؛ فقط اگر کل انتشار بی خطا بود روی دیسک می‌روند
  const pending = new Map<string, string>();
  const files: ReleaseFiles = {
    read: rel => pending.get(rel) ?? fs.readFileSync(path.join(root, rel), 'utf8'),
    write: (rel, content) => { pending.set(rel, content); },
  };
  const counts = applyRelease(files, spec, { series: ACTIVE_CHANGELOG.series, file: ACTIVE_CHANGELOG.file });
  for (const [rel, content] of pending) fs.writeFileSync(path.join(root, rel), content);
  console.log(`✅ ${spec.version} — فعال ${counts.active}، آرشیو ${counts.archived}. اکنون npm run check:version`);
}

if (process.argv[1]?.endsWith('release.ts') || process.argv[1]?.endsWith('release.js')) {
  main().catch((err: unknown) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
