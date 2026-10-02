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
 */

export const BASELINE_FILE = 'eslint-baseline.json';
export const LINT_TARGETS = ['src', 'server.ts', 'scripts'];

export type RuleCounts = Record<string, number>;

export interface RatchetResult {
  increased: Array<{ rule: string; baseline: number; current: number }>;
  decreased: Array<{ rule: string; baseline: number; current: number }>;
}

export function countByRule(results: Array<{ messages: Array<{ ruleId: string | null }> }>): { counts: RuleCounts; fatal: number } {
  const counts: RuleCounts = {};
  let fatal = 0;
  for (const file of results) {
    for (const msg of file.messages) {
      if (!msg.ruleId) { fatal++; continue; }
      counts[msg.ruleId] = (counts[msg.ruleId] || 0) + 1;
    }
  }
  return { counts, fatal };
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

function sortedCounts(counts: RuleCounts): RuleCounts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const update = process.argv.includes('--update');
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles(LINT_TARGETS);
  const { counts, fatal } = countByRule(results);
  const baselinePath = path.resolve(process.cwd(), BASELINE_FILE);

  if (fatal > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    const fatalOnly = results
      .map(r => ({ ...r, messages: r.messages.filter(m => !m.ruleId) }))
      .filter(r => r.messages.length > 0);
    console.error(await formatter.format(fatalOnly));
    console.error(`❌ ESLint: ${fatal} خطای پارس`);
    process.exit(1);
  }

  if (update) {
    fs.writeFileSync(baselinePath, JSON.stringify(sortedCounts(counts), null, 2) + '\n');
    console.log(`✅ فایل پایه ESLint به‌روز شد: ${JSON.stringify(sortedCounts(counts))}`);
    return;
  }

  const baseline: RuleCounts = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
  const { increased, decreased } = compareWithBaseline(counts, baseline);
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
  if (decreased.length > 0) {
    for (const d of decreased) console.error(`⬇️  ${d.rule}: ${d.baseline} → ${d.current}`);
    console.error('❌ تخلفات کم شده‌اند؛ برای قفل‌کردن بهبود `npm run lint:eslint -- --update` را اجرا و eslint-baseline.json را commit کنید.');
    process.exit(1);
  }
  console.log(`✅ ESLint ratchet OK: ${JSON.stringify(sortedCounts(counts))}`);
}

if (process.argv[1]?.endsWith('eslint-ratchet.ts') || process.argv[1]?.endsWith('eslint-ratchet.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
