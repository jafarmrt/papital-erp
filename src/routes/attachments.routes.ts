import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, userHasRoleOrPermission, requireSystemAdmin } from '../middleware/authorize.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError, ForbiddenError, NotFoundError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { errorMessageOf } from '../utils.js';
import { RECORD_READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { AttachmentStorageService, INLINE_SAFE_MIME_TYPES } from '../services/attachments/attachmentStorage.service.js';
import { AttachmentOrphanCleanupService, MIN_ORPHAN_AGE_MINUTES } from '../services/attachments/attachmentOrphanCleanup.service.js';
import { addRecordAttachment, recordAttachmentDocumentKind, recordAttachments, removeRecordAttachment } from '../services/attachments/recordAttachments.service.js';
import { RECORD_ATTACHMENT_ENTITIES, type RecordAttachmentEntity } from '../lib/attachments/recordAttachments.js';
import { PRODUCTION_RECEIPT_PERMISSION, documentTypeRecordPermission, type DocumentRecordStatus } from '../lib/permissions/documentPermissions.js';
import type { AuthUserPayload } from '../types/auth.types.js';

const MIN_ORPHAN_AGE_MINUTES_FA = '۵';

/**
 * v7.0.56 (audit P2-9): دریافت فایل پیوست فقط با نشست معتبر و مجوز خواندن رکورد مالک آن (RECORD_READ_PERMISSIONS).
 */
const router = Router();
router.use(authenticateToken);

const attachmentIdSchema = z.object({
  params: z.object({ id: z.string().uuid('شناسه پیوست نامعتبر است') }),
  // v10.2 package 7: `light` serves the light WEBP of an image attachment of a sales file or activity, else the original
  // other query keys (a cache buster such as `?v=`) are dropped, never refused
  query: z.object({ variant: z.enum(['light']).optional() }),
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
    throw new AppError('فایل پیوست خوانده نشد؛ به مدیر سامانه خبر دهید', 500, 'ATTACHMENT_READ_FAILED');
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
    throw new ForbiddenError('دسترسی غیرمجاز به این پیوست', undefined, 'ATTACHMENT_FORBIDDEN');
  }
  if (!(await AttachmentStorageService.ownerIsLive(row))) throw new NotFoundError('پیوست یافت نشد');

  // v9.0.254 (TD-627, finding B13-02): the file is opened before any header is sent, so a missing, unreadable or
  // non-file path answers an error instead of an uncaught stream error, which the process policy turns into a
  // shutdown; a read error after the response started only closes that response.
  const light = req.query.variant === 'light' && row.lightStoragePath ? row.lightStoragePath : null;
  const file = await openAttachmentFile(AttachmentStorageService.absolutePath(light ?? row.storagePath));

  const mimeType = light ? 'image/webp' : row.mimeType;
  const name = AttachmentStorageService.downloadName(row.originalName || 'attachment', mimeType);
  const inline = INLINE_SAFE_MIME_TYPES.has(mimeType);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // v11 phase 6.2 (X11): only the app's own pages load a record's file; the rest of the app stays `cross-origin`
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (mimeType !== 'application/pdf') {
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

/**
 * v11 «افزودن پیوست» (owner's decision 7 Aban 1405): the files of a recorded document, treasury row, cheque or voucher,
 * one at a time outside the record's form. Reading needs what opens the record (as for its files); a change needs a key
 * that writes that kind of record too: a voucher `accounting.vouchers`, a treasury row `accounting.treasury`, a cheque the
 * cheque book or treasury, a document editing documents or a key that records a document (a file changes no amount or
 * line). The rule (add and remove before approval, only add after, nothing in a closed year) is the service's.
 */
const RECORD_ATTACHMENT_WRITERS: Record<RecordAttachmentEntity, readonly string[]> = {
  journal_voucher: ['accounting.vouchers'],
  treasury_transaction: ['accounting.treasury'],
  cheque: ['accounting.cheques', 'accounting.treasury'],
  document: ['documents.edit', 'documents.create', 'documents.finalize', 'warehouse.in', 'warehouse.out', PRODUCTION_RECEIPT_PERMISSION],
};
const ALL_RECORD_ATTACHMENT_READERS = [...new Set(RECORD_ATTACHMENT_ENTITIES.flatMap(e => [...RECORD_READ_PERMISSIONS[e]]))];
const ALL_RECORD_ATTACHMENT_WRITERS = [...new Set(RECORD_ATTACHMENT_ENTITIES.flatMap(e => [...RECORD_ATTACHMENT_WRITERS[e]]))];

const recordParams = {
  entityType: z.enum(RECORD_ATTACHMENT_ENTITIES),
  id: z.coerce.number().int().positive().max(2147483647),
};
const recordAttachmentsSchema = z.object({ params: z.object(recordParams) });
const recordAttachmentAddSchema = z.object({
  params: z.object(recordParams),
  body: z.object({
    name: z.string().trim().min(1).max(255),
    dataUrl: z.string().startsWith('data:').max(14 * 1024 * 1024),
  }).strict(),
});
const recordAttachmentRemoveSchema = z.object({
  params: z.object({ ...recordParams, attachmentId: z.string().min(1).max(64) }),
});

/**
 * A document's files change with «ویرایش اسناد» or the key that records that type of document in its status (a receipt
 * clerk does not change a sales invoice's files); a missing document is the service's 404.
 */
async function documentWriters(id: number): Promise<readonly string[]> {
  const kind = await recordAttachmentDocumentKind(id);
  if (!kind) return RECORD_ATTACHMENT_WRITERS.document;
  const status = (['draft', 'proforma', 'final'].includes(kind.status) ? kind.status : 'final') as DocumentRecordStatus;
  return ['documents.edit', documentTypeRecordPermission(kind.type, status)];
}

async function assertRecordAttachmentAccess(user: AuthUserPayload | undefined, entity: RecordAttachmentEntity, write: boolean, id?: number): Promise<void> {
  const reads = await userHasRoleOrPermission(user, ...RECORD_READ_PERMISSIONS[entity]);
  const writers = write && entity === 'document' && id ? await documentWriters(id) : RECORD_ATTACHMENT_WRITERS[entity];
  if (!reads || (write && !(await can(user, ...writers)))) {
    throw new ForbiddenError(write ? 'افزودن یا برداشتن پیوست این سند مجوز ثبت همین نوع سند را می‌خواهد.' : 'دسترسی به پیوست‌های این سند مجاز نیست.', undefined, 'RECORD_ATTACHMENT_FORBIDDEN');
  }
}

const actorOf = (req: { user?: AuthUserPayload }, raw: unknown) => ({ userId: req.user?.id, username: req.user?.username, userFullName: req.user?.fullName, req: raw });

router.get('/record-attachments/:entityType/:id', authorizePermission(...ALL_RECORD_ATTACHMENT_READERS), validate(recordAttachmentsSchema), asyncHandler(async (req, res) => {
  const entity = req.params.entityType as RecordAttachmentEntity;
  await assertRecordAttachmentAccess(req.user, entity, false);
  res.json(await recordAttachments(entity, Number(req.params.id)));
}));

router.post('/record-attachments/:entityType/:id', authorizePermission(...ALL_RECORD_ATTACHMENT_WRITERS), idempotency({ scope: 'record-attachments' }),
  validate(recordAttachmentAddSchema), asyncHandler(async (req, res) => {
    const entity = req.params.entityType as RecordAttachmentEntity;
    await assertRecordAttachmentAccess(req.user, entity, true, Number(req.params.id));
    res.json(await addRecordAttachment(entity, Number(req.params.id), { name: req.body.name, dataUrl: req.body.dataUrl }, actorOf(req, req)));
  }));

router.delete('/record-attachments/:entityType/:id/:attachmentId', authorizePermission(...ALL_RECORD_ATTACHMENT_WRITERS), idempotency({ scope: 'record-attachments' }),
  validate(recordAttachmentRemoveSchema), asyncHandler(async (req, res) => {
    const entity = req.params.entityType as RecordAttachmentEntity;
    await assertRecordAttachmentAccess(req.user, entity, true, Number(req.params.id));
    res.json(await removeRecordAttachment(entity, Number(req.params.id), String(req.params.attachmentId), actorOf(req, req)));
  }));

export default router;
