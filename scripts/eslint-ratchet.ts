import fs from 'fs';
import path from 'path';
import { ESLint } from 'eslint';

/**
 * v7.0.65 (audit P3-4 / P3-2 / P3-3) — گیت ESLint با فایل پایه (ratchet)
 * ================================================================
 * ESLint روی کل کد (eslint.config.js) اجرا و تعداد تخلف هر قاعده با eslint-baseline.json مقایسه می‌شود:
 *   - افزایش هر قاعده → شکست (کد تازه نباید any، Promise رهاشده، وابستگی ناقص hook یا فایل بلند اضافه کند)
 *   - کاهش هر قاعده → شکست با راهنمای `npm run lint:eslint -- --update` تا بهبود در فایل پایه قفل شود
 *   - خطای پارس (پیام بدون قاعده) → همیشه شکست
 * شمارش در سطح قاعده است (نه فایل) تا جابه‌جایی کد هنگام تقسیم فایل‌های بزرگ گیت را نشکند.
 *
 * v7.0.106 (TD-106، تصمیم مالک محصول): `no-explicit-any` به تفکیک فایل شمرده می‌شود (eslint-any-baseline.json):
 *   - هیچ فایلی نمی‌تواند any بیشتری از عدد پایه خود بگیرد؛ فایل تازه (بدون ردیف) باید صفر any داشته باشد
 *   - any خاموش‌شده با `eslint-disable` هم شمرده می‌شود تا راه فرار نباشد
 *   - جابه‌جایی any از یک فایل به فایل دیگر (حتی با جمع ثابت) رد می‌شود
 *
 * v7.0.109 (TD-106): هر پیام با سطح error (any در مسیرهای پول و انبار، MONEY_STOCK_PATHS در eslint.config.js) بدون
 * توجه به فایل پایه رد می‌شود؛ خاموش کردن آن با eslint-disable هم رد می‌شود.
 */

export const BASELINE_FILE = 'eslint-baseline.json';
export const ANY_BASELINE_FILE = 'eslint-any-baseline.json';
export const ANY_RULE = '@typescript-eslint/no-explicit-any';
export const LINT_TARGETS = ['src', 'server.ts', 'scripts'];

export type RuleCounts = Record<string, number>;

export interface RatchetResult {
  increased: Array<{ rule: string; baseline: number; current: number }>;
  decreased: Array<{ rule: string; baseline: number; current: number }>;
}

export interface FileAnyChange { file: string; baseline: number; current: number }

/** تعداد تخلف هر قاعده به‌جز any (any جدا و به تفکیک فایل شمرده می‌شود) */
export function countByRule(results: Array<{ messages: Array<{ ruleId: string | null }> }>): { counts: RuleCounts; fatal: number } {
  const counts: RuleCounts = {};
  let fatal = 0;
  for (const file of results) {
    for (const msg of file.messages) {
      if (!msg.ruleId) { fatal++; continue; }
      if (msg.ruleId === ANY_RULE) continue;
      counts[msg.ruleId] = (counts[msg.ruleId] || 0) + 1;
    }
  }
  return { counts, fatal };
}

/** تعداد any هر فایل (مسیر نسبی با /)، شامل anyهایی که با eslint-disable خاموش شده‌اند؛ فایل بدون any ردیف ندارد */
export function countAnyByFile(
  results: Array<{ filePath: string; messages: Array<{ ruleId: string | null }>; suppressedMessages?: Array<{ ruleId: string | null }> }>,
  cwd: string
): RuleCounts {
  const counts: RuleCounts = {};
  for (const r of results) {
    const n = [...r.messages, ...(r.suppressedMessages ?? [])].filter(m => m.ruleId === ANY_RULE).length;
    if (n > 0) counts[path.relative(cwd, r.filePath).split(path.sep).join('/')] = n;
  }
  return counts;
}

/** پیام‌های سطح error (فعال یا خاموش‌شده با eslint-disable) که فایل پایه آن‌ها را نمی‌پذیرد */
export function findBlockingErrors(
  results: Array<{ filePath: string; messages: Array<{ ruleId: string | null; severity: number; line?: number }>; suppressedMessages?: Array<{ ruleId: string | null; severity: number; line?: number }> }>,
  cwd: string
): Array<{ file: string; line: number; ruleId: string; suppressed: boolean }> {
  const blocking: Array<{ file: string; line: number; ruleId: string; suppressed: boolean }> = [];
  for (const r of results) {
    const file = path.relative(cwd, r.filePath).split(path.sep).join('/');
    for (const m of r.messages) if (m.ruleId && m.severity === 2) blocking.push({ file, line: m.line ?? 0, ruleId: m.ruleId, suppressed: false });
    for (const m of r.suppressedMessages ?? []) if (m.ruleId && m.severity === 2) blocking.push({ file, line: m.line ?? 0, ruleId: m.ruleId, suppressed: true });
  }
  return blocking;
}

/** مقایسه any هر فایل با عدد پایه همان فایل؛ فایلی که در پایه نیست عدد پایه صفر دارد */
export function compareAnyByFile(current: RuleCounts, baseline: RuleCounts): { increased: FileAnyChange[]; decreased: FileAnyChange[] } {
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  const result: { increased: FileAnyChange[]; decreased: FileAnyChange[] } = { increased: [], decreased: [] };
  for (const file of [...files].sort()) {
    const b = baseline[file] || 0;
    const c = current[file] || 0;
    if (c > b) result.increased.push({ file, baseline: b, current: c });
    else if (c < b) result.decreased.push({ file, baseline: b, current: c });
  }
  return result;
}

