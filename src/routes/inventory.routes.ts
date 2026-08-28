import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { InventoryIntegrityService } from '../services/inventory/inventoryIntegrity.service.js';
import { ItemsService } from '../services/items.service.js';
import { logActivity } from '../lib/auditLogger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { BadRequestError } from '../errors/customErrors.js';

const router = Router();
router.use(authenticateToken);

const paramsItemIdSchema = z.object({
  params: z.object({
    itemId: numericIdString,
  })
});

const paramsProjectIdSchema = z.object({
  params: z.object({
    projectId: numericIdString,
  })
});

// GET /api/inventory/reserved-items - Comprehensive report of reserved items
router.get('/reserved-items', asyncHandler(async (req, res) => {
  const report = await ItemsService.getReservedStockDetails();
  res.json(report);
}));

const rebuildStockSchema = z.object({
  body: z.object({
    itemId: z.number().optional(),
    fixWAC: z.boolean().optional().default(false)
  })
});

const transferStockSchema = z.object({
  body: z.object({
    itemId: z.number(),
    fromLocation: z.string().min(1, 'انبار مبدا الزامی است'),
    toLocation: z.string().min(1, 'انبار مقصد الزامی است'),
    quantity: z.number().positive('مقدار انتقال باید بزرگتر از صفر باشد'),
    date: z.string().min(1, 'تاریخ انتقال الزامی است'),
    refNumber: z.string().optional(),
    notes: z.string().optional()
  })
});

// GET /api/inventory/integrity-audit
router.get(['/integrity-audit', '/3way-integrity', '/report'], authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'), asyncHandler(async (req, res) => {
  const discrepancyOnly = req.query.discrepancyOnly === 'true';
  const type = req.query.type as string;
  const search = req.query.search as string;

  const report = await InventoryIntegrityService.getIntegrityReport({
    discrepancyOnly,
    type,
    search
  });

  res.json(report);
}));

// POST /api/inventory/rebuild-from-ledger
router.post(
  '/rebuild-from-ledger',
  authorizePermission('inventory.reconcile'),
  validate(rebuildStockSchema),
  asyncHandler(async (req, res) => {
    const { itemId, fixWAC } = req.body;
    const userName = (req as any).user?.name || (req as any).user?.username || 'مدیر سیستم';
    const userId = (req as any).user?.id;

    if (itemId) {
      const singleResult = await InventoryIntegrityService.rebuildItemFromLedger(itemId, {
        fixWAC,
        userId,
        user: userName
      });

      await logActivity({
        req,
        action: 'UPDATE',
        entity: 'انبارداری و موجودی',
        entityId: String(itemId),
        description: `بازسازی و تطبیق کاردکس کالای شناسه ${itemId} (موجودی قبل: ${singleResult.beforeStock} -> موجودی بعد: ${singleResult.afterStock})`,
        details: singleResult
      });

      return res.json({
        success: true,
        message: 'موجودی و کاردکس کالا با موفقیت بازسازی و همگام گردید.',
        data: singleResult
      });
    } else {
      const fullResult = await InventoryIntegrityService.rebuildAllFromLedger({
        fixWAC,
        userId,
        user: userName
      });

      await logActivity({
        req,
        action: 'UPDATE',
        entity: 'انبارداری و موجودی',
        entityId: 'ALL',
        description: `بازسازی جامع موجودی تمام کالاها بر پایه کاردکس (اقلام بررسی شده: ${fullResult.totalItemsChecked}، مغایرت‌های اصلاح‌شده: ${fullResult.discrepanciesFixed}، اصلاح میانگین موزون: ${fullResult.wacRepairedCount})`,
        details: fullResult
      });

      return res.json({
        success: true,
        message: `عملیات بازسازی و تطبیق ۳ جانبه با موفقیت پایان یافت. ${fullResult.discrepanciesFixed} مورد مغایرت در انبارها اصلاح شد.`,
        data: fullResult
      });
    }
  })
);

