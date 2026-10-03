import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { ProcurementService } from '../services/procurement.service.js';

const router = Router();
router.use(authenticateToken);

// ==========================================
// Zod Validation Schemas (TD-161 Remediation)
// ==========================================

const listRequisitionsSchema = z.object({
  query: z.object({
    status: z.enum(['draft', 'pending', 'approved', 'rejected', 'ordered', 'delivered', 'cancelled', 'all']).optional(),
    projectId: z.coerce.number().int().positive().optional(),
    priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
    search: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }).passthrough(),
}).passthrough();

const createRequisitionSchema = z.object({
  body: z.object({
    projectId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number), z.null()]).optional(),
    title: z.string().max(200).optional(),
    priority: z.enum(['low', 'medium', 'high', 'emergency']).default('medium').optional(),
    requiredDate: z.string().max(50).optional(),
    notes: z.string().max(3000).optional(),
    items: z.array(z.object({
      itemId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
      quantity: z.union([z.number().positive(), z.string().transform(Number)]),
      requiredDate: z.string().max(50).optional(),
      unitPriceEstimate: z.union([z.number().nonnegative(), z.string().transform(Number)]).optional(),
      notes: z.string().max(1000).optional(),
    })).min(1, 'حداقل یک قلم کالا برای درخواست خرید الزامی است')
  })
});

const updateRequisitionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    projectId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number), z.null()]).optional(),
    title: z.string().max(200).optional(),
    priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
    requiredDate: z.string().max(50).optional(),
    notes: z.string().max(3000).optional(),
    items: z.array(z.object({
      id: z.number().int().positive().optional(),
      itemId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
      quantity: z.union([z.number().positive(), z.string().transform(Number)]),
      requiredDate: z.string().max(50).optional(),
      unitPriceEstimate: z.union([z.number().nonnegative(), z.string().transform(Number)]).optional(),
      notes: z.string().max(1000).optional(),
    })).optional()
  })
});

const workflowActionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    actionKey: z.string().min(1, 'کلید اکشن گردش کار الزامی است').max(100),
    comment: z.string().max(1000).optional()
  })
});

const convertToOrdersSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    orderGroups: z.array(z.object({
      supplierId: z.union([z.number().int().positive(), z.null()]).optional(),
      supplierName: z.string().max(200).optional(),
      items: z.array(z.object({
        requisitionItemId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        location: z.string().optional(),
        notes: z.string().max(500).optional()
      })).min(1, 'حداقل یک قلم برای گروه سفارش الزامی است'),
      notes: z.string().max(1000).optional(),
      currency: z.string().default('IRR').optional()
    })).min(1, 'حداقل یک گروه سفارش خرید الزامی است'),
    closeRequisition: z.boolean().optional(),
    closureReason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional()
  })
});

const consolidateRequisitionsSchema = z.object({
  body: z.object({
    requisitionIds: z.array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)])).min(2, 'حداقل ۲ درخواست خرید برای تجمیع الزامی است'),
    title: z.string().max(200).optional()
  })
});

const listProcurementOrdersSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    requisitionId: z.coerce.number().int().positive().optional(),
    search: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  }).passthrough()
}).passthrough();

// ==========================================
// Route Endpoints
// ==========================================

/**
 * GET /api/procurement/inbox/summary
 * Procurement Desk metrics summary
 */
router.get('/inbox/summary', authorize('procurement.view', 'procurement_officer', 'manager', 'admin'), asyncHandler(async (_req, res) => {
  const summary = await ProcurementService.getInboxSummary();
  res.json({ success: true, data: summary });
}));

/**
 * GET /api/procurement/requisitions
 * List purchase requisitions
 */
router.get('/requisitions', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), validate(listRequisitionsSchema), asyncHandler(async (req, res) => {
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
router.get('/requisitions/:id', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const requisition = await ProcurementService.getRequisitionById(id);
  res.json({ success: true, data: requisition });
}));

/**
 * POST /api/procurement/requisitions
 * Create purchase requisition
 */
router.post('/requisitions', authorize('procurement.create', 'procurement_officer', 'manager', 'admin', 'projects.edit'), validate(createRequisitionSchema), asyncHandler(async (req, res) => {
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
router.put('/requisitions/:id', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), validate(updateRequisitionSchema), asyncHandler(async (req, res) => {
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
router.delete('/requisitions/:id', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
router.post('/requisitions/:id/workflow-action', authorize('procurement.approve', 'procurement.manage', 'procurement_officer', 'manager', 'admin'), validate(workflowActionSchema), asyncHandler(async (req, res) => {
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
router.post('/requisitions/:id/convert-to-orders', authorize('procurement.order', 'procurement_officer', 'manager', 'admin'), validate(convertToOrdersSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { orderGroups, closeRequisition, closureReason, notes } = req.body;

  const result = await ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups,
    closeRequisition,
    closureReason,
    notes
  }, {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role
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
router.post('/consolidate', authorize('procurement.manage', 'procurement_officer', 'manager', 'admin'), validate(consolidateRequisitionsSchema), asyncHandler(async (req, res) => {
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
router.get('/orders', authorize('procurement.view', 'procurement_officer', 'manager', 'admin', 'projects.view'), validate(listProcurementOrdersSchema), asyncHandler(async (req, res) => {
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
router.post('/orders/:id/deliver', authorize('procurement.order', 'procurement.manage', 'procurement_officer', 'manager', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const result = await ProcurementService.deliverOrderToWarehouse(id, {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role
  });

  res.json(result);
}));

export default router;
