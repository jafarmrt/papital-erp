import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { ProcurementService } from '../services/procurement.service.js';
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
 * Procurement Desk metrics summary
 */
router.get('/inbox/summary', authorizePermission('procurement.view'), asyncHandler(async (_req, res) => {
  const summary = await ProcurementService.getInboxSummary();
  res.json({ success: true, data: summary });
}));

/**
 * GET /api/procurement/requisitions
 * List purchase requisitions
 */
router.get('/requisitions', authorizePermission('procurement.view', 'projects.view'), validate(listRequisitionsSchema), asyncHandler(async (req, res) => {
  const { status, projectId, priority, search, page, limit } = req.query as z.infer<typeof listRequisitionsSchema>['query'];

  const result = await ProcurementService.getRequisitions({
    status: status && status !== 'all' ? String(status) : undefined,
    projectId: projectId ? Number(projectId) : undefined,
    priority: priority ? String(priority) : undefined,
    search: search ? String(search) : undefined,
    page: Number(page) || 1,
    limit: Number(limit) || 50
  });

  res.json({
    success: true,
    data: result.data,
    total: result.total,
    page: Number(page) || 1,
    limit: Number(limit) || 50
  });
}));

/**
 * GET /api/procurement/requisitions/:id
 * Get single requisition
 */
router.get('/requisitions/:id', authorizePermission('procurement.view', 'projects.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const requisition = await ProcurementService.getRequisitionById(id);
  res.json({ success: true, data: requisition });
}));

/**
 * POST /api/procurement/requisitions
 * Create purchase requisition
 */
router.post('/requisitions', authorizePermission('procurement.create', 'projects.edit'), validate(createRequisitionSchema), asyncHandler(async (req, res) => {
  const created = await ProcurementService.createRequisition(req.body, {
    id: req.user!.id,
    username: req.user!.username,
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
router.post('/requisitions/:id/convert-to-orders', authorizePermission('procurement.order'), validate(convertToOrdersSchema), asyncHandler(async (req, res) => {
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
router.post('/consolidate', authorizePermission('procurement.manage'), validate(consolidateRequisitionsSchema), asyncHandler(async (req, res) => {
  const { requisitionIds, title } = req.body;

  const result = await ProcurementService.consolidateRequisitions(requisitionIds, title, {
    id: req.user!.id,
    username: req.user!.username
  });

  res.status(201).json({
    success: true,
    data: result,
    message: `درخواست تجمیع‌شده ${result.code} با موفقیت ایجاد گردید.`
  });
}));

/**
 * GET /api/procurement/orders
 * List purchase orders / invoices created through procurement
 */
router.get('/orders', authorizePermission('procurement.view', 'projects.view'), validate(listProcurementOrdersSchema), asyncHandler(async (req, res) => {
  const { status, requisitionId, search, page, limit } = req.query as z.infer<typeof listProcurementOrdersSchema>['query'];

  const result = await ProcurementService.getProcurementOrders({
    status: status ? String(status) : undefined,
    requisitionId: requisitionId ? Number(requisitionId) : undefined,
    search: search ? String(search) : undefined,
    page: Number(page) || 1,
    limit: Number(limit) || 50
  });

  res.json({
    success: true,
    data: result.data,
    total: result.total,
    page: Number(page) || 1,
    limit: Number(limit) || 50
  });
}));

/**
 * POST /api/procurement/orders/:id/deliver
 * Deliver a purchase order/invoice to warehouse (finalizes document, increases stock, updates Kardex)
 */
router.post('/orders/:id/deliver', authorizePermission('procurement.order', 'procurement.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const result = await ProcurementService.deliverOrderToWarehouse(id, {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role
  });

  res.json(result);
}));

export default router;
