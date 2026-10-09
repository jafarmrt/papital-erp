import 'dotenv/config';
import { pool } from '../src/db/drizzle.js';
import { AttachmentStorageService } from '../src/services/attachments/attachmentStorage.service.js';
import { terminalLine } from '../src/lib/terminalText.js';

/**
 * v7.0.56 (audit P2-9): انتقال پیوست‌های قدیمی (Base64 داخل پایگاه‌داده) به دیسک.
 *   npm run attachments:migrate             ← اجرای آزمایشی: فقط شمارش، بدون هیچ تغییری
 *   npm run attachments:migrate -- --apply  ← انتقال واقعی
 * پیش از اجرا سرور نسخه جدید یک‌بار راه‌اندازی شده باشد (مهاجرت 0023). در استقرار Docker همان کار با
 * POST /api/attachments/migrate-inline (مدیر سیستم، بدنه {"apply": true}) انجام می‌شود.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await AttachmentStorageService.migrateInlineAttachments({ apply, actor: 'cli:attachments-migrate' });
  console.log(apply ? '✅ Attachment migration done' : '🔎 Dry run (no changes); for a real migration: npm run attachments:migrate -- --apply');
  console.log(`   Records: ${report.records}   files: ${report.files}   size: ${(report.bytes / 1024 / 1024).toFixed(2)} MB`);
  for (const [entity, b] of Object.entries(report.byEntity)) {
    if (b.files > 0) console.log(`   - ${entity}: ${b.records} records, ${b.files} files`);
  }
  if (report.failures.length > 0) {
    console.error(`❌ ${report.failures.length} records were not migrated (left unchanged):`);
    for (const f of report.failures) console.error(terminalLine(`   - ${f.entityType} #${f.entityId}: ${f.error}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(terminalLine(`❌ ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
