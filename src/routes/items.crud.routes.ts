import { Router } from 'express';
import { sql, eq, and, desc, ilike, or, gt, inArray } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { items, transactions, documentItems, journalVouchers } from '../db/schema.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { MAX_PAGE_LIMIT } from '../lib/pagination.js';
import { ItemsService } from '../services/items.service.js';
import { ItemOpeningService } from '../services/inventory/itemOpening.service.js';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService.js';
import { logger } from '../middleware/logger.js';
import { ItemCatalogService } from '../services/items/itemCatalog.service.js';
import { resolveWarehouseCode } from '../services/inventory/warehouseResolver.js';
import { ItemWarehouseStockService } from '../services/inventory/itemWarehouseStock.service.js';
import { containsLikePattern } from '../lib/sqlLike.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';

const router = Router();

export const itemCreateUpdateSchema = z.object({
  body: z.preprocess((val: unknown) => {
    if (val && typeof val === 'object') {
      const copy = { ...(val as Record<string, unknown>) };
      // V2.0.0: alias — فرم کالا initial_cost می‌فرستد؛ به weighted_average_cost نگاشت شود
      if (copy.initial_cost !== undefined && copy.weighted_average_cost === undefined) {
        copy.weighted_average_cost = copy.initial_cost;
      }
      // V2.0.0: پشتیبانی از stocks به‌صورت شیء کلیددار (کلید = شناسه انبار) —
      // به کلیدهای stock_<warehouseId> تبدیل می‌شود (همان قرارداد قبلی بک‌اند)
      if (copy.stocks && typeof copy.stocks === 'object' && !Array.isArray(copy.stocks)) {
        for (const [whKey, val] of Object.entries(copy.stocks)) {
          const num = Number(val) || 0;
          if (num !== 0) {
            copy[`stock_${whKey}`] = num;
          }
        }
      }
      return copy;
    }
    return val;
  }, z.object({
    type: z.enum(['product', 'raw_material']).optional(),
    name: z.string().min(2, 'نام کالا باید حداقل ۲ کاراکتر باشد'),
    code: z.string().min(1, 'کد کالا الزامی است'),
    unit: z.string().min(1, 'واحد اندازه گیری الزامی است'),
    category: z.string().optional(),
    image: z.string().optional(),
    thumbnail: z.string().optional(),
    reorder_point: z.union([z.string(), z.number()]).optional(),
    weighted_average_cost: z.union([z.string(), z.number()]).optional(),
    initial_cost: z.union([z.string(), z.number()]).optional(),
    current_stock: z.union([z.string(), z.number()]).optional(),
    stocks: z.record(z.string(), z.any()).optional(),
    color: z.string().optional(),
    weight: z.union([z.string(), z.number()]).optional(),
    material: z.string().optional(),
    size: z.string().optional()
  }).passthrough())
});

export const itemUpdateSchema = z.object({
  body: itemCreateUpdateSchema.shape.body,
  params: z.object({
    id: numericIdString
  })
});

// GET /items/reorder-alerts
router.get('/items/reorder-alerts', authorizePermission(...READ_PERMISSIONS.items), asyncHandler(async (req, res) => {
  try {
    const type = req.query.type as string;
    const search = req.query.search as string;
    const isZeroStock = req.query.zero_stock === 'true';

    const conditions = [
      eq(items.isDeleted, 0),
      sql`${items.currentStock} <= ${items.reorderPoint}`,
      gt(items.reorderPoint, 0)
    ];

    if (type === 'product' || type === 'raw_material') {
      conditions.push(eq(items.type, type));
    }

    if (isZeroStock) {
      conditions.push(sql`${items.currentStock} <= 0`);
    }

    if (search) {
      conditions.push(or(
        ilike(items.name, containsLikePattern(search)),
        ilike(items.code, containsLikePattern(search)),
        ilike(items.category, containsLikePattern(search))
      )!);
    }

    const fetchedItems = await orm.select().from(items)
      .where(and(...conditions))
      .orderBy(items.currentStock);
    // v7.0.48 (TD-214): موجودی هر انبار از جدول نرمال (ستون JSONB حذف شد)
    const alertStockMap = await ItemWarehouseStockService.getStocksForItems(orm, fetchedItems.map(it => it.id));

    const mapped = fetchedItems.map(it => {
      const curStock = Number(it.currentStock || 0);
      const reorderPt = Number(it.reorderPoint || 0);
      const wac = Number(it.weightedAverageCost || 0);
      const deficit = Math.max(0, reorderPt - curStock);

      const st = alertStockMap.get(it.id)?.byCode ?? {};
      const obj: Record<string, unknown> = {
        ...it,
        stocks: st,
        current_stock: curStock,
        reorder_point: reorderPt,
        weighted_average_cost: wac,
        deficit,
        deficit_value: deficit * wac,
        is_zero_stock: curStock <= 0
      };

      for (const k of Object.keys(st)) {
        obj[`stock_${k}`] = Number(st[k] || 0);
      }
      return obj;
    });

    res.json(mapped);
  } catch (err) {
    throw err;
  }
}));

