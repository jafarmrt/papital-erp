import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, requirePermission, userHasRoleOrPermission } from '../middleware/authorize.js';
import { BACKDATE_PERMISSION } from '../services/inventory/stockMovementDate.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { InventoryIntegrityService } from '../services/inventory/inventoryIntegrity.service.js';
import { ItemsService } from '../services/items.service.js';
import { logActivity } from '../lib/auditLogger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { BadRequestError, ConflictError } from '../errors/customErrors.js';
import { KardexBackfillService } from '../services/inventory/kardexBackfill.service.js';
import { WarehouseStockReconciliationService } from '../services/inventory/warehouseStockReconciliation.service.js';
import { idempotency } from '../middleware/idempotency.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { BOM_ALLOCATE_PERMISSIONS, BOM_CONSUME_PERMISSIONS, BOM_RELEASE_PERMISSIONS, PROJECT_STOCK_IN_PERMISSIONS } from '../lib/permissions/projectPermissions.js';
import { WAC_CORRECTION_PERMISSION } from '../lib/inventoryAudit/wacCorrection.js';
import { ITEM_COST_READ_PERMISSIONS, RESERVATION_BUYER_READ_PERMISSIONS, reservedItemsReportForAccess } from '../lib/inventory/reservedItemsReport.js';
import type { AuthUserPayload } from '../types.js';

const router = Router();
router.use(authenticateToken);

/**
 * کاربر جاری برای نام لاگ. فیلد قدیمی `name` در payload توکن‌های فعلی وجود ندارد
 * (generateToken آن را نمی‌نویسد)، پس عملاً همیشه username استفاده می‌شود؛ برای حفظ رفتار نگه داشته شده است.
 */
type LegacyNamedUser = AuthUserPayload & { name?: string };

export const paramsItemIdSchema = z.object({
  params: z.object({
    itemId: numericIdString,
  })
});

export const rebuildStockSchema = z.object({
  body: z.object({
    itemId: z.coerce.number().int().positive('شناسه کالا نامعتبر است').optional(),
  }).optional()
});

// v9.0.90 (TD-487، تصمیم ت۳): اصلاح WAC جدا از بازسازی، با مجوز خودش (WAC_CORRECTION_PERMISSION)
export const correctWacSchema = z.object({
  body: z.object({
    itemId: z.coerce.number().int().positive('شناسه کالا نامعتبر است'),
  })
});

export const transferStockSchema = z.object({
  body: z.object({
    itemId: z.coerce.number().int().positive('شناسه کالا باید عدد مثبت باشد'),
    fromLocation: z.string().min(1, 'انبار مبدا الزامی است'),
    toLocation: z.string().min(1, 'انبار مقصد الزامی است'),
    quantity: z.coerce.number().positive('مقدار انتقال باید بزرگتر از صفر باشد'),
    date: z.string().min(1, 'تاریخ انتقال الزامی است').optional(),
    refNumber: z.string().optional(),
    notes: z.string().optional()
  }).superRefine((data, ctx) => {
    if (data.fromLocation.trim() === data.toLocation.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toLocation'],
        message: 'انبار مبدا و مقصد انتقال نمی‌توانند یکسان باشند'
      });
    }
  })
});

export const negativeStockPolicySchema = z.object({
  body: z.object({
    // v7.0.22 (TD-180 / audit P0-3): تنها سیاست مجاز «ممنوعیت کامل» است
    policy: z.literal('forbidden', {
      message: 'منفی شدن موجودی انبار مجاز نیست و تنها سیاست قابل انتخاب «ممنوعیت کامل» است.'
    })
  })
});

export const inventoryIntegrityAuditQuerySchema = z.object({
  query: z.object({
    discrepancyOnly: z.union([z.string(), z.boolean()]).optional(),
    type: z.string().optional(),
    search: z.string().optional()
  }).optional()
});

export const allocationsQuerySchema = z.object({
  query: z.object({
    projectId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    status: z.enum(['allocated', 'consumed', 'released']).optional(),
    search: z.string().optional()
  }).optional()
});

