import fs from 'fs';
import { orm } from '../../db/drizzle.js';
import { and, eq, ne } from 'drizzle-orm';
import { fileAttachments, mediaAssets, mediaSections } from '../../db/schema.js';
import { FACTORY_RESET_WIPE_ORDER, MEDIA_SYSTEM_SECTION_KIND } from './factoryResetTables.js';
import { extensionOfType, mediaFilePath } from '../../lib/media/mediaPaths.js';
import { logger } from '../../middleware/logger.js';
import { invalidateUserAuthCache } from '../../middleware/auth.js';
import { ConflictError, ForbiddenError } from '../../errors/customErrors.js';
import { runSeed } from '../../db/seed.js';
import { seedDefaultEngines } from './bootData.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { logActivity } from '../../lib/auditLogger.js';
import { invalidateRoleCache, invalidateSettingsCache } from '../../lib/memoryCache.js';
import { invalidateTimezoneCache } from '../../lib/businessClock.js';
import { AttachmentStorageService } from '../attachments/attachmentStorage.service.js';
import { errorMessageOf } from '../../utils.js';

/**
 * بازنشانی کامل سامانه به وضعیت راه‌اندازی اولیه (POST /admin/clear-data).
 * همه داده‌های عملیاتی و حساب‌های کاربری در یک تراکنش حذف و سپس پیش‌فرض‌های استاندارد دوباره seed می‌شوند.
 * P0-01 (ARCH-01): در پروداکشن یا بدون ALLOW_DANGEROUS_DATA_PURGE=true همیشه مسدود است؛
 * این نگهبان پیش از هر حذف در خود سرویس اجرا می‌شود.
 *
 * TD-245 (تصمیم مالک محصول «همه پاک شود»): سال‌های مالی بسته (fiscal_periods)، ثبت پیوست‌ها و فایل‌های آن‌ها روی
 * دیسک، گزارش‌های اصلاح داده (legacy_date_repairs، ref_fiscal_year_corrections، workflow_task_reopen_log) و جداولی که
 * پیش‌تر فقط با cascade پاک می‌شدند هم صریحاً پاک می‌شوند. کل عملیات زیر قفل مشورتی seed (89345) اجرا می‌شود تا هیچ
 * seed همزمانی با پاک‌سازی تداخل نکند؛ فایل‌ها فقط پس از commit تراکنش حذف می‌شوند و یک ردیف ممیزی در همان تراکنش
 * (پس از پاک شدن activity_logs) می‌ماند.
 */

export interface FactoryResetActor {
  username?: string;
  ip: string;
}

export interface FactoryResetReport {
  /** تعداد ردیف‌های حذف‌شده هر جدول (به ترتیب حذف) */
  deletedRows: Record<string, number>;
  attachmentFiles: { total: number; removed: number; missing: number; failed: number };
  /** v10.1.45 (OBS-R1-12): media library files (each with its light version and thumbnail) */
  mediaFiles: { total: number; removed: number; missing: number; failed: number };
}

interface RemovedMediaFile {
  sha256: string;
  mimeType: string;
}

export const FACTORY_RESET_AUDIT_ENTITY = 'سیستم:بازنشانی کامل';

/** v10.1.45 (OBS-R1-11): the error answered after the wipe committed but the base data seed failed */
export const FACTORY_RESET_SEED_INCOMPLETE = 'FACTORY_RESET_SEED_INCOMPLETE';

const SEED_INCOMPLETE_MESSAGE = 'داده‌ها پاک شد، ولی بخشی از داده پایه ساخته نشد. سامانه را دوباره راه‌اندازی کنید تا دوباره ساخته شود.';

export function isFactoryResetCommittedError(err: unknown): boolean {
  return err instanceof ConflictError && err.code === FACTORY_RESET_SEED_INCOMPLETE;
}

interface AttachmentFileRemoval {
  removed: number;
  missing: number;
  failed: number;
}

export class FactoryResetService {
  /** P0-01 (ARCH-01): محافظت قطعی در برابر حذف فیزیکی دیتابیس در محیط پروداکشن */
  static assertAllowed(actor: FactoryResetActor): void {
    const isProd = process.env.NODE_ENV === 'production';
    const allowDangerousPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE === 'true';

    if (isProd || !allowDangerousPurge) {
      logger.error({
        message: 'Blocked unauthorized attempt to wipe all ERP operational data via /admin/clear-data',
        user: actor.username,
        nodeEnv: process.env.NODE_ENV,
        allowDangerousPurge,
        ip: actor.ip
      });
      throw new ForbiddenError(
        'عملیات حذف کل داده‌های سامانه در محیط پروداکشن یا بدون فعال‌سازی صریح متغیر ALLOW_DANGEROUS_DATA_PURGE اکیداً مسدود است (مطابق قانون بنیادین RULE 09).'
      );
    }
  }

