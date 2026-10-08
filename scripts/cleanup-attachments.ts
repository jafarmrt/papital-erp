import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { AttachmentOrphanCleanupService } from '../src/services/attachments/attachmentOrphanCleanup.service.js';

/**
 * v7.0.83 (TD-224): پاک‌سازی فایل‌های پیوست بدون ثبت (فایلی که تراکنش ذخیره‌اش برگشته و ردیف file_attachments ندارد).
 *   npm run attachments:cleanup             ← اجرای آزمایشی: فقط گزارش، بدون هیچ تغییری
 *   npm run attachments:cleanup -- --apply  ← پاک‌سازی واقعی
 * فایل پیوست‌های جداشده از رکورد پاک نمی‌شوند. در استقرار Docker همان کار با POST /api/attachments/cleanup-orphans
 * (مدیر سیستم، بدنه {"apply": true}) انجام می‌شود.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await AttachmentOrphanCleanupService.cleanupOrphanFiles({ apply, actor: 'cli:attachments-cleanup' });
  console.log(apply ? '✅ Attachment cleanup done' : '🔎 Dry run (no changes); for a real cleanup: npm run attachments:cleanup -- --apply');
  console.log(`   Files scanned: ${report.scannedFiles}`);
  console.log(`   Unregistered: ${report.unregistered.files} files (${(report.unregistered.bytes / 1024 / 1024).toFixed(2)} MB), removed: ${report.unregistered.removed}`);
  console.log(`   Unregistered and newer than ${report.minAgeMinutes} minutes (left alone): ${report.recentUnregistered}`);
  console.log(`   Detached from their record (kept): ${report.detached.files} files (${(report.detached.bytes / 1024 / 1024).toFixed(2)} MB)`);
  if (report.missingOnDisk > 0) console.log(`   ⚠️ Registered rows without a file on disk: ${report.missingOnDisk}`);
  if (report.failures.length > 0) {
    console.error(`❌ ${report.failures.length} files were not removed:`);
    for (const f of report.failures) console.error(`   - ${f.path}: ${f.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