// POST /api/inventory/transfer
router.post(
  '/transfer',
  authorizePermission('warehouse.transfer'),
  validate(transferStockSchema),
  asyncHandler(async (req, res) => {
    const userName = (req as any).user?.name || (req as any).user?.username || 'مدیر سیستم';
    const result = await InventoryIntegrityService.executeWarehouseTransfer({
      ...req.body,
      user: userName
    });

    await logActivity({
      req,
      action: 'CREATE',
      entity: 'حواله انتقال انبار',
      entityId: String(result.transferDocId),
      description: `ثبت حواله انتقال داخلی کالا (${result.quantity} واحد از انبار ${result.fromLocation} به انبار ${result.toLocation})`,
      details: result
    });

    res.json({
      success: true,
      message: `انتقال ${result.quantity} واحد کالا از انبار ${result.fromLocation} به انبار ${result.toLocation} با موفقیت انجام شد.`,
      data: result
    });
  })
);

// GET /api/inventory/item-kardex/:itemId
router.get('/item-kardex/:itemId', authorizePermission('warehouse.view'), validate(paramsItemIdSchema), asyncHandler(async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(itemId)) {
    throw new BadRequestError('شناسه کالا نامعتبر است.');
  }

  const kardex = await InventoryIntegrityService.getItemRunningKardex(itemId);
  res.json(kardex);
}));

// GET /api/inventory/negative-stock-policy
router.get('/negative-stock-policy', authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'), asyncHandler(async (req, res) => {
  const policy = await InventoryIntegrityService.getNegativeStockPolicy();
  res.json({ policy });
}));

// PUT /api/inventory/negative-stock-policy
router.put('/negative-stock-policy', authorizePermission('inventory.reconcile'), asyncHandler(async (req, res) => {
  const { policy } = req.body;
  if (!['forbidden', 'warning', 'allowed'].includes(policy)) {
    throw new BadRequestError('مقدار سیاست نامعتبر است (باید forbidden، warning یا allowed باشد).');
  }

  await InventoryIntegrityService.setNegativeStockPolicy(policy);
  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'تنظیمات انبارداری',
    entityId: 'negative_stock_policy',
    description: `تغییر سیاست کنترل موجودی منفی به ${policy}`,
    details: { policy }
  });

  res.json({ success: true, policy, message: 'سیاست موجودی منفی با موفقیت به‌روزرسانی شد.' });
}));

// GET /api/inventory/negative-stock-violations
router.get('/negative-stock-violations', authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'), asyncHandler(async (req, res) => {
  const violations = await InventoryIntegrityService.getNegativeStockViolations();
  res.json({ violations, totalViolations: violations.length });
}));

// GET /api/inventory/allocations
router.get('/allocations', authorizePermission('warehouse.view', 'projects.view'), asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? parseInt(req.query.projectId as string, 10) : undefined;
  const itemId = req.query.itemId ? parseInt(req.query.itemId as string, 10) : undefined;
  const status = req.query.status as string;
  const search = req.query.search as string;

  const allocations = await InventoryIntegrityService.getAllAllocations({
    projectId,
    itemId,
    status,
    search
  });

  res.json({ allocations, total: allocations.length });
}));

// GET /api/inventory/allocations/project/:projectId
router.get('/allocations/project/:projectId', authorizePermission('warehouse.view', 'projects.view'), validate(paramsProjectIdSchema), asyncHandler(async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    throw new BadRequestError('شناسه پروژه نامعتبر است.');
  }

  const allocations = await InventoryIntegrityService.getProjectAllocations(projectId);
  res.json({ allocations, total: allocations.length });
}));