  /**
   * Wipe & reset all system operational data and users to trigger the initial setup scenario,
   * then re-seed system standard defaults. The guard runs again here so no caller can skip it;
   * the caller logs and rethrows failures.
   */
  static async wipeAndReseed(actor: FactoryResetActor): Promise<FactoryResetReport> {
    this.assertAllowed(actor);

    logger.warn({
      message: 'Authorized /admin/clear-data execution started in non-production environment',
      user: actor.username,
      ip: actor.ip
    });

    // قفل seed پیش از پاک‌سازی گرفته و تا پایان seed دوباره نگه داشته می‌شود؛ اگر seed دیگری در جریان باشد هیچ چیز پاک نمی‌شود
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.SEED, async (): Promise<FactoryResetReport> => {
      const { deletedRows, attachmentPaths, mediaFiles } = await this.wipeAllData(actor);
      // v10.1.66: the wipe is committed now, so any later failure is reported as such and the route ends the session
      try {
        return await this.afterWipe(deletedRows, attachmentPaths, mediaFiles);
      } catch (err) {
        if (isFactoryResetCommittedError(err)) throw err;
        logger.error(`Factory reset: a step after the committed wipe failed: ${errorMessageOf(err)}`);
        throw new ConflictError(SEED_INCOMPLETE_MESSAGE, { failedStep: 'after-wipe' }, FACTORY_RESET_SEED_INCOMPLETE);
      }
    });

