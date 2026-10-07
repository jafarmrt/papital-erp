import fs from 'fs';
import path from 'path';
import { orm } from '../../db/drizzle.js';
import { fileAttachments } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { getAttachmentsRoot } from './attachmentStorage.service.js';

/**
 * v7.0.83 (TD-224): پاک‌سازی فایل‌های پیوست بدون ثبت.
 *
 * فایل پیوست پیش از پایان تراکنش ذخیره رکورد روی دیسک نوشته می‌شود (AttachmentStorageService.storeFile)؛ اگر تراکنش
 * برگردد، فایل بدون ردیف file_attachments می‌ماند و از هیچ مسیری دریافت نمی‌شود. این دستور فقط همین فایل‌ها را پاک
 * می‌کند: نامشان به شکل <uuid>.<پسوند> داخل پوشه یک نوع رکورد است، هیچ ردیفی (فعال یا جداشده) به آن‌ها اشاره نمی‌کند
 * و از آخرین تغییرشان دست‌کم minAgeMinutes گذشته است (فایل تراکنشی که هنوز در جریان است پاک نشود).
 * فایل پیوست‌هایی که کاربر از رکورد جدا کرده (ردیف با is_deleted = 1) نگه داشته و فقط شمرده می‌شوند.
 * اجرا دستی است (`npm run attachments:cleanup` یا POST /api/attachments/cleanup-orphans)، پیش‌فرض آزمایشی، با قفل مشورتی.
 */

export const DEFAULT_ORPHAN_MIN_AGE_MINUTES = 60;
/**
 * v9.0.257 (TD-643, finding B13-18): the youngest file a cleanup may remove; a smaller age (0 included) is raised to
 * this floor, so a file of a save transaction still in progress is never taken for an orphan.
 */
export const MIN_ORPHAN_AGE_MINUTES = 5;
const STORED_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/i;
const MAX_LISTED_PATHS = 200;

export interface OrphanAttachmentCleanupReport {
  dryRun: boolean;
  minAgeMinutes: number;
  scannedFiles: number;
  /** فایل‌های بدون هیچ ردیف ثبت (قدیمی‌تر از minAgeMinutes) */
  unregistered: { files: number; bytes: number; removed: number; paths: string[] };
  /** فایل‌های بدون ثبت تازه‌تر از minAgeMinutes که دست نخوردند */
  recentUnregistered: number;
  /** فایل پیوست‌های جداشده از رکورد (نگه داشته می‌شوند) */
  detached: { files: number; bytes: number };
  /** ردیف‌های فعال که فایلشان روی دیسک نیست */
  missingOnDisk: number;
  failures: Array<{ path: string; error: string }>;
}

interface DiskFile { storagePath: string; absolute: string; size: number; mtimeMs: number; }

async function listStoredFiles(root: string): Promise<DiskFile[]> {
  const files: DiskFile[] = [];
  const entityDirs = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of entityDirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    for (const entry of await fs.promises.readdir(dirPath, { withFileTypes: true })) {
      if (!entry.isFile() || !STORED_FILE_PATTERN.test(entry.name)) continue;
      const absolute = path.join(dirPath, entry.name);
      const stat = await fs.promises.stat(absolute);
      files.push({ storagePath: `${dir.name}/${entry.name}`, absolute, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

export class AttachmentOrphanCleanupService {
  static async cleanupOrphanFiles(options: {
    apply: boolean;
    actor: string;
    minAgeMinutes?: number;
  }): Promise<OrphanAttachmentCleanupReport> {
    const minAgeMinutes = Math.max(MIN_ORPHAN_AGE_MINUTES, options.minAgeMinutes ?? DEFAULT_ORPHAN_MIN_AGE_MINUTES);
    const report: OrphanAttachmentCleanupReport = {
      dryRun: !options.apply, minAgeMinutes, scannedFiles: 0,
      unregistered: { files: 0, bytes: 0, removed: 0, paths: [] },
      recentUnregistered: 0, detached: { files: 0, bytes: 0 }, missingOnDisk: 0, failures: [],
    };

    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.ATTACHMENT_ORPHAN_CLEANUP, async () => {
      const root = getAttachmentsRoot();
      const diskFiles = await listStoredFiles(root);
      report.scannedFiles = diskFiles.length;
      // ردیف‌ها پس از فهرست دیسک خوانده می‌شوند تا فایلی که در این فاصله ثبت شده بدون ثبت شمرده نشود
      const rows = await orm.select({ storagePath: fileAttachments.storagePath, isDeleted: fileAttachments.isDeleted }).from(fileAttachments);
      const registered = new Map<string, number>();
      for (const r of rows) {
        // ردیف فعال بر ردیف جداشده با همان مسیر مقدم است
        registered.set(r.storagePath, Math.min(registered.get(r.storagePath) ?? 1, r.isDeleted));
      }
      const onDisk = new Set(diskFiles.map((f) => f.storagePath));
      for (const [storagePath, isDeleted] of registered) {
        if (isDeleted === 0 && !onDisk.has(storagePath)) report.missingOnDisk += 1;
      }

      const cutoff = Date.now() - minAgeMinutes * 60 * 1000;
      for (const f of diskFiles) {
        const state = registered.get(f.storagePath);
        if (state === 0) continue;
        if (state === 1) {
          report.detached.files += 1;
          report.detached.bytes += f.size;
          continue;
        }
        if (f.mtimeMs > cutoff) {
          report.recentUnregistered += 1;
          continue;
        }
        report.unregistered.files += 1;
        report.unregistered.bytes += f.size;
        if (report.unregistered.paths.length < MAX_LISTED_PATHS) report.unregistered.paths.push(f.storagePath);
        if (options.apply) {
          try {
            await fs.promises.unlink(f.absolute);
            report.unregistered.removed += 1;
          } catch (err: unknown) {
            report.failures.push({ path: f.storagePath, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    });

    if (!outcome.acquired) {
      throw new ConflictError('پاک‌سازی پیوست‌ها هم‌اکنون در حال اجراست', 'ATTACHMENT_CLEANUP_RUNNING');
    }

    if (options.apply && report.unregistered.removed > 0) {
      await logActivity({
        username: options.actor,
        action: 'DELETE',
        entity: 'سیستم:پیوست‌ها',
        description: `پاک‌سازی ${report.unregistered.removed} فایل پیوست بدون ثبت (${report.failures.length} خطا)`,
        details: { paths: report.unregistered.paths, bytes: report.unregistered.bytes, failures: report.failures },
      });
    }
    logger.info(`[Attachments] orphan cleanup ${options.apply ? 'applied' : 'dry run'}: ${report.unregistered.files} unregistered (${report.unregistered.removed} removed), ${report.recentUnregistered} recent, ${report.detached.files} detached kept, ${report.missingOnDisk} missing on disk`);
    return report;
  }
}