// POST /api/inventory/allocations/allocate
router.post('/allocations/allocate', authorizePermission('warehouse.view', 'projects.view'), asyncHandler(async (req, res) => {
  const { projectId, allocations } = req.body;
  if (!projectId || !Array.isArray(allocations) || allocations.length === 0) {
    throw new BadRequestError('شناسه پروژه و اقلام تخصیص الزامی هستند.');
  }

  const user = (req as any).user;
  const result = await InventoryIntegrityService.allocateMaterialsForProject({
    projectId: Number(projectId),
    allocations,
    userId: user?.id,
    username: user?.name || user?.username || 'مدیر سیستم'
  });

  await logActivity({
    req,
    action: 'CREATE',
    entity: 'تخصیص مواد BOM پروژه',
    entityId: String(projectId),
    description: `تخصیص ${result.allocatedCount} قلم مواد اولیه به پروژه شناسه ${projectId}`,
    details: result
  });

  res.json({
    success: true,
    message: `${result.allocatedCount} قلم مواد اولیه با موفقیت از انبار کسر و به پروژه تخصیص یافت.`,
    data: result
  });
}));

// POST /api/inventory/allocations/receipt-allocate - Link receiving transactions to project BOM items
router.post('/allocations/receipt-allocate', authorizePermission('warehouse.view', 'projects.view'), asyncHandler(async (req, res) => {
  const { projectId, allocations } = req.body;
  if (!projectId || !Array.isArray(allocations) || allocations.length === 0) {
    throw new BadRequestError('شناسه پروژه و اقلام تخصیص رسید الزامی هستند.');
  }

  const user = (req as any).user;
  const result = await InventoryIntegrityService.allocateReceiptItemsForProjectBom({
    projectId: Number(projectId),
    allocations,
    userId: user?.id,
    username: user?.name || user?.username || 'مدیر سیستم'
  });

  await logActivity({
    req,
    action: 'CREATE',
    entity: 'تخصیص رسید انبار به BOM پروژه',
    entityId: String(projectId),
    description: `تخصیص مستقیم ${result.allocatedCount} قلم مواد از محل رسید انبار/خرید به پروژه شناسه ${projectId}`,
    details: result
  });

  res.json({
    success: true,
    message: `${result.allocatedCount} قلم مواد اولیه با موفقیت از رسید انبار به پروژه تخصیص یافت.`,
    data: result
  });
}));

// POST /api/inventory/allocations/:id/consume
router.post('/allocations/:id/consume', authorizePermission('inventory.reconcile', 'projects.edit'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new BadRequestError('شناسه تخصیص نامعتبر است.');
  }

  const user = (req as any).user;
  const updated = await InventoryIntegrityService.consumeAllocation(id, {
    userId: user?.id,
    username: user?.name || user?.username || 'سیستم'
  });

  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'تخصیص مواد BOM پروژه',
    entityId: String(id),
    description: `مصرف قطعی تخصیص شماره ${id} برای پروژه ${updated.projectCode} (کالا: ${updated.itemName})`,
    details: updated
  });

  res.json({
    success: true,
    message: 'تخصیص مورد نظر با موفقیت در وضعیت مصرف‌شده ثبت گردید.',
    data: updated
  });
}));

// POST /api/inventory/allocations/:id/release
router.post('/allocations/:id/release', authorizePermission('warehouse.view', 'projects.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new BadRequestError('شناسه تخصیص نامعتبر است.');
  }

  const { reason } = req.body;
  const user = (req as any).user;
  const updated = await InventoryIntegrityService.releaseAllocation(id, {
    reason,
    userId: user?.id,
    username: user?.name || user?.username || 'سیستم'
  });

  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'آزادسازی تخصیص BOM',
    entityId: String(id),
    description: `آزادسازی و عودت ${updated.quantity} واحد از کالا ${updated.itemName} به انبار ${updated.sourceLocation} بابت پروژه ${updated.projectCode}`,
    details: updated
  });

  res.json({
    success: true,
    message: 'تخصیص با موفقیت آزاد شده و موجودی به انبار مبداء عودت داده شد.',
    data: updated
  });
}));

export default router;