// GET /items
router.get('/items', authorizePermission(...READ_PERMISSIONS.items), asyncHandler(async (req, res) => {
  try {
    const type = req.query.type as string;
    // V9-1.3: صفحه‌بندی NaN-safe با سقف (limit=0 به معنای «بدون سقف» برای خروجی باقی می‌ماند)
    const page = parseInt(req.query.page as string) || 1;
    const limitStr = req.query.limit as string;
    let limit = limitStr === '0' ? 0 : (parseInt(limitStr) || 50);
    if (Number.isNaN(limit) || limit < 0) limit = 50;
    if (limit > MAX_PAGE_LIMIT) limit = MAX_PAGE_LIMIT;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const isExport = req.query.export === 'true';

    const conditions = [eq(items.isDeleted, 0)];

    if (type === 'product' || type === 'raw_material') {
      conditions.push(eq(items.type, type));
    }

    if (search) {
      conditions.push(or(
        ilike(items.name, containsLikePattern(search)),
        ilike(items.code, containsLikePattern(search))
      )!);
    }

    const whereClause = and(...conditions);

    let query = orm.select().from(items).where(whereClause).orderBy(desc(items.id));

    if (!isExport && limit > 0) {
      query = query.limit(limit).offset(offset) as any;
    }

    const fetchedItems = await query;
    const reservedMap = await ItemsService.getReservedStocksMap();
    // v7.0.48 (TD-214): نقشه موجودی انبارها (stocks و stock_<کد>) از جدول نرمال؛ شکل پاسخ برای رابط کاربری حفظ شده است
    const listStockMap = await ItemWarehouseStockService.getStocksForItems(orm, fetchedItems.map(it => it.id));

    const itemIds = fetchedItems.map(it => it.id);
    let txItemSet = new Set<number>();
    let docItemSet = new Set<number>();
    let voucherItemSet = new Set<number>();

    if (itemIds.length > 0) {
      const [txRows, docRows, voucherRows] = await Promise.all([
        orm.select({ itemId: transactions.itemId })
          .from(transactions)
          .where(and(inArray(transactions.itemId, itemIds), eq(transactions.isDeleted, 0)))
          .groupBy(transactions.itemId),
        orm.select({ itemId: documentItems.itemId })
          .from(documentItems)
          .where(and(inArray(documentItems.itemId, itemIds), eq(documentItems.isDeleted, 0)))
          .groupBy(documentItems.itemId),
        orm.select({ referenceId: journalVouchers.referenceId })
          .from(journalVouchers)
          .where(and(
            eq(journalVouchers.referenceModule, 'item_opening'),
            inArray(journalVouchers.referenceId, itemIds),
            eq(journalVouchers.isDeleted, 0)
          ))
          .groupBy(journalVouchers.referenceId)
      ]);

      txItemSet = new Set(txRows.map(r => r.itemId));
      docItemSet = new Set(docRows.map(r => r.itemId));
      voucherItemSet = new Set(voucherRows.map(r => r.referenceId).filter((id): id is number => id !== null));
    }

    const rawLocQuery = req.query.location ? String(req.query.location).trim() : (req.query.warehouse ? String(req.query.warehouse).trim() : '');
    let resolvedQueryLoc: string | null = null;
    if (rawLocQuery) {
      try {
        resolvedQueryLoc = await resolveWarehouseCode(orm, rawLocQuery);
      } catch {
        resolvedQueryLoc = null;
      }
    }

    const mapped = fetchedItems.map(it => {
      const codeUpper = (it.code || '').trim().toUpperCase();
      const resInfo = reservedMap[codeUpper] || { totalReserved: 0, reservations: [] };
      const curStock = Number(it.currentStock || 0);
      const reservedStock = Number(resInfo.totalReserved || 0);
      const st: Record<string, number> = listStockMap.get(it.id)?.byCode ?? {};

      let locStock: number | null = null;
      if (resolvedQueryLoc) {
        locStock = Number(st[resolvedQueryLoc] || 0);
      }

      const availableStock = resolvedQueryLoc !== null
        ? Math.max(0, Math.min(locStock ?? 0, curStock - reservedStock))
        : Math.max(0, curStock - reservedStock);

      const hasTx = txItemSet.has(it.id);
      const hasDoc = docItemSet.has(it.id);
      const hasOpeningVoucher = voucherItemSet.has(it.id);
      const canSetOpening = curStock <= 0 && !hasTx && !hasDoc && !hasOpeningVoucher;

      const obj: Record<string, unknown> = {
        ...it,
        stocks: st,
        current_stock: curStock,
        reorder_point: it.reorderPoint,
        weighted_average_cost: it.weightedAverageCost,
        reserved_stock: reservedStock,
        available_stock: availableStock,
        location_stock: locStock,
        reservations: resInfo.reservations,
        canSetOpeningBalance: canSetOpening,
        can_set_opening_balance: canSetOpening
      };
      for (const k of Object.keys(st)) {
        obj[`stock_${k}`] = Number(st[k]);
      }
      return obj;
    });

    if (isExport) {
      return res.json(mapped);
    }

    const totalCountQuery = await orm.select({ count: sql`count(*)`.mapWith(Number) })
      .from(items)
      .where(whereClause);

    const total = totalCountQuery[0].count;

    res.json({
      data: mapped,
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 1
    });
  } catch (err) {
    throw err;
  }
}));

