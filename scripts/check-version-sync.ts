import fs from 'fs';
import path from 'path';
import { SYSTEM_UPDATES } from '../src/data/changelogs/index.js';
import { v5Updates } from '../src/data/changelogs/5.js';

/**
 * TD-111 (v5.0.0) — گیت همگام‌سازی نسخه (fail-fast)
 * ====================================================
 * دو منبع حقیقت نسخه (AGENTS §23) باید همیشه دوبامپ همگام باشند:
 *   1) "version" در package.json (مرجع یگانه؛ خوانده‌شده توسط src/lib/version.ts و /health)
 *   2) مدخل نخست چنج‌لاگ فعال (SYSTEM_UPDATES[0].version در src/data/changelogs/5.ts)
 * واگرایی هرگز نباید به مرور کشف شود — این چک در CI (استیج lint-and-typecheck)
 * و قابل اجرا به‌صورت محلی با `npm run check:version` است.
 */

function fail(message: string): never {
  console.error('❌ Version Sync Check FAILED (TD-111):');
  console.error(`   ${message}`);
  console.error('   راه‌حل: هر دو منبع (package.json و مدخل نخست src/data/changelogs/5.ts) را با یک bump همگام کنید.');
  process.exit(1);
}

function main(): void {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  let pkgVersion = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkgVersion = String(pkg?.version || '').trim().replace(/^v/, '');
  } catch {
    fail('package.json خوانده نشد یا فیلد version ندارد.');
  }
  if (!pkgVersion) fail('فیلد "version" در package.json خالی است.');

  const topEntry = SYSTEM_UPDATES[0];
  if (!topEntry) fail('SYSTEM_UPDATES خالی است — چنج‌لاگ فعال (5.ts) مدخل ندارد.');
  const changelogVersion = String(topEntry.version || '').trim().replace(/^v/, '');
  if (!changelogVersion) fail('مدخل نخست SYSTEM_UPDATES فیلد version ندارد.');

  // 1) همگامی دو منبع
  if (pkgVersion !== changelogVersion) {
    fail(`واگرایی نسخه — package.json: «${pkgVersion}» در برابر SYSTEM_UPDATES[0]: «${changelogVersion}»`);
  }

  // 2) گارد نسخه تکراری در سری فعال (v5): هر نسخه نباید بیش از یک بار ثبت شده باشد
  const counts = new Map<string, number>();
  for (const u of v5Updates) {
    const v = String(u?.version || '').replace(/^v/, '');
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([v]) => v);
  if (duplicates.length > 0) {
    fail(`نسخه(های) تکراری در چنج‌لاگ: ${duplicates.join(', ')}`);
  }

  console.log(`✅ Version Sync OK (TD-111): package.json == SYSTEM_UPDATES[0] == v${pkgVersion}`);
  process.exit(0);
}

main();