    if (!outcome.acquired) {
      throw new ConflictError(
        'راه‌اندازی داده‌های پایه (seed) هم‌اکنون در حال اجراست؛ پاک کردن داده‌ها انجام نشد. چند لحظه دیگر دوباره تلاش کنید.',
        undefined, 'SEED_RUNNING'
      );
    }
    return this.reportDone(actor, outcome.result);
  }

  /** The steps after the committed wipe: files, caches and the base data again */
  private static async afterWipe(
    deletedRows: Record<string, number>, attachmentPaths: string[], mediaFiles: RemovedMediaFile[],
  ): Promise<FactoryResetReport> {
    // فایل‌ها فقط پس از commit: اگر تراکنش برگردد ردیف‌ها و فایل‌ها هر دو می‌مانند
    const files = await this.removeAttachmentFiles(attachmentPaths);
    const media = await this.removeMediaFiles(mediaFiles);
    this.invalidateCaches();

    // Re-seed the base data (categories, settings, chart of accounts, task categories, piecework tasks; roles are kept,
    // TD-245) and, as at boot, the default workflows, event rules and webhook subscriptions this reset wiped
    // (v9.0.390, TD-620: before, they stayed missing until the next restart)
    // v10.0.180 (TD-959): a base data section that failed is reported, never silently left missing
    const seed = await runSeed();
    if (!seed.success) {
      logger.error(`Factory reset: ${seed.message}`);
      throw new ConflictError(SEED_INCOMPLETE_MESSAGE, { failedSections: seed.failedSections }, FACTORY_RESET_SEED_INCOMPLETE);
    }
    await seedDefaultEngines();
    this.invalidateCaches();

    return { deletedRows, attachmentFiles: { total: attachmentPaths.length, ...files }, mediaFiles: { total: mediaFiles.length, ...media } };
  }

  private static reportDone(actor: FactoryResetActor, report: FactoryResetReport): FactoryResetReport {
    logger.warn({
      message: 'Factory reset completed',
      user: actor.username,
      ip: actor.ip,
      attachmentFiles: report.attachmentFiles
    });
    return report;
  }

  /** همه حذف‌ها در یک تراکنش و به ترتیب کلیدهای خارجی؛ مسیر فایل پیوست‌های حذف‌شده برای حذف پس از commit برمی‌گردد */
  private static async wipeAllData(actor: FactoryResetActor): Promise<{ deletedRows: Record<string, number>; attachmentPaths: string[]; mediaFiles: RemovedMediaFile[] }> {
    return orm.transaction(async (tx) => {
      const deletedRows: Record<string, number> = {};
      let removedAttachments: Array<{ storagePath: string; lightStoragePath: string | null }> = [];
      let removedMedia: Array<{ sha256: string; mimeType: string }> = [];

      // v10.1.45 (OBS-R1-12): one ordered list (factoryResetTables.ts), checked against the schema by Vitest
      for (const { name, table } of FACTORY_RESET_WIPE_ORDER) {
        if (table === fileAttachments) {
          // v10.2 package 7: an image attachment of a sales file or activity also has its light WEBP on disk
          removedAttachments = await tx.delete(fileAttachments)
            .returning({ storagePath: fileAttachments.storagePath, lightStoragePath: fileAttachments.lightStoragePath });
          deletedRows[name] = removedAttachments.length;
        } else if (table === mediaAssets) {
          removedMedia = await tx.delete(mediaAssets).returning({ sha256: mediaAssets.sha256, mimeType: mediaAssets.mimeType });
          deletedRows[name] = removedMedia.length;
        } else if (table === mediaSections) {
          // the system section «محصولات» is made only by migration 0096, so it stays (empty)
          const result = await tx.delete(mediaSections).where(ne(mediaSections.kind, MEDIA_SYSTEM_SECTION_KIND));
          await tx.update(mediaSections).set({ isDeleted: 0 })
            .where(and(eq(mediaSections.kind, MEDIA_SYSTEM_SECTION_KIND), eq(mediaSections.isDeleted, 1)));
          deletedRows[name] = Number(result.rowCount ?? 0);
        } else {
          const result = await tx.delete(table);
          deletedRows[name] = Number(result.rowCount ?? 0);
        }
      }
      const attachmentPaths = Array.from(new Set(removedAttachments.flatMap((row) => (row.lightStoragePath ? [row.storagePath, row.lightStoragePath] : [row.storagePath]))));
      const mediaFiles = Array.from(new Map(removedMedia.map((row) => [row.sha256, row])).values());

      // ممیزی در همان تراکنش و پس از پاک شدن activity_logs: بدون ردیف ممیزی هیچ پاک‌سازی‌ای commit نمی‌شود.
      // کاربر اجراکننده هم حذف شده است، پس فقط نام کاربری و IP ثبت می‌شود (نه user_id).
      await logActivity({
        tx,
        strict: true,
        username: actor.username,
        ipAddress: actor.ip,
        action: 'PURGE',
        entity: FACTORY_RESET_AUDIT_ENTITY,
        description: `بازنشانی کامل سامانه (پاک کردن همه داده‌ها و کاربران، ${attachmentPaths.length} فایل پیوست برای حذف از دیسک) و راه‌اندازی دوباره داده‌های پایه`,
        details: { deletedRows, attachmentFiles: attachmentPaths.length },
      });

      return { deletedRows, attachmentPaths, mediaFiles };
    });
  }

  /**
   * حذف فایل پیوست‌های ثبت‌شده‌ای که ردیفشان در تراکنش بازنشانی پاک شد. فقط مسیرهای ثبت‌شده در file_attachments و
   * فقط داخل ریشه انبار پیوست‌ها (AttachmentStorageService.absolutePath مسیر بیرون از ریشه را رد می‌کند).
   * خطای حذف یک فایل فقط ثبت می‌شود و بازنشانی را متوقف نمی‌کند.
   */
  private static async removeAttachmentFiles(storagePaths: string[]): Promise<AttachmentFileRemoval> {
    const result: AttachmentFileRemoval = { removed: 0, missing: 0, failed: 0 };
    for (const storagePath of storagePaths) {
      try {
        await fs.promises.unlink(AttachmentStorageService.absolutePath(storagePath));
        result.removed += 1;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          result.missing += 1;
          continue;
        }
        result.failed += 1;
        logger.error({
          message: 'Factory reset: failed to remove attachment file after commit',
          storagePath,
          error: errorMessageOf(err)
        });
      }
    }
    return result;
  }

  /**
   * v10.1.45 (OBS-R1-12): media library files of the wiped rows, removed only after commit. A file is named by its
   * content and every row holding it was wiped, so its original, light version and thumbnail all go; a missing
   * variant (a video has no light version) is counted as missing, a failure only logged.
   */
  private static async removeMediaFiles(files: RemovedMediaFile[]): Promise<AttachmentFileRemoval> {
    const result: AttachmentFileRemoval = { removed: 0, missing: 0, failed: 0 };
    for (const file of files) {
      let ext: string;
      try {
        ext = extensionOfType(file.mimeType);
      } catch {
        result.failed += 1;
        continue;
      }
      let removedAny = false;
      let failed = false;
      for (const variant of ['original', 'light', 'thumb'] as const) {
        try {
          await fs.promises.unlink(mediaFilePath(file.sha256, variant, ext));
          removedAny = true;
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
          failed = true;
          logger.error({ message: 'Factory reset: failed to remove media file after commit', sha256: file.sha256, variant, error: errorMessageOf(err) });
        }
      }
      if (failed) result.failed += 1;
      else if (removedAny) result.removed += 1;
      else result.missing += 1;
    }
    return result;
  }

  /** کش‌های درون‌حافظه‌ای کاربران، نقش‌ها و تنظیمات به داده پاک‌شده اشاره نکنند */
  private static invalidateCaches(): void {
    invalidateUserAuthCache();
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateTimezoneCache();
  }
}
