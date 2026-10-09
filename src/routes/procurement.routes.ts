import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { ProcurementService } from '../services/procurement.service.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import {
  consolidateRequisitionsSchema, convertToOrdersSchema, createRequisitionSchema, listProcurementOrdersSchema, listRequisitionsSchema,
  updateRequisitionSchema, workflowActionSchema,
} from './procurement.schemas.js';

const router = Router();
router.use(authenticateToken);

// ==========================================
// Route Endpoints
// ==========================================

/**
 * GET /api/procurement/inbox/summary
 * Procurement Desk metrics summary. v9.0.352 (TD-702): the same readers as the requisition list (every key that opens
 * the desk page); it took procurement.view only and its 403 emptied the desk for projects.view
 */
router.get('/inbox/summary', authorizePermission(...READ_PERMISSIONS.purchaseRequisitions), asyncHandler(async (_req, res) => {
  const summary = await ProcurementService.getInboxSummary();
  res.json({ success: true, data: summary });
}));

/**
 * GET /api/procurement/requisitions
 * List purchase requisitions
 */
router.get('/requisitions', authorizePermission(...READ_PERMISSIONS.purchaseRequisitions), validate(listRequisitionsSchema), asyncHandler(async (req, res) => {
  const { status, projectId, priority, search, page, limit } = req.query as z.infer<typeof listRequisitionsSchema>['query'];

  const result = await ProcurementService.getRequisitions({ status, projectId, priority, search, page, limit });
  // v9.0.353 (TD-697): the page and limit the service used, not the ones asked for
  res.json({ success: true, data: result.data, total: result.total, page: result.page, limit: result.limit });
}));

/**
 * GET /api/procurement/requisitions/:id
 * Get single requisition
 */
router.get('/requisitions/:id', authorizePermission(...READ_PERMISSIONS.purchaseRequisitions), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const requisition = await ProcurementService.getRequisitionById(id);
  res.json({ success: true, data: requisition });
}));

/**
 * POST /api/procurement/requisitions
 * Create purchase requisition. v9.0.348 (TD-693): create, convert to orders, consolidate and deliver take the
 * Idempotency-Key the browser sends, so a repeated submission replays the first response instead of running again.
 */
router.post('/requisitions', authorizePermission('procurement.create', 'projects.edit'), idempotency({ scope: 'procurement' }), validate(createRequisitionSchema), asyncHandler(async (req, res) => {
  const created = await ProcurementService.createRequisition(req.body, {
    id: req.user!.id,
    username: req.user!.username,
    fullName: req.user!.full_name,
    role: req.user!.role
  });

  res.status(201).json({
    success: true,
    data: created,
    message: `درخواست خرید ${created.code} با موفقیت ثبت شد.`
  });
}));

/**
 * PUT /api/procurement/requisitions/:id
 * Update requisition
 */
router.put('/requisitions/:id', authorizePermission('procurement.manage'), validate(updateRequisitionSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await ProcurementService.updateRequisition(id, req.body, {
    id: req.user!.id,
    username: req.user!.username
  });

  res.json({
    success: true,
    data: updated,
    message: 'درخواست خرید با موفقیت به‌روزرسانی شد.'
  });
}));

/**
 * DELETE /api/procurement/requisitions/:id
 * Soft delete requisition
 */
router.delete('/requisitions/:id', authorizePermission('procurement.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await ProcurementService.deleteRequisition(id, {
    id: req.user!.id,
    username: req.user!.username
  });

  res.json({
    success: true,
    message: 'درخواست خرید با موفقیت حذف شد.'
  });
}));

/**
 * POST /api/procurement/requisitions/:id/workflow-action
 * Execute workflow transition
 */
router.post('/requisitions/:id/workflow-action', authorizePermission('procurement.approve', 'procurement.manage'), validate(workflowActionSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { actionKey, comment } = req.body;

  const result = await ProcurementService.executeWorkflowAction(id, actionKey, {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role,
    permissions: req.user!.permissions || []
  }, comment);

  res.json(result);
}));

/**
 * POST /api/procurement/requisitions/:id/convert-to-orders
 * Split & convert requisition into purchase documents
 */
router.post('/requisitions/:id/convert-to-orders', authorizePermission('procurement.order'), idempotency({ scope: 'procurement' }), validate(convertToOrdersSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { orderGroups, closeRequisition, closureReason, overOrderReason, notes } = req.body;

  const result = await ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups,
    closeRequisition,
    closureReason,
    overOrderReason,
    notes
  }, {
    id: req.user!.id,
    username: req.user!.username,
    fullName: req.user!.full_name,
    role: req.user!.role,
    permissions: req.user!.permissions || []
  });

  res.json({
    success: true,
    data: result,
    message: `${result.createdDocuments.length} سند خرید صادر و وضعیت درخواست به‌روز شد.`
  });
}));

/**
 * POST /api/procurement/consolidate
 * Consolidate multiple requisitions
 */
router.post('/consolidate', authorizePermission('procurement.manage'), idempotency({ scope: 'procurement' }), validate(consolidateRequisitionsSchema), asyncHandler(async (req, res) => {
  const { requisitionIds, title } = req.body;

  const result = await ProcurementService.consolidateRequisitions(requisitionIds, title, {
    id: req.user!.id,
    username: req.user!.username,
    fullName: req.user!.full_name
  });

  res.status(201).json({
    success: true,
    data: result,
    message: `درخواست تجمیعی ${result.code} ثبت شد و درخواست‌های منبع بسته شدند.`
  });
}));

/**
 * GET /api/procurement/orders
 * v9.0.347 (TD-691): only documents linked to a requisition (documents.procurement_requisition_id), paged in SQL
 */
router.get('/orders', authorizePermission(...READ_PERMISSIONS.procurementOrders), validate(listProcurementOrdersSchema), asyncHandler(async (req, res) => {
  const { status, requisitionId, search, page, limit } = req.query as z.infer<typeof listProcurementOrdersSchema>['query'];

  const result = await ProcurementService.getProcurementOrders({ status, requisitionId, search, page, limit });
  res.json({ success: true, data: result.data, total: result.total, page: result.page, limit: result.limit });
}));

/**
 * POST /api/procurement/orders/:id/deliver
 * Deliver a procurement order to the warehouse (finalizes it, moves stock in, updates Kardex); v9.0.347 (TD-691): only
 * a document linked to a requisition, else 422 PROCUREMENT_ORDER_NOT_LINKED. v9.0.455 (TD-904): the service also asks the
 * stock-in permission of the receipt document (PROCUREMENT_RECEIVE_PERMISSION, 403 PROCUREMENT_RECEIVE_PERMISSION_REQUIRED)
 */
router.post('/orders/:id/deliver', authorizePermission('procurement.order', 'procurement.manage'), idempotency({ scope: 'procurement' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const result = await ProcurementService.deliverOrderToWarehouse(id, {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role,
    permissions: req.user!.permissions || []
  });

  res.json(result);
}));

export default router;
