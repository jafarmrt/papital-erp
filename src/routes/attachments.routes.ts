import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { userHasRoleOrPermission, requireSystemAdmin } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError, NotFoundError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { errorMessageOf } from '../utils.js';
import { RECORD_READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { AttachmentStorageService, INLINE_SAFE_MIME_TYPES } from '../services/attachments/attachmentStorage.service.js';
import { AttachmentOrphanCleanupService, MIN_ORPHAN_AGE_MINUTES } from '../services/attachments/attachmentOrphanCleanup.service.js';

const MIN_ORPHAN_AGE_MINUTES_FA = '۵';

/**
 * v7.0.56 (audit P2-9): دریافت فایل پیوست فقط با نشست معتبر و مجوز خواندن رکورد مالک آن (RECORD_READ_PERMISSIONS).
 */
const router = Router();
router.use(authenticateToken);

const attachmentIdSchema = z.object({
  params: z.object({ id: z.string().uuid('شناسه پیوست نامعتبر است') })
});

const migrateInlineSchema = z.object({
  body: z.object({ apply: z.boolean().optional() }).optional().default({})
});

const cleanupOrphansSchema = z.object({
  body: z.object({
    apply: z.boolean().optional(),
    minAgeMinutes: z.number().int().min(MIN_ORPHAN_AGE_MINUTES, `کمترین عمر فایل یتیم ${MIN_ORPHAN_AGE_MINUTES_FA} دقیقه است`).max(525600).optional(),
  }).optional().default({})
});

/** Opens an attachment file for reading; a missing path or a directory is 404, any other open error 500 */
async function openAttachmentFile(absolutePath: string): Promise<{ handle: fs.promises.FileHandle; size: number }> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(absolutePath, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') throw new NotFoundError('فایل پیوست روی دیسک یافت نشد');
    logger.error(`[attachments] cannot open ${absolutePath}: ${errorMessageOf(err)}`);
    throw new AppError('فایل پیوست خوانده نشد؛ به مدیر سیستم خبر دهید', 500, 'ATTACHMENT_READ_FAILED');
  }
  const stat = await handle.stat().catch(() => null);
  if (!stat || !stat.isFile()) {
    await handle.close().catch(() => undefined);
    throw new NotFoundError('فایل پیوست روی دیسک یافت نشد');
  }
  return { handle, size: stat.size };
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

router.get('/attachments/:id', validate(attachmentIdSchema), asyncHandler(async (req, res) => {
  const row = await AttachmentStorageService.findActive(String(req.params.id));
  if (!row || !AttachmentStorageService.isAttachmentEntityType(row.entityType)) {
    throw new NotFoundError('پیوست یافت نشد');
  }
  const required = RECORD_READ_PERMISSIONS[row.entityType];
  if (required && !(await userHasRoleOrPermission(req.user, ...required))) {
    return res.status(403).json({ error: 'دسترسی غیرمجاز به این پیوست' });
  }

  // v9.0.254 (TD-627, finding B13-02): the file is opened before any header is sent, so a missing, unreadable or
  // non-file path answers an error instead of an uncaught stream error, which the process policy turns into a
  // shutdown; a read error after the response started only closes that response.
  const file = await openAttachmentFile(AttachmentStorageService.absolutePath(row.storagePath));

  const inline = INLINE_SAFE_MIME_TYPES.has(row.mimeType);
  res.setHeader('Content-Type', row.mimeType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.originalName || 'attachment'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (row.mimeType !== 'application/pdf') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
  const stream = file.handle.createReadStream();
  stream.on('error', (err) => {
    logger.warn(`[attachments] read of attachment ${row.id} failed after the response started: ${errorMessageOf(err)}`);
    res.destroy();
  });
  stream.pipe(res);
}));

// انتقال دستی پیوست‌های قدیمی داخل پایگاه‌داده به دیسک (پیش‌فرض آزمایشی؛ همان `npm run attachments:migrate`)
router.post('/attachments/migrate-inline', requireSystemAdmin, validate(migrateInlineSchema), asyncHandler(async (req, res) => {
  const report = await AttachmentStorageService.migrateInlineAttachments({
    apply: req.body?.apply === true,
    actor: req.user?.username ?? '',
  });
  res.json(report);
}));

// v7.0.83 (TD-224): پاک‌سازی دستی فایل‌های پیوست بدون ثبت (پیش‌فرض آزمایشی؛ همان `npm run attachments:cleanup`)
router.post('/attachments/cleanup-orphans', requireSystemAdmin, validate(cleanupOrphansSchema), asyncHandler(async (req, res) => {
  const report = await AttachmentOrphanCleanupService.cleanupOrphanFiles({
    apply: req.body?.apply === true,
    actor: req.user?.username ?? '',
    minAgeMinutes: req.body?.minAgeMinutes,
  });
  res.json(report);
}));

export default router;