export const bomAllocationItemSchema = z.object({
  itemId: z.coerce.number().int().positive('شناسه کالا باید عدد مثبت باشد'),
  quantity: z.coerce.number().positive('مقدار تخصیص باید بزرگتر از صفر باشد'),
  location: z.string().optional(),
  notes: z.string().optional()
});

export const projectAllocateSchema = z.object({
  body: z.object({
    projectId: z.coerce.number().int().positive('شناسه پروژه الزامی است'),
    allocations: z.array(bomAllocationItemSchema).min(1, 'حداقل یک قلم کالا برای تخصیص به پروژه الزامی است')
  })
});

export const bomReceiptAllocationItemSchema = z.object({
  itemId: z.coerce.number().int().positive('شناسه کالا باید عدد مثبت باشد'),
  quantity: z.coerce.number().positive('مقدار تخصیص باید بزرگتر از صفر باشد'),
  receiptTransactionId: z.coerce.number().int().positive().optional(),
  documentId: z.coerce.number().int().positive().optional(),
  location: z.string().optional(),
  notes: z.string().optional()
});

export const releaseAllocationSchema = z.object({
  params: z.object({
    id: numericIdString
  }),
  body: z.object({
    reason: z.string().optional()
  }).optional()
});

// GET /api/inventory/reserved-items - Comprehensive report of reserved items
// v9.0.400 (TD-829): cost and value only for item cost readers, a proforma's buyer only for documents.view
router.get('/reserved-items', authorizePermission(...READ_PERMISSIONS.reservedItems), asyncHandler(async (req, res) => {
  const report = await ItemsService.getReservedStockDetails();
  res.json(reservedItemsReportForAccess(report, {
    cost: await can(req.user, ...ITEM_COST_READ_PERMISSIONS),
    buyer: await can(req.user, ...RESERVATION_BUYER_READ_PERMISSIONS),
  }));
}));

// GET /api/inventory/integrity-audit
router.get(
  ['/integrity-audit', '/3way-integrity', '/report'],
  authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'),
  validate(inventoryIntegrityAuditQuerySchema),
  asyncHandler(async (req, res) => {
    const discrepancyOnly = String(req.query.discrepancyOnly) === 'true';
    const type = req.query.type as string;
    const search = req.query.search as string;

    const report = await InventoryIntegrityService.getIntegrityReport({
      discrepancyOnly,
      type,
      search
    });

    res.json(report);
  })
);

// v7.0.33 (TD-200 / audit P1-9): گزارش مغایرت موجودی تفکیکی انبارها با کاردکس و ترمیم دستی
export const warehouseStockReconQuerySchema = z.object({
  query: z.object({
    includeHealthy: z.enum(['true', 'false']).optional(),
  }).passthrough()
});

export const warehouseStockRepairSchema = z.object({
  body: z.object({
    // پیش‌فرض اجرای آزمایشی است؛ اعمال تغییرات فقط با dryRun=false صریح
    dryRun: z.boolean().optional().default(true),
    itemIds: z.array(z.coerce.number().int().positive()).max(5000).optional(),
  })
});

// GET /api/inventory/warehouse-stock-reconciliation
router.get(
  '/warehouse-stock-reconciliation',
  authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'),
  validate(warehouseStockReconQuerySchema),
  asyncHandler(async (req, res) => {
    const report = await WarehouseStockReconciliationService.getReport({
      includeHealthy: String(req.query.includeHealthy) === 'true',
    });
    res.json(report);
  })
);

