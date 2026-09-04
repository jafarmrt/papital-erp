import { Router } from 'express';
import { sql, eq, and, desc, ilike, or, gt } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { items, warehouses, transactions, documentItems } from '../db/schema.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { checkOccVersion, nextVersion } from '../lib/occHelper.js';
import { MAX_PAGE_LIMIT } from '../lib/pagination.js';
import { businessTodayIsoDate } from '../lib/businessClock.js';
import { ItemsService } from '../services/items.service.js';
import { ItemOpeningService } from '../services/inventory/itemOpening.service.js';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService.js';
import { logger } from '../middleware/logger.js';
import { ItemCatalogService } from '../services/items/itemCatalog.service.js';

const router = Router();

export const itemCreateUpdateSchema = z.object({
  body: z.preprocess((val: unknown) => {
    if (val && typeof val === 'object') {
      const copy = { ...(val as Record<string, unknown>) };
      for (const k of Object.keys(copy)) {
        if (k.startsWith('stock_')) {
          delete copy[k];
        }
      }
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
    color: z.string().optional(),
    weight: z.union([z.string(), z.number()]).optional(),
    material: z.string().optional(),
    size: z.string().optional()
  }))
});

export const itemUpdateSchema = z.object({
  body: itemCreateUpdateSchema.shape.body,
  params: z.object({
    id: numericIdString
  })
});

// GET /items/reorder-alerts
router.get('/items/reorder-alerts', async (req, res) => {
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
        ilike(items.name, `%${search}%`),
        ilike(items.code, `%${search}%`),
        ilike(items.category, `%${search}%`)
      ));
    }

    const fetchedItems = await orm.select().from(items)
      .where(and(...conditions))
      .orderBy(items.currentStock);

    const mapped = fetchedItems.map(it => {
      const curStock = Number(it.currentStock || 0);
      const reorderPt = Number(it.reorderPoint || 0);
      const wac = Number(it.weightedAverageCost || 0);
      const deficit = Math.max(0, reorderPt - curStock);

      const obj: Record<string, unknown> = {
        ...it,
        current_stock: curStock,
        reorder_point: reorderPt,
        weighted_average_cost: wac,
        deficit,
        deficit_value: deficit * wac,
        is_zero_stock: curStock <= 0
      };

      const st = it.stocks as Record<string, unknown> | null;
      if (st) {
        for (const k of Object.keys(st)) {
          obj[`stock_${k}`] = Number(st[k] || 0);
        }
      }
      return obj;
    });

    res.json(mapped);
  } catch (err) {
    throw err;
  }
});

