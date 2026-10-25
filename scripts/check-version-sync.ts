import fs from 'fs';
import path from 'path';
import { SYSTEM_UPDATES, ACTIVE_CHANGELOG, CLOSED_CHANGELOG_SERIES } from '../src/data/changelogs/index.js';
import { findCompactRuleViolations } from '../src/data/changelogs/compactRule.js';
import { findChangelogSeriesViolations } from '../src/data/changelogs/seriesGuard.js';
import { CLOSED_DEBT_FILE, FROZEN_DEBT_ARCHIVE, findDebtRegistryViolations, findMissingNpmScripts, npmScriptDocs } from './governance/releaseGuards.js';

/**
 * TD-111 (v7.0.0) — گیت همگام‌سازی جامع نسخه (fail-fast)
 * ====================================================
 * تمامی منابع اعلام نسخه باید همیشه همگام باشند:
 *   1) "version" در package.json (مرجع یگانه؛ خوانده‌شده توسط src/lib/version.ts و /health)
 *   2) مدخل نخست چنج‌لاگ فعال (SYSTEM_UPDATES[0].version در ACTIVE_CHANGELOG.file — از v11.0.0 فایل 11.ts)
 *   3) هدر مستندات README.md
 * v11.0.3: مانیفست k8s نمونهٔ پشتیبانی‌نشده است و دیگر جای نسخه نیست (تصمیم مالک محصول در بررسی حاکمیتی ۱.۲).
 * v8.0.0: نسخه در سری فعال است و سری‌های بسته‌شده منجمدند (از v11.0.0: 7.ts، 8.ts، 9.ts و 10.ts) (src/data/changelogs/seriesGuard.ts).
 */

function fail(message: string): never {
  console.error('❌ Version Sync Check FAILED (TD-111):');
  console.error(`   ${message}`);
  console.error(`   Fix: bring every version source in sync (package.json, the active changelog ${ACTIVE_CHANGELOG.file} and README).`);
  process.exit(1);
}

function main(): void {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  let pkgVersion = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkgVersion = String(pkg?.version || '').trim().replace(/^v/, '');
  } catch {
    fail('package.json could not be read or has no version field.');
  }
  if (!pkgVersion) fail('The "version" field in package.json is empty.');

  const topEntry = SYSTEM_UPDATES[0];
  if (!topEntry) fail(`SYSTEM_UPDATES is empty: the active changelog (${ACTIVE_CHANGELOG.file}) has no entry.`);
  const changelogVersion = String(topEntry.version || '').trim().replace(/^v/, '');
  if (!changelogVersion) fail('The first SYSTEM_UPDATES entry has no version field.');

  // 1) همگامی package.json و changelog
  if (pkgVersion !== changelogVersion) {
    fail(`Version mismatch: package.json "${pkgVersion}" vs SYSTEM_UPDATES[0] "${changelogVersion}"`);
  }



  // 2.1) بررسی هدر README.md (طبق کامنت بالای همین فایل)
  const readmePath = path.resolve(process.cwd(), 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    if (!readmeContent.includes(`نسخه مستقر: \`v${pkgVersion}\``)) {
      fail(`Version mismatch in the README.md header; expected: v${pkgVersion}`);
    }
  }

  // 3) v8.0.0: نسخه در سری فعال، مدخل‌های فایل فعال در همان سری و بدون تکرار، سری‌های بسته‌شده منجمد
  const seriesViolations = findChangelogSeriesViolations(pkgVersion, ACTIVE_CHANGELOG, CLOSED_CHANGELOG_SERIES);
  if (seriesViolations.length > 0) {
    fail(`The changelog series are inconsistent:\n   - ${seriesViolations.slice(0, 15).join('\n   - ')}`);
  }

  // 4) v7.0.54: قاعده چنج‌لاگ کوتاه سری فعال (فقط تغییرات مهم و باگ‌های مهم و بحرانی)
  const compactViolations = findCompactRuleViolations(ACTIVE_CHANGELOG.updates);
  if (compactViolations.length > 0) {
    fail(`The changelog ${ACTIVE_CHANGELOG.file} breaks the short entry rule (src/data/changelogs/compactRule.ts):\n   - ${compactViolations.slice(0, 15).join('\n   - ')}`);
  }

  // 5) v10.0.22 (TD-981): no debt row is both active and archived or listed twice (parallel merges brought them back)
  const debtViolations = findDebtRegistryViolations(
    fs.readFileSync(path.resolve(process.cwd(), 'TECH_DEBT.md'), 'utf-8'),
    [CLOSED_DEBT_FILE, FROZEN_DEBT_ARCHIVE].map(rel => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8')).join('\n')
  );
  if (debtViolations.length > 0) {
    fail(`The debt registry is inconsistent (archived rows win; remove them from TECH_DEBT.md):\n   - ${debtViolations.slice(0, 15).join('\n   - ')}`);
  }

  // 6) v10.0.24 (OT-A-03): every npm script the documents, CI and shell scripts name still exists (a merge once dropped one)
  const pkgScripts = (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }).scripts ?? {};
  const missingScripts = findMissingNpmScripts(npmScriptDocs(process.cwd()), pkgScripts);
  if (missingScripts.length > 0) {
    fail(`package.json lost npm scripts that are still in use (restore them):\n   - ${missingScripts.slice(0, 15).join('\n   - ')}`);
  }

  console.log(`✅ Version Sync OK (TD-111): package.json == SYSTEM_UPDATES[0] == README == v${pkgVersion}`);
  process.exit(0);
}

main();