// POST /items
router.post('/items', authorize('admin', 'manager', 'products.create'), validate(itemCreateUpdateSchema), asyncHandler(async (req, res) => {
  try {
    const { insertedId, stockValues, computedStock, imageUrl, thumbnailUrl } = await ItemCatalogService.createItem(
      req.body,
      req.user
    );

    const { type, name, code, unit, category, reorder_point, weighted_average_cost, color, weight, material, size } = req.body;

    const responseStock: Record<string, number> = {};
    for (const k of Object.keys(stockValues)) responseStock[`stock_${k}`] = stockValues[k];

    // V2.0.0: سند افتتاحیه موجودی اولیه — ورکفلو شرطی
    // اگر تعریف workflow فعال برای entityType «item» باشد، سند افتتاحیه بعد از تأیید نهایی صادر می‌شود
    // در غیر این صورت فوری صادر می‌شود (رفتار مستقیم)
    let openingVoucherId: number | null = null;
    try {
      const wfInstance = await WorkflowEngineService.maybeStartWorkflow({
        entityType: 'item',
        entityId: String(insertedId),
        userId: req.user?.id,
        userName: req.user?.fullName || req.user?.username
      });
      if (!wfInstance) {
        const opening = await ItemOpeningService.issueItemOpeningVoucher(insertedId, {
          userId: req.user?.id,
          username: req.user?.fullName || req.user?.username
        });
        openingVoucherId = opening?.id || null;
      }
    } catch (openingErr) {
      logger.warn({ message: `Item opening voucher for ${insertedId} failed/deferred`, error: openingErr });
    }

    await logActivity({
      req,
      action: 'CREATE',
      entity: 'کالا',
      entityId: insertedId,
      description: `تعریف کالای جدید "${name}" با کد "${code}"`,
      details: {
        after: {
          id: insertedId,
          name,
          code,
          type,
          category,
          unit,
          currentStock: computedStock,
          stocks: stockValues,
          reorderPoint: Number(reorder_point || 0),
          weightedAverageCost: Number(weighted_average_cost || 0),
          color,
          weight,
          material,
          size
        }
      }
    });

    res.json({ id: insertedId, type, name, code, current_stock: computedStock, unit, category, image: imageUrl, thumbnail: thumbnailUrl, ...responseStock, reorder_point, weighted_average_cost, color, weight, material, size, opening_voucher_id: openingVoucherId });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      // V9-1.2: خطای یکتایی کد کالا (پنجره رقابتی بین بررسی و درج) — پیام راهنما برای دریافت کد جدید
      return res.status(400).json({ error: 'کد کالا هم‌اکنون توسط کاربر دیگری ثبت شد. لطفاً کد جدیدی از دکمه «کد پیشنهادی» دریافت کرده و مجدداً ذخیره کنید.' });
    }
    throw err;
  }
}));

