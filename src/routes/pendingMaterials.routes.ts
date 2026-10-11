import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { approvePendingMaterialSchema, createPendingMaterialSchema, listPendingMaterialsSchema, rejectPendingMaterialSchema, updatePendingMaterialSchema } from './pendingMaterials.schemas.js';
import { PendingMaterialsService, type PendingMaterialActor } from '../services/pendingMaterials.service.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import type { PendingMaterialStatusFilter } from '../lib/pendingMaterials/pendingMaterialList.js';
import { actorDisplayName } from '../lib/auth/actorDisplayName.js';

const router = Router();

/** v9.0.397 (TD-825): the reviewer or sender whose name the service writes into the audit row, inside its transaction */
const actorOf = (req: Request): PendingMaterialActor => ({ req, userId: req.user?.id, username: req.user?.username });

// GET /api/pending-materials - one page of the queue
// v10.0.171 (OBS-R1-90): filtered, counted and paged in SQL by the service (`{ data, total, page, limit, statusCounts }`)
router.get('/pending-materials', authenticateToken, authorizePermission(...READ_PERMISSIONS.pendingMaterials), validate(listPendingMaterialsSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as { status?: PendingMaterialStatusFilter; category?: string; search?: string; page?: string; limit?: string };
  res.json(await PendingMaterialsService.listRequests({
    status: q.status, category: q.category, search: q.search,
    page: q.page ? Number(q.page) : undefined, limit: q.limit ? Number(q.limit) : undefined,
  }));
}));

// POST /api/pending-materials - Submit a new pending material (from project inventory control)
// v9.0.397 (TD-825): sending a request needs pending_materials.create (before, any signed-in user); the request and its audit
// row are written in one transaction
router.post('/pending-materials', authenticateToken, authorizePermission('pending_materials.create'), validate(createPendingMaterialSchema), asyncHandler(async (req: Request, res: Response) => {
  const inserted = await PendingMaterialsService.submitPendingMaterial({
    ...req.body,
    requestedBy: actorDisplayName(req.user, 'کاربر سامانه')
  }, actorOf(req));

  res.status(201).json({
    message: 'ماده اولیه در صف بررسی و تأیید انبار قرار گرفت',
    data: inserted
  });
}));

// PUT /api/pending-materials/:id/approve - Approve and register in official warehouse inventory
// v9.0.397 (TD-825): one transaction under the request row lock, only from pending (409), the item made by the item service
router.put('/pending-materials/:id/approve', authenticateToken, authorizePermission('pending_materials.approve'), validate(approvePendingMaterialSchema), asyncHandler(async (req: Request, res: Response) => {
  const { officialItem: newItem } = await PendingMaterialsService.approvePendingMaterial(Number(req.params.id), req.body ?? {}, actorOf(req));
  res.json({
    message: 'ماده اولیه با موفقیت تأیید و در انبار ثبت شد',
    item: newItem
  });
}));

// PUT /api/pending-materials/:id/reject - Reject pending material
router.put('/pending-materials/:id/reject', authenticateToken, authorizePermission('pending_materials.approve'), validate(rejectPendingMaterialSchema), asyncHandler(async (req: Request, res: Response) => {
  const { rejectionReason } = req.body || {};
  await PendingMaterialsService.rejectPendingMaterial(Number(req.params.id), rejectionReason, actorOf(req));
  res.json({
    message: 'درخواست ماده اولیه رد گردید. کد کالا در انبار ثبت نشد.'
  });
}));

// PUT /api/pending-materials/:id - Update pending material details
// حوزه H (TD-302): «ذخیره ویرایش» پنجره تأیید است؛ همان مجوز تأیید را می‌خواهد (پیش‌تر هر کاربر واردشده)
router.put('/pending-materials/:id', authenticateToken, authorizePermission('pending_materials.approve'), validate(updatePendingMaterialSchema), asyncHandler(async (req: Request, res: Response) => {
  await PendingMaterialsService.updatePendingMaterial(Number(req.params.id), req.body, actorOf(req));
  res.json({ message: 'مشخصات ماده اولیه به‌روزرسانی شد' });
}));

// DELETE /api/pending-materials/:id - Delete pending material (only while pending, v9.0.397)
router.delete('/pending-materials/:id', authenticateToken, authorizePermission('pending_materials.delete'), validate(paramsIdSchema), asyncHandler(async (req: Request, res: Response) => {
  await PendingMaterialsService.deletePendingMaterial(Number(req.params.id), actorOf(req));
  res.json({ message: 'ماده اولیه حذف شد' });
}));

export default router;
