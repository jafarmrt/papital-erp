import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, numericIdString } from '../middleware/validate.js';
import { CRM_ATTACHMENT_MAX_BYTES, CRM_ATTACHMENT_TOO_LARGE_TEXT, type CrmAttachmentOwner } from '../lib/crm/crmAttachments.js';
import { ValidationError } from '../errors/customErrors.js';
import { CrmAttachmentService, type CrmAttachmentActor } from '../services/crm/crmAttachments.service.js';

/**
 * v10.2 package 7 (N-02 §3.3): image and PDF attachments of a sales file and of an activity or follow-up. Reading the list
 * needs `crm.view` (the key that opens the files, `RECORD_READ_PERMISSIONS`); adding and removing needs `crm.manage`, the
 * key that records and edits activities. A file is the raw request body with its name in `X-File-Name` (URI-encoded) and
 * its type in `Content-Type`, like the media library; the JSON body parser leaves such a body alone.
 */
const router = Router();

const CRM_ATTACHMENT_READ_PERMISSION = 'crm.view';
const CRM_ATTACHMENT_WRITE_PERMISSION = 'crm.manage';

const ownerParams = z.object({ params: z.object({ id: numericIdString }).strict() });
const uploadSchema = z.object({ params: z.object({ id: numericIdString }).strict(), query: z.object({}).strict() });
const removeSchema = z.object({
  params: z.object({ id: numericIdString, attachmentId: z.string().uuid('شناسه پیوست نامعتبر است') }).strict(),
});

function actorOf(req: Request): CrmAttachmentActor {
  return { req, username: req.user?.username ?? '', name: req.user?.full_name || req.user?.username || 'کاربر' };
}

function fileNameOf(req: Request): string {
  const raw = String(req.headers['x-file-name'] ?? '');
  try {
    return decodeURIComponent(raw).slice(0, 255);
  } catch {
    return raw.slice(0, 255);
  }
}

function mount(path: string, owner: CrmAttachmentOwner) {
  router.get(path, authenticateToken, requirePermission(CRM_ATTACHMENT_READ_PERMISSION), validate(ownerParams), asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await CrmAttachmentService.list(owner, Number(req.params.id)) });
  }));

  router.post(path, authenticateToken, requirePermission(CRM_ATTACHMENT_WRITE_PERMISSION), validate(uploadSchema), asyncHandler(async (req: Request, res: Response) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > CRM_ATTACHMENT_MAX_BYTES) {
      throw new ValidationError(CRM_ATTACHMENT_TOO_LARGE_TEXT, undefined, 'CRM_ATTACHMENT_TOO_LARGE');
    }
    const data = await CrmAttachmentService.upload(owner, Number(req.params.id), {
      body: req,
      fileName: fileNameOf(req),
      declaredType: String(req.headers['content-type'] ?? ''),
    }, actorOf(req));
    res.status(201).json({ data });
  }));

  router.delete(`${path}/:attachmentId`, authenticateToken, requirePermission(CRM_ATTACHMENT_WRITE_PERMISSION), validate(removeSchema), asyncHandler(async (req: Request, res: Response) => {
    await CrmAttachmentService.remove(owner, Number(req.params.id), String(req.params.attachmentId), actorOf(req));
    res.json({ message: 'پیوست حذف شد' });
  }));
}

mount('/crm/leads/:id/attachments', 'lead');
mount('/crm/activities/:id/attachments', 'activity');

export default router;