// GET /items
router.get('/items', async (req, res) => {
  try {
    await ItemsService.syncMissingWarehouseStocks();

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
        ilike(items.name, `%${search}%`),
        ilike(items.code, `%${search}%`)
      ));
    }

    const whereClause = and(...conditions);

    let query = orm.select().from(items).where(whereClause).orderBy(desc(items.id));

    if (!isExport && limit > 0) {
      query = query.limit(limit).offset(offset) as any;
    }

    const fetchedItems = await query;
    const reservedMap = await ItemsService.getReservedStocksMap();

    const mapped = fetchedItems.map(it => {
      const codeUpper = (it.code || '').trim().toUpperCase();
      const resInfo = reservedMap[codeUpper] || { totalReserved: 0, reservations: [] };
      const curStock = Number(it.currentStock || 0);
      const reservedStock = Number(resInfo.totalReserved || 0);
      const availableStock = Math.max(0, curStock - reservedStock);

      const obj: Record<string, unknown> = {
        ...it,
        current_stock: curStock,
        reorder_point: it.reorderPoint,
        weighted_average_cost: it.weightedAverageCost,
        reserved_stock: reservedStock,
        available_stock: availableStock,
        reservations: resInfo.reservations
      };
      const st = it.stocks as Record<string, unknown> | null;
      if (st) {
        for (const k of Object.keys(st)) {
          obj[`stock_${k}`] = Number(st[k]);
        }
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
});

// POST /items
router.post('/items', authorize('admin', 'manager'), validate(itemCreateUpdateSchema), async (req, res) => {
  try {
    const { type, name, code, unit, category, image, thumbnail, reorder_point, weighted_average_cost, color, weight, material, size } = req.body;

    const [existing] = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0)));
    if (existing) {
      return res.status(400).json({ error: 'کد کالا تکراری است و مجاز به استفاده مجدد نیستید.' });
    }

    const whs = await orm.select({ code: warehouses.code }).from(warehouses);
    let computedStock = 0;
    const stockValues: Record<string, number> = {};

    for (const wh of whs) {
      const bodyKey = `stock_${wh.code}`;
      const val = req.body[bodyKey] !== undefined ? Number(req.body[bodyKey]) : 0;
      stockValues[wh.code] = val;
      computedStock += val;
    }

    const currentStockBody = Number(req.body.current_stock || 0);
    if (computedStock === 0 && currentStockBody > 0 && whs.length > 0) {
      const defaultWh = whs[0].code;
      stockValues[defaultWh] = currentStockBody;
      computedStock = currentStockBody;
    }

    const imageUrl = image ? await uploadBase64ToStorage(image, 'image') : '';
    const thumbnailUrl = thumbnail ? await uploadBase64ToStorage(thumbnail, 'thumbnail') : '';

    const [existingName] = await orm.select({ id: items.id, code: items.code }).from(items)
      .where(and(eq(items.name, name), eq(items.isDeleted, 0)));
    if (existingName) {
      return res.status(400).json({ error: `محصولی با نام «${name}» قبلاً با کد «${existingName.code}» در سیستم ثبت شده است. ثبت دو محصول با نام مشابه امکان‌پذیر نیست.` });
    }

    const insertedId = await orm.transaction(async (tx) => {
      const [inserted] = await tx.insert(items).values({
        type, name, code, unit, category: category || '', image: imageUrl, thumbnail: thumbnailUrl,
        reorderPoint: Number(reorder_point || 0), weightedAverageCost: Number(weighted_average_cost || 0),
        color: color || null, weight: weight ? Number(weight) : null, material: material || null, size: size || null,
        currentStock: computedStock,
        stocks: stockValues,
        isDeleted: 0
      }).returning({ id: items.id });

      if (computedStock > 0) {
        for (const whCode of Object.keys(stockValues)) {
          const qty = stockValues[whCode];
          if (qty > 0) {
            await tx.insert(transactions).values({
              itemId: inserted.id,
              type: 'in',
              quantity: qty,
              // V2.0.0: قیمت واحد = WAC ثبت‌شده (قبلاً صفر بود و WAC/ارزش انبار خراب می‌شد)
              unitPrice: Number(weighted_average_cost) || 0,
              date: await businessTodayIsoDate(),
              documentType: 'audit',
              documentRef: 'ثبت اولیه کالا',
              location: whCode,
              notes: 'موجودی اولیه هنگام تعریف کالا',
              createdBy: req.user?.username || 'admin',
              isDeleted: 0
            });
          }
        }
      }
      return inserted.id;
    });

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
});