export function compareWithBaseline(current: RuleCounts, baseline: RuleCounts): RatchetResult {
  const rules = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  const result: RatchetResult = { increased: [], decreased: [] };
  for (const rule of [...rules].sort()) {
    const b = baseline[rule] || 0;
    const c = current[rule] || 0;
    if (c > b) result.increased.push({ rule, baseline: b, current: c });
    else if (c < b) result.decreased.push({ rule, baseline: b, current: c });
  }
  return result;
}

function totalOf(counts: RuleCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function sortedCounts(counts: RuleCounts): RuleCounts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles(LINT_TARGETS);
  const { counts, fatal } = countByRule(results);
  const anyCounts = countAnyByFile(results, process.cwd());
  const baselinePath = path.resolve(process.cwd(), BASELINE_FILE);
  const anyBaselinePath = path.resolve(process.cwd(), ANY_BASELINE_FILE);

  if (fatal > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    const fatalOnly = results
      .map(r => ({ ...r, messages: r.messages.filter(m => !m.ruleId) }))
      .filter(r => r.messages.length > 0);
    console.error(await formatter.format(fatalOnly));
    console.error(`❌ ESLint: ${fatal} خطای پارس`);
    process.exit(1);
  }

  const blocking = findBlockingErrors(results, process.cwd());
  if (blocking.length > 0) {
    for (const b of blocking) console.error(`❌ ${b.file}:${b.line} ${b.ruleId}${b.suppressed ? ' (خاموش‌شده با eslint-disable)' : ''}`);
    console.error('این قاعده در این مسیر خطاست و فایل پایه آن را نمی‌پذیرد (any در مسیرهای پول و انبار سرور ممنوع است).');
    process.exit(1);
  }

  if (update) {
    const previousAny: RuleCounts = fs.existsSync(anyBaselinePath) ? JSON.parse(fs.readFileSync(anyBaselinePath, 'utf8')) : {};
    const grown = compareAnyByFile(anyCounts, previousAny).increased;
    if (fs.existsSync(anyBaselinePath) && grown.length > 0) {
      for (const g of grown) console.error(`❌ ${g.file}: any ${g.baseline} → ${g.current}`);
      console.error('فایل پایه any فقط می‌تواند کم شود؛ any تازه را رفع کنید.');
      process.exit(1);
    }
    fs.writeFileSync(baselinePath, JSON.stringify(sortedCounts(counts), null, 2) + '\n');
    fs.writeFileSync(anyBaselinePath, JSON.stringify(sortedCounts(anyCounts), null, 2) + '\n');
    console.log(`✅ فایل پایه ESLint به‌روز شد: ${JSON.stringify(sortedCounts(counts))}، any: ${totalOf(anyCounts)} در ${Object.keys(anyCounts).length} فایل`);
    return;
  }

  const baseline: RuleCounts = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
  const anyBaseline: RuleCounts = fs.existsSync(anyBaselinePath) ? JSON.parse(fs.readFileSync(anyBaselinePath, 'utf8')) : {};
  const { increased, decreased } = compareWithBaseline(counts, baseline);
  const anyChange = compareAnyByFile(anyCounts, anyBaseline);
  if (anyChange.increased.length > 0) {
    const grownFiles = new Set(anyChange.increased.map(i => i.file));
    const formatter = await eslint.loadFormatter('stylish');
    const relevant = results
      .filter(r => grownFiles.has(path.relative(process.cwd(), r.filePath).split(path.sep).join('/')))
      .map(r => ({ ...r, messages: r.messages.filter(m => m.ruleId === ANY_RULE) }));
    console.error(await formatter.format(relevant));
    for (const i of anyChange.increased) console.error(`❌ ${i.file}: any ${i.baseline} → ${i.current}${i.baseline === 0 ? ' (فایل تازه یا بدون any باید صفر بماند)' : ''}`);
    console.error('هیچ فایلی نمی‌تواند any بیشتری بگیرد (any خاموش‌شده با eslint-disable هم شمرده می‌شود).');
    process.exit(1);
  }
  if (increased.length > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    const rules = new Set(increased.map(i => i.rule));
    const relevant = results
      .map(r => ({ ...r, messages: r.messages.filter(m => m.ruleId && rules.has(m.ruleId)) }))
      .filter(r => r.messages.length > 0);
    console.error(await formatter.format(relevant));
    for (const i of increased) console.error(`❌ ${i.rule}: ${i.baseline} → ${i.current} (افزایش ${i.current - i.baseline})`);
    console.error('تخلف تازه را رفع کنید؛ فایل پایه فقط می‌تواند کم شود.');
    process.exit(1);
  }
  if (decreased.length > 0 || anyChange.decreased.length > 0) {
    for (const d of decreased) console.error(`⬇️  ${d.rule}: ${d.baseline} → ${d.current}`);
    for (const d of anyChange.decreased) console.error(`⬇️  ${d.file}: any ${d.baseline} → ${d.current}`);
    console.error('❌ تخلفات کم شده‌اند؛ برای قفل‌کردن بهبود `npm run lint:eslint -- --update` را اجرا و eslint-baseline.json و eslint-any-baseline.json را commit کنید.');
    process.exit(1);
  }
  console.log(`✅ ESLint ratchet OK: ${JSON.stringify(sortedCounts(counts))}، any: ${totalOf(anyCounts)} در ${Object.keys(anyCounts).length} فایل`);
}

if (process.argv[1]?.endsWith('eslint-ratchet.ts') || process.argv[1]?.endsWith('eslint-ratchet.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