// PUT /items/:id
router.put('/items/:id', authorize('admin', 'manager', 'products.edit'), validate(itemUpdateSchema), asyncHandler(async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { name, code, unit, category, reorder_point, color, weight, material, size } = req.body;

    const result = await ItemCatalogService.updateItem(
      itemId,
      req.body,
      {
        id: req.user?.id,
        username: req.user?.username,
        fullName: req.user?.fullName
      }
    );

    const { diff, hasChanges } = computeAuditDiff(result.prevItem, { ...result.prevItem, ...result.updateData }, ['image', 'thumbnail', 'updatedAt', 'stocks']);

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'کالا',
      entityId: itemId,
      description: `ویرایش اطلاعات کالای "${name}" (کد: ${code})${result.canSetOpening && result.computedStock > 0 ? ` همراه با ثبت موجودی افتتاحیه (${result.computedStock} ${unit})` : ''}`,
      details: {
        before: {
          name: result.prevItem.name,
          code: result.prevItem.code,
          category: result.prevItem.category,
          unit: result.prevItem.unit,
          currentStock: result.prevItem.currentStock,
          reorderPoint: result.prevItem.reorderPoint,
          weightedAverageCost: result.prevItem.weightedAverageCost,
          color: result.prevItem.color,
          weight: result.prevItem.weight,
          material: result.prevItem.material,
          size: result.prevItem.size
        },
        after: {
          name,
          code,
          category: category || '',
          unit,
          currentStock: result.canSetOpening && result.computedStock > 0 ? result.computedStock : result.prevItem.currentStock,
          reorderPoint: Number(reorder_point || 0),
          weightedAverageCost: result.updateData.weightedAverageCost,
          color: color || null,
          weight: weight ? Number(weight) : null,
          material: material || null,
          size: size || null
        },
        changes: diff,
        hasChanges
      }
    });

    res.json({ success: true, opening_voucher_id: result.openingVoucherId });
  } catch (err) {
    const errorObj = err as { name?: string; code?: string; expectedVersion?: number; currentVersion?: number } | null;
    if (errorObj?.name === 'OptimisticLockError') {
      return res.status(409).json({
        error: 'تداخل همزمانی: کالا توسط کاربر دیگری ویرایش شده است. لطفاً صفحه را بازخوانی کنید.',
        code: 'OCC_CONFLICT',
        details: {
          expectedVersion: errorObj.expectedVersion,
          currentVersion: errorObj.currentVersion
        }
      });
    }
    if (errorObj?.code === '23505') {
      return res.status(400).json({ error: 'کد کالا تکراری است.' });
    }
    throw err;
  }
}));

// DELETE /items/:id
router.delete('/items/:id', authorize('admin', 'products.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const stockBeforeDelete = await ItemWarehouseStockService.getStockSnapshot(orm, itemId);
    const delItem = await ItemCatalogService.deleteItem(itemId);

    await logActivity({
      req,
      action: 'DELETE',
      entity: 'کالا',
      entityId: itemId,
      description: `حذف کالای "${delItem.name}" با کد "${delItem.code}" (موجودی کل: ${delItem.currentStock || 0})`,
      details: {
        before: {
          id: delItem.id,
          name: delItem.name,
          code: delItem.code,
          type: delItem.type,
          category: delItem.category,
          unit: delItem.unit,
          currentStock: delItem.currentStock,
          stocks: stockBeforeDelete.byCode,
          weightedAverageCost: delItem.weightedAverageCost,
          reorderPoint: delItem.reorderPoint
        },
        deletedAt: new Date().toISOString()
      }
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
}));

// V10-2.1: endpoint واحد اتمیک کد بعدی کالا
// GET = peek (بدون مصرف شمارنده — برای پیشنهاد خودکار فرم)
// POST = consume (تخصیص اتمیک شماره سری — قفل سطر شمارنده + UPSERT، مقاوم به race)
router.get('/items/next-code', authorizePermission(...READ_PERMISSIONS.items), asyncHandler(async (req, res) => {
  const { type, year, prefix, transfer } = req.query as Record<string, string>;
  const result = await ItemCatalogService.peekNextItemCode({ type, year, prefix, transfer });
  res.json(result);
}));

router.post('/items/next-code', authorize('admin', 'manager', 'products.create', 'products.edit'), asyncHandler(async (req, res) => {
  const { type, year, prefix, transfer } = req.body || {};
  const result = await ItemCatalogService.consumeNextItemCode({ type, year, prefix, transfer });
  await logActivity({
    req,
    action: 'CREATE',
    entity: 'کد کالا',
    description: `تخصیص اتمیک شماره سری بعدی کد «${result.code}» (نوع: ${result.type})`,
    details: { reserved: result }
  });
  res.json(result);
}));

export default router;
