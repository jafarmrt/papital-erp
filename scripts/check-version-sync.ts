import fs from 'fs';
import path from 'path';
import { SYSTEM_UPDATES, ACTIVE_CHANGELOG, CLOSED_CHANGELOG_SERIES } from '../src/data/changelogs/index.js';
import { findCompactRuleViolations } from '../src/data/changelogs/compactRule.js';
import { findChangelogSeriesViolations } from '../src/data/changelogs/seriesGuard.js';

/**
 * TD-111 (v7.0.0) — گیت همگام‌سازی جامع نسخه (fail-fast)
 * ====================================================
 * تمامی منابع اعلام نسخه باید همیشه همگام باشند:
 *   1) "version" در package.json (مرجع یگانه؛ خوانده‌شده توسط src/lib/version.ts و /health)
 *   2) مدخل نخست چنج‌لاگ فعال (SYSTEM_UPDATES[0].version در ACTIVE_CHANGELOG.file — از v9.0.0 فایل 9.ts)
 *   3) مانیفست استقرار deploy/k8s/erp-deployment.yaml
 *   4) هدر مستندات README.md
 * v8.0.0: نسخه در سری فعال است و سری‌های بسته‌شده منجمدند (از v9.0.0: 7.ts و 8.ts) (src/data/changelogs/seriesGuard.ts).
 */

function fail(message: string): never {
  console.error('❌ Version Sync Check FAILED (TD-111):');
  console.error(`   ${message}`);
  console.error(`   راه‌حل: تمامی منابع نسخه (package.json، چنج‌لاگ فعال ${ACTIVE_CHANGELOG.file}، k8s manifest و README) را همگام کنید.`);
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
  if (!topEntry) fail(`SYSTEM_UPDATES خالی است — چنج‌لاگ فعال (${ACTIVE_CHANGELOG.file}) مدخل ندارد.`);
  const changelogVersion = String(topEntry.version || '').trim().replace(/^v/, '');
  if (!changelogVersion) fail('مدخل نخست SYSTEM_UPDATES فیلد version ندارد.');

  // 1) همگامی package.json و changelog
  if (pkgVersion !== changelogVersion) {
    fail(`واگرایی نسخه — package.json: «${pkgVersion}» در برابر SYSTEM_UPDATES[0]: «${changelogVersion}»`);
  }

  // 2) بررسی مانیفست K8s
  const k8sPath = path.resolve(process.cwd(), 'deploy/k8s/erp-deployment.yaml');
  if (fs.existsSync(k8sPath)) {
    const k8sContent = fs.readFileSync(k8sPath, 'utf-8');
    // v7.0.18: هر دو مقدار الزامی است — APP_VERSION در src/lib/version.ts بر package.json اولویت دارد
    // و مقدار کهنه آن باعث گزارش نسخه اشتباه در /health می‌شد (قبلاً شرط OR بود).
    const appVersionMatch = k8sContent.match(/name:\s*APP_VERSION\s*\n\s*value:\s*"([^"]+)"/);
    if (!k8sContent.includes(`erp:v${pkgVersion}`)) {
      fail(`واگرایی تگ ایمیج در مانیفست کوبرنتیز deploy/k8s/erp-deployment.yaml — نسخه مورد انتظار: erp:v${pkgVersion}`);
    }
    if (appVersionMatch && appVersionMatch[1] !== pkgVersion) {
      fail(`واگرایی APP_VERSION در مانیفست کوبرنتیز — مقدار فعلی «${appVersionMatch[1]}»، مورد انتظار «${pkgVersion}»`);
    }
  }

  // 2.1) بررسی هدر README.md (طبق کامنت بالای همین فایل)
  const readmePath = path.resolve(process.cwd(), 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    if (!readmeContent.includes(`نسخه مستقر: \`v${pkgVersion}\``)) {
      fail(`واگرایی نسخه در هدر README.md — نسخه مورد انتظار: v${pkgVersion}`);
    }
  }

  // 3) v8.0.0: نسخه در سری فعال، مدخل‌های فایل فعال در همان سری و بدون تکرار، سری‌های بسته‌شده منجمد
  const seriesViolations = findChangelogSeriesViolations(pkgVersion, ACTIVE_CHANGELOG, CLOSED_CHANGELOG_SERIES);
  if (seriesViolations.length > 0) {
    fail(`سری‌های چنج‌لاگ ناسازگارند:\n   - ${seriesViolations.slice(0, 15).join('\n   - ')}`);
  }

  // 4) v7.0.54: قاعده چنج‌لاگ کوتاه سری فعال (فقط تغییرات مهم و باگ‌های مهم و بحرانی)
  const compactViolations = findCompactRuleViolations(ACTIVE_CHANGELOG.updates);
  if (compactViolations.length > 0) {
    fail(`چنج‌لاگ ${ACTIVE_CHANGELOG.file} از قاعده مدخل کوتاه (src/data/changelogs/compactRule.ts) پیروی نمی‌کند:\n   - ${compactViolations.slice(0, 15).join('\n   - ')}`);
  }

  console.log(`✅ Version Sync OK (TD-111): package.json == SYSTEM_UPDATES[0] == k8s (image + APP_VERSION) == README == v${pkgVersion}`);
  process.exit(0);
}

main();