// POST /api/inventory/warehouse-stock-reconciliation/repair
router.post(
  '/warehouse-stock-reconciliation/repair',
  authorizePermission('inventory.reconcile'),
  validate(warehouseStockRepairSchema),
  asyncHandler(async (req, res) => {
    const { dryRun, itemIds } = req.body as { dryRun: boolean; itemIds?: number[] };
    const userId = req.user?.id;
    const username = req.user?.username || 'مدیر سیستم';
    const result = await WarehouseStockReconciliationService.repair({ dryRun, itemIds, userId, username });
    if (result.locked) {
      throw new ConflictError('ترمیم موجودی انبارها هم‌اکنون توسط کاربر یا نمونه دیگری در حال اجراست.');
    }
    if (!dryRun) {
      await logActivity({
        req,
        action: 'AUDIT_APPLY',
        entity: 'انبارداری و موجودی',
        entityId: result.runId,
        description: `ترمیم موجودی انبارها از روی کاردکس: ${result.itemsRepaired} کالا، ${result.rowsChanged} ردیف اصلاح شد؛ ${result.negativeLedgerRows} ردیف با مانده منفی و ${result.blockedItems} کالا با محل نامعلوم اصلاح نشدند`,
        details: { ...result, changes: result.changes.slice(0, 500) }
      });
    }
    res.json({
      success: true,
      message: dryRun
        ? `اجرای آزمایشی: ${result.rowsChanged} ردیف در ${result.itemsRepaired} کالا اصلاح خواهد شد (هیچ تغییری اعمال نشد).`
        : `${result.rowsChanged} ردیف موجودی در ${result.itemsRepaired} کالا از روی کاردکس اصلاح شد.`,
      data: { ...result, changes: result.changes.slice(0, 500) }
    });
  })
);

// POST /api/inventory/kardex-initial-backfill
// v7.0.31 (TD-193 / audit P1-8): ثبت ردیف موجودی اولیه کاردکس برای کالاهای دارای موجودی بدون گردش ورودی؛
// پیش‌تر در هر بوت هر Pod اجرا می‌شد. اکنون دستی و با قفل مشورتی (فقط یک اجرا در کل خوشه).
router.post(
  '/kardex-initial-backfill',
  authorizePermission('inventory.reconcile'),
  asyncHandler(async (req, res) => {
    const outcome = await KardexBackfillService.runExclusive();
    if (outcome.locked) {
      throw new ConflictError('ثبت موجودی اولیه کاردکس هم‌اکنون توسط کاربر یا نمونه دیگری در حال اجراست.');
    }
    await logActivity({
      req,
      action: 'CREATE',
      entity: 'انبارداری و موجودی',
      entityId: 'KARDEX_INITIAL_BACKFILL',
      description: `ثبت موجودی اولیه کاردکس: ${outcome.insertedRows} ردیف جدید (کالاهای بررسی‌شده: ${outcome.candidateItems})`,
      details: outcome
    });
    res.json({
      success: true,
      message: `${outcome.insertedRows} ردیف موجودی اولیه در کاردکس ثبت شد.` +
        (outcome.zeroWacItems > 0 ? ` ${outcome.zeroWacItems} کالا بهای میانگین نداشت و ردیف آن با بهای ۰ ثبت شد.` : ''),
      data: outcome
    });
  })
);

