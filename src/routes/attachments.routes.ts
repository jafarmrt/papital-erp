import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, userHasRoleOrPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError } from '../errors/customErrors.js';
import { RECORD_READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { AttachmentStorageService, INLINE_SAFE_MIME_TYPES } from '../services/attachments/attachmentStorage.service.js';

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

  const absolutePath = AttachmentStorageService.absolutePath(row.storagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new NotFoundError('فایل پیوست روی دیسک یافت نشد');
  }

  const inline = INLINE_SAFE_MIME_TYPES.has(row.mimeType);
  res.setHeader('Content-Type', row.mimeType);
  res.setHeader('Content-Length', String(row.sizeBytes));
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.originalName || 'attachment'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (row.mimeType !== 'application/pdf') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
  fs.createReadStream(absolutePath).pipe(res);
}));

// انتقال دستی پیوست‌های قدیمی داخل پایگاه‌داده به دیسک (پیش‌فرض آزمایشی؛ همان `npm run attachments:migrate`)
router.post('/attachments/migrate-inline', authorize('admin'), validate(migrateInlineSchema), asyncHandler(async (req, res) => {
  const report = await AttachmentStorageService.migrateInlineAttachments({
    apply: req.body?.apply === true,
    actor: req.user?.username || 'admin',
  });
  res.json(report);
}));

export default router;
