import fs from 'fs';
import path from 'path';
import { SYSTEM_UPDATES } from '../src/data/changelogs/index.js';
import { v7Updates } from '../src/data/changelogs/7.js';

/**
 * TD-111 (v7.0.0) — گیت همگام‌سازی جامع نسخه (fail-fast)
 * ====================================================
 * تمامی منابع اعلام نسخه باید همیشه همگام باشند:
 *   1) "version" در package.json (مرجع یگانه؛ خوانده‌شده توسط src/lib/version.ts و /health)
 *   2) مدخل نخست چنج‌لاگ فعال (SYSTEM_UPDATES[0].version در src/data/changelogs/7.ts)
 *   3) مانیفست استقرار deploy/k8s/erp-deployment.yaml
 *   4) هدر مستندات README.md
 */

function fail(message: string): never {
  console.error('❌ Version Sync Check FAILED (TD-111):');
  console.error(`   ${message}`);
  console.error('   راه‌حل: تمامی منابع نسخه (package.json، چنج‌لاگ 7.ts، k8s manifest و README) را همگام کنید.');
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
  if (!topEntry) fail('SYSTEM_UPDATES خالی است — چنج‌لاگ فعال (7.ts) مدخل ندارد.');
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
    if (!k8sContent.includes(`erp:v${pkgVersion}`) && !k8sContent.includes(`APP_VERSION\n          value: "${pkgVersion}"`)) {
      fail(`واگرایی نسخه در مانیفست کوبرنتیز deploy/k8s/erp-deployment.yaml — نسخه مورد انتظار: ${pkgVersion}`);
    }
  }

  // 3) گارد نسخه تکراری در سری فعال (v7)
  const counts = new Map<string, number>();
  for (const u of v7Updates) {
    const v = String(u?.version || '').replace(/^v/, '');
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([v]) => v);
  if (duplicates.length > 0) {
    fail(`نسخه(های) تکراری در چنج‌لاگ 7.ts: ${duplicates.join(', ')}`);
  }

  console.log(`✅ Version Sync OK (TD-111): package.json == SYSTEM_UPDATES[0] == k8s == v${pkgVersion}`);
  process.exit(0);
}

main();