// POST /api/inventory/rebuild-from-ledger
router.post(
  '/rebuild-from-ledger',
  authorizePermission('inventory.reconcile'),
  validate(rebuildStockSchema),
  asyncHandler(async (req, res) => {
    const { itemId } = req.body || {};
    const user: LegacyNamedUser | undefined = req.user;
    const userName = user?.name || user?.username || 'مدیر سیستم';
    const userId = user?.id;

    if (itemId) {
      const singleResult = await InventoryIntegrityService.rebuildItemFromLedger(itemId, {
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
        userId,
        user: userName
      });

      await logActivity({
        req,
        action: 'UPDATE',
        entity: 'انبارداری و موجودی',
        entityId: 'ALL',
        description: `بازسازی جامع موجودی تمام کالاها بر پایه کاردکس (اقلام بررسی شده: ${fullResult.totalItemsChecked}، مغایرت‌های اصلاح‌شده: ${fullResult.discrepanciesFixed}، کالاهای با بهای میانگین ناهمخوان با کاردکس: ${fullResult.wacDifferenceCount})`,
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

// POST /api/inventory/correct-wac
// v9.0.90 (TD-487، تصمیم ت۳): WAC کالا برابر بازپخش کاردکس می‌شود و در همان تراکنش سند پیش‌نویس اختلاف ارزش در برابر ۷۰۱۲ صادر
// می‌شود؛ بازسازی کاردکس دیگر WAC را تغییر نمی‌دهد
router.post(
  '/correct-wac',
  authorizePermission(WAC_CORRECTION_PERMISSION),
  validate(correctWacSchema),
  asyncHandler(async (req, res) => {
    const user: LegacyNamedUser | undefined = req.user;
    const result = await InventoryIntegrityService.correctItemWacFromLedger(Number(req.body.itemId), {
      userId: user?.id,
      user: user?.name || user?.username || 'مدیر سیستم',
    });
    res.json({
      success: true,
      message: `بهای میانگین کالای «${result.itemName}» از ${result.oldWac} به ${result.newWac} اصلاح شد` +
        (result.voucherNumber ? ` و سند پیش‌نویس ${result.voucherNumber} برای اختلاف ارزش صادر شد.` : '.'),
      data: result,
    });
  })
);

// POST /api/inventory/transfer
router.post(
  '/transfer',
  authorizePermission('warehouse.transfer'),
  idempotency({ scope: 'inventory' }),
  validate(transferStockSchema),
  asyncHandler(async (req, res) => {
    const user: LegacyNamedUser | undefined = req.user;
    const userName = user?.name || user?.username || 'مدیر سیستم';
    const result = await InventoryIntegrityService.executeWarehouseTransfer({
      ...req.body,
      user: userName,
      // v8.0.4 (TD-257): مجوز تاریخ گذشته فقط از نقش کاربر، هرگز از بدنه درخواست
      allowBackdate: await userHasRoleOrPermission(req.user, BACKDATE_PERMISSION),
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
router.get(
  '/item-kardex/:itemId',
  authorizePermission('warehouse.view'),
  validate(paramsItemIdSchema),
  asyncHandler(async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(itemId)) {
      throw new BadRequestError('شناسه کالا نامعتبر است.');
    }

    const kardex = await InventoryIntegrityService.getItemRunningKardex(itemId);
    res.json(kardex);
  })
);

// GET /api/inventory/negative-stock-policy
router.get(
  '/negative-stock-policy',
  authorizePermission('warehouse.view', 'inventory.reconcile', 'audit.view'),
  asyncHandler(async (req, res) => {
    const policy = await InventoryIntegrityService.getNegativeStockPolicy();
    res.json({ policy });
  })
);

// PUT /api/inventory/negative-stock-policy
router.put(
  '/negative-stock-policy',
  authorizePermission('inventory.reconcile'),
  validate(negativeStockPolicySchema),
  asyncHandler(async (req, res) => {
    const { policy } = req.body;
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
  })
);

// GET /api/inventory/allocations
router.get(
  '/allocations',
  authorizePermission(...READ_PERMISSIONS.bomAllocations),
  validate(allocationsQuerySchema),
  asyncHandler(async (req, res) => {
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
  })
);

// POST /api/inventory/allocations/allocate
router.post(
  '/allocations/allocate',
  // حوزه H (TD-298): تخصیص کالا را از انبار خارج و سند ۱۴۰۲ صادر می‌کند؛ مجوز مشاهده کافی نیست
  // v9.0.454 (TD-923): مانند حواله `warehouse.out` می‌خواهد
  authorizePermission(...BOM_ALLOCATE_PERMISSIONS),
  idempotency({ scope: 'inventory' }),
  validate(projectAllocateSchema),
  asyncHandler(async (req, res) => {
    const { projectId, allocations } = req.body;
    const user: LegacyNamedUser | undefined = req.user;
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
  })
);

// POST /api/inventory/allocations/:id/consume
router.post(
  '/allocations/:id/consume',
  authorizePermission(...BOM_CONSUME_PERMISSIONS),
  idempotency({ scope: 'inventory' }),
  validate(paramsIdSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new BadRequestError('شناسه تخصیص نامعتبر است.');
    }

    const user: LegacyNamedUser | undefined = req.user;
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
  })
);

// POST /api/inventory/allocations/:id/release
router.post(
  '/allocations/:id/release',
  authorizePermission(...BOM_RELEASE_PERMISSIONS),
  // v9.0.454 (TD-923): آزادسازی کالا را به انبار برمی‌گرداند و مانند رسید `warehouse.in` هم می‌خواهد
  requirePermission(...PROJECT_STOCK_IN_PERMISSIONS),
  idempotency({ scope: 'inventory' }),
  validate(releaseAllocationSchema),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new BadRequestError('شناسه تخصیص نامعتبر است.');
    }

    const { reason } = req.body || {};
    const user: LegacyNamedUser | undefined = req.user;
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
  })
);

export default router;