// PUT /items/:id
router.put('/items/:id', authorize('admin', 'manager'), validate(itemUpdateSchema), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { name, code, unit, category, image, thumbnail, reorder_point, weighted_average_cost, color, weight, material, size } = req.body;

    const [prevItem] = await orm.select().from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));
    if (!prevItem) {
      return res.status(404).json({ error: 'کالا یافت نشد.' });
    }

    if (req.body.version !== undefined || req.body.expectedVersion !== undefined) {
      checkOccVersion(prevItem, {
        entityType: 'Item',
        entityId: itemId,
        expectedVersion: Number(req.body.expectedVersion ?? req.body.version)
      });
    }

    const [existingCode] = await orm.select({ id: items.id }).from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0)));
    if (existingCode && existingCode.id !== itemId) {
      return res.status(400).json({ error: 'کد کالا تکراری است و متعلق به محصول دیگری می باشد.' });
    }

    const [existingName] = await orm.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.name, name), eq(items.isDeleted, 0)));
    if (existingName && existingName.id !== itemId) {
      return res.status(400).json({ error: `محصول دیگری با نام «${name}» (کد: ${existingName.code}) در سیستم موجود است. ثبت دو محصول با نام یکسان امکان‌پذیر نیست.` });
    }

    const imageUrl = image ? await uploadBase64ToStorage(image, 'image') : undefined;
    const thumbnailUrl = thumbnail ? await uploadBase64ToStorage(thumbnail, 'thumbnail') : undefined;

    const updateData: Partial<typeof items.$inferInsert> = {
      name, code, unit, category: category || '',
      reorderPoint: Number(reorder_point || 0),
      // V2.0.0: محافظت از WAC — فقط اگر مقدار جدید ارائه شده باشد به‌روزرسانی شود
      // (قبلاً هر ویرایش فرم WAC موجود را صفر می‌کرد)
      weightedAverageCost: weighted_average_cost !== undefined && weighted_average_cost !== ''
        ? Number(weighted_average_cost) || 0
        : Number(prevItem.weightedAverageCost || 0),
      color: color || null, weight: weight ? Number(weight) : null, material: material || null, size: size || null,
      version: nextVersion(prevItem.version)
    };

    if (imageUrl !== undefined) updateData.image = imageUrl;
    if (thumbnailUrl !== undefined) updateData.thumbnail = thumbnailUrl;

    await orm.update(items).set(updateData).where(eq(items.id, itemId));

    const { diff, hasChanges } = computeAuditDiff(prevItem, { ...prevItem, ...updateData }, ['image', 'thumbnail', 'updatedAt', 'stocks']);

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'کالا',
      entityId: itemId,
      description: `ویرایش اطلاعات کالای "${name}" (کد: ${code})`,
      details: {
        before: {
          name: prevItem.name,
          code: prevItem.code,
          category: prevItem.category,
          unit: prevItem.unit,
          reorderPoint: prevItem.reorderPoint,
          weightedAverageCost: prevItem.weightedAverageCost,
          color: prevItem.color,
          weight: prevItem.weight,
          material: prevItem.material,
          size: prevItem.size
        },
        after: {
          name,
          code,
          category: category || '',
          unit,
          reorderPoint: Number(reorder_point || 0),
          weightedAverageCost: Number(weighted_average_cost || 0),
          color: color || null,
          weight: weight ? Number(weight) : null,
          material: material || null,
          size: size || null
        },
        changes: diff,
        hasChanges
      }
    });

    res.json({ success: true });
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
});

// DELETE /items/:id
router.delete('/items/:id', authorize('admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const [delItem] = await orm.select().from(items).where(eq(items.id, itemId));
    if (!delItem || delItem.isDeleted === 1) {
      return res.status(404).json({ error: 'کالا یافت نشد.' });
    }

    // V9-2.2: منع حذف کالای دارای موجودی — ارزش موجودی از ارزیابی انبار حذف می‌شود اما ردیف‌های کاردکس باقی می‌مانند
    const currentStockNum = Number(delItem.currentStock || 0);
    if (currentStockNum > 0) {
      return res.status(409).json({
        error: `حذف کالای «${delItem.name}» مجاز نیست زیرا دارای ${currentStockNum} ${delItem.unit || 'عدد'} موجودی در انبار است. ابتدا موجودی را از طریق سند انبارگردانی یا حواله به صفر برسانید.`
      });
    }

    // V9-2.2: منع حذف کالای دارای ارجاع در اسناد فعال (غیرحذف‌شده)
    const [{ count: activeDocRefs }] = await orm
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(documentItems)
      .where(and(eq(documentItems.itemId, itemId), eq(documentItems.isDeleted, 0)));
    if (activeDocRefs > 0) {
      return res.status(409).json({
        error: `حذف کالای «${delItem.name}» مجاز نیست زیرا در ${activeDocRefs} ردیف سند فعال (فاکتور/رسید/حواله) استفاده شده است. برای حفظ یکپارچگی تاریخچه اسناد، ابتدا باید اسناد مرتبط حذف شوند.`
      });
    }

    await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, itemId));

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
          stocks: delItem.stocks,
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
});

// V10-2.1: endpoint واحد اتمیک کد بعدی کالا
// GET = peek (بدون مصرف شمارنده — برای پیشنهاد خودکار فرم)
// POST = consume (تخصیص اتمیک شماره سری — قفل سطر شمارنده + UPSERT، مقاوم به race)
router.get('/items/next-code', asyncHandler(async (req, res) => {
  const { type, year, prefix, transfer } = req.query as Record<string, string>;
  const result = await ItemCatalogService.peekNextItemCode({ type, year, prefix, transfer });
  res.json(result);
}));

router.post('/items/next-code', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
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
