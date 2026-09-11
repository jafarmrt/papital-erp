import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ProcurementService } from '../services/procurement.service.js';
import { ValidationError, NotFoundError } from '../errors/customErrors.js';

const router = Router();
router.use(authenticateToken);

/**
 * GET /api/procurement/inbox/summary
 * Procurement Desk metrics summary
 */
router.get('/inbox/summary', authorize('procurement.view', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const summary = await ProcurementService.getInboxSummary();
  res.json({ success: true, data: summary });
}));

/**
 * GET /api/procurement/requisitions
 * List purchase requisitions
 */
router.get('/requisitions', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), asyncHandler(async (req, res) => {
  const { status, projectId, priority, search, page, limit } = req.query;

  const result = await ProcurementService.getRequisitions({
    status: status ? String(status) : undefined,
    projectId: projectId ? Number(projectId) : undefined,
    priority: priority ? String(priority) : undefined,
    search: search ? String(search) : undefined,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 50
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
router.get('/requisitions/:id', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw new ValidationError('شناسه نامعتبر است.');

  const requisition = await ProcurementService.getRequisitionById(id);
  res.json({ success: true, data: requisition });
}));

/**
 * POST /api/procurement/requisitions
 * Create purchase requisition
 */
router.post('/requisitions', authorize('procurement.create', 'procurement_officer', 'manager', 'admin', 'projects.edit'), asyncHandler(async (req, res) => {
  const created = await ProcurementService.createRequisition(req.body, {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role
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
router.put('/requisitions/:id', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw new ValidationError('شناسه نامعتبر است.');

  const updated = await ProcurementService.updateRequisition(id, req.body, {
    id: req.user.id,
    username: req.user.username
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
router.delete('/requisitions/:id', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw new ValidationError('شناسه نامعتبر است.');

  await ProcurementService.deleteRequisition(id, {
    id: req.user.id,
    username: req.user.username
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
router.post('/requisitions/:id/workflow-action', authorize('procurement.approve', 'procurement.manage', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { actionKey, comment } = req.body;

  if (!id) throw new ValidationError('شناسه نامعتبر است.');
  if (!actionKey) throw new ValidationError('کلید اکشن گردش کار الزامی است.');

  const result = await ProcurementService.executeWorkflowAction(id, actionKey, {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    permissions: req.user.permissions || []
  }, comment);

  res.json(result);
}));

/**
 * POST /api/procurement/requisitions/:id/convert-to-orders
 * Split & convert requisition into purchase documents
 */
router.post('/requisitions/:id/convert-to-orders', authorize('procurement.order', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { orderGroups } = req.body;

  if (!id) throw new ValidationError('شناسه نامعتبر است.');

  const result = await ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups
  }, {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role
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
router.post('/consolidate', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const { requisitionIds, title } = req.body;

  const result = await ProcurementService.consolidateRequisitions(requisitionIds, title, {
    id: req.user.id,
    username: req.user.username
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
router.get('/orders', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), asyncHandler(async (req, res) => {
  const { status, requisitionId, search, page, limit } = req.query;

  const result = await ProcurementService.getProcurementOrders({
    status: status ? String(status) : undefined,
    requisitionId: requisitionId ? Number(requisitionId) : undefined,
    search: search ? String(search) : undefined,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 50
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
router.post('/orders/:id/deliver', authorize('procurement.order', 'procurement.manage', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw new ValidationError('شناسه سند نامعتبر است.');

  const result = await ProcurementService.deliverOrderToWarehouse(id, {
    id: req.user.id,
    username: req.user.username,
    role: req.user.role
  });

  res.json(result);
}));

export default router;
