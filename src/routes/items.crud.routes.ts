import { Router } from 'express';
import { sql, eq, and, desc, inArray } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { items, transactions, documentItems } from '../db/schema.js';
import { authorizePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { z } from 'zod';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { itemCreateUpdateSchema, itemUpdateSchema } from './items.schemas.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { MAX_PAGE_LIMIT, parsePickListLimit } from '../lib/pagination.js';
import { ItemsService } from '../services/items.service.js';
import { ItemOpeningService, itemIdsWithOpeningVoucher } from '../services/inventory/itemOpening.service.js';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService.js';
import { ItemCatalogService } from '../services/items/itemCatalog.service.js';
import { resolveWarehouseCode } from '../services/inventory/warehouseResolver.js';
import { ItemWarehouseStockService } from '../services/inventory/itemWarehouseStock.service.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { itemListConditions, listItemPicks } from '../services/items/itemPickList.js';
import { listReorderAlerts } from '../services/items/reorderAlerts.service.js';

const router = Router();

// GET /items/reorder-alerts
// v9.0.404 (TD-843): free stock (stock − reservations) against the reorder point, with the open purchases shown as «در راه»
router.get('/items/reorder-alerts', authorizePermission(...READ_PERMISSIONS.itemReorderAlerts), asyncHandler(async (req, res) => {
  res.json(await listReorderAlerts({
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    zeroStock: req.query.zero_stock === 'true',
  }));
}));

const itemPickListValidation = z.object({
  query: z.object({
    type: z.enum(['product', 'raw_material', 'all']).optional(),
    search: z.string().max(200).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

// v9.0.138 (TD-888، تصمیم ت۱۰ الف): فهرست انتخاب کالا برای فرم‌های بخش‌های دیگر؛ فهرست کامل پایین فقط با مجوز بخش کالا
router.get('/items/options', authorizePermission(...READ_PERMISSIONS.itemOptions), validate(itemPickListValidation), asyncHandler(async (req, res) => {
  const query = req.query as { type?: string; search?: string; limit?: string };
  res.json({ success: true, data: await listItemPicks(req.user, { type: query.type, search: query.search, limit: parsePickListLimit(query.limit) }) });
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

    const whereClause = itemListConditions(type, search);

    let query = orm.select().from(items).where(whereClause).orderBy(desc(items.id)).$dynamic();

    if (!isExport && limit > 0) {
      query = query.limit(limit).offset(offset);
    }

    const fetchedItems = await query;
    // v9.0.206 (TD-663، B05-17): رزرو فقط برای کالاهای همین صفحه
    const reservedMap = await ItemsService.getReservedStocksMap({ itemIds: fetchedItems.map(it => it.id) });
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
        // v9.0.206 (TD-663): سند افتتاحیه کالا (سند خودش یا سند ورود اکسل) از جدول کالاهای سند افتتاحیه
        itemIdsWithOpeningVoucher(orm, itemIds),
      ]);

      txItemSet = new Set(txRows.map(r => r.itemId));
      docItemSet = new Set(docRows.map(r => r.itemId));
      voucherItemSet = voucherRows;
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
      // v9.0.374 (TD-822): رزرو با شناسه کالا، نه کد بزرگ‌شده
      const resInfo = reservedMap[String(it.id)] || { totalReserved: 0, reservations: [] };
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
router.post('/items', authorizePermission('products.create'), validate(itemCreateUpdateSchema), asyncHandler(async (req, res) => {
  // v9.0.36 (TD-451): کالا و شروع گردش‌کار افتتاحیه در یک تراکنش؛ شروع ناموفقِ تعریف فعال ثبت کالا را رد می‌کند.
  // v9.0.169 (TD-652، تصمیم ت۶ الف): سند افتتاحیه و ردیف ممیزی هم درون همان تراکنش‌اند و شکست سند ثبت کالا و موجودی اولیه‌اش
  // را رد می‌کند، مثل ویرایش کالا و ورود اکسل. پیش‌تر سند بیرون از تراکنش صادر و شکستش با `logger.warn` بلعیده می‌شد: کالا با
  // موجودی در کاردکس ثبت می‌شد و دفتر کل تغییری نمی‌کرد.
  const { name, code } = req.body;
  const { created, openingVoucherId } = await orm.transaction(async (tx) => {
    const created = await ItemCatalogService.createItem(req.body, req.user, tx);
    const wfInstance = await WorkflowEngineService.maybeStartWorkflow({
      entityType: 'item',
      entityId: String(created.insertedId),
      userId: req.user?.id,
      userName: req.user?.fullName || req.user?.username,
      tx
    });
    // با تعریف گردش‌کار فعال برای «item» سند افتتاحیه پس از تأیید نهایی صادر می‌شود، وگرنه همین‌جا
    const opening = wfInstance ? null : await ItemOpeningService.issueItemOpeningVoucher(created.insertedId, {
      userId: req.user?.id,
      username: req.user?.fullName || req.user?.username,
      tx
    });
    const it = created.item;
    await logActivity({
      req,
      tx,
      action: 'CREATE',
      entity: 'کالا',
      entityId: created.insertedId,
      description: `تعریف کالای جدید "${name}" با کد "${code}"`,
      details: {
        after: {
          id: created.insertedId,
          name: it.name,
          code: it.code,
          type: it.type,
          category: it.category,
          unit: it.unit,
          currentStock: created.computedStock,
          stocks: created.stockValues,
          reorderPoint: Number(it.reorderPoint ?? 0),
          weightedAverageCost: Number(it.weightedAverageCost ?? 0),
          color: it.color,
          weight: it.weight,
          material: it.material,
          size: it.size
        },
        openingVoucherId: opening?.id ?? null
      }
    });
    return { created, openingVoucherId: opening?.id ?? null };
  });

  const { insertedId, stockValues, computedStock, imageUrl, thumbnailUrl, item } = created;
  const responseStock: Record<string, number> = {};
  for (const k of Object.keys(stockValues)) responseStock[`stock_${k}`] = stockValues[k];
  res.json({
    id: insertedId, type: item.type, name: item.name, code: item.code, current_stock: computedStock, unit: item.unit, category: item.category,
    image: imageUrl, thumbnail: thumbnailUrl, ...responseStock, reorder_point: item.reorderPoint, weighted_average_cost: item.weightedAverageCost,
    color: item.color, weight: item.weight, material: item.material, size: item.size, opening_voucher_id: openingVoucherId
  });
}));

// PUT /items/:id
// v9.0.171 (TD-654): نسخه کالا لازم است (۴۰۰ بی آن، ۴۰۹ OCC_CONFLICT برای نسخه کهنه) و ردیف ممیزی درون همان تراکنش نوشته می‌شود
router.put('/items/:id', authorizePermission('products.edit'), validate(itemUpdateSchema), asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);
  const result = await orm.transaction(async (tx) => {
    const result = await ItemCatalogService.updateItem(itemId, req.body, {
      id: req.user?.id,
      username: req.user?.username,
      fullName: req.user?.fullName
    }, tx);
    const prev = result.prevItem;
    const next = result.item;
    const snapshot = (it: typeof prev) => ({
      name: it.name,
      code: it.code,
      category: it.category,
      unit: it.unit,
      currentStock: it.currentStock,
      reorderPoint: it.reorderPoint,
      weightedAverageCost: it.weightedAverageCost,
      color: it.color,
      weight: it.weight,
      material: it.material,
      size: it.size
    });
    const { diff, hasChanges } = computeAuditDiff(prev, { ...prev, ...result.updateData }, ['image', 'thumbnail', 'updatedAt', 'stocks', 'version']);
    const openingNote = result.canSetOpening && result.computedStock > 0 ? ` همراه با ثبت موجودی افتتاحیه (${result.computedStock} ${next.unit})` : '';
    await logActivity({
      req,
      tx,
      action: 'UPDATE',
      entity: 'کالا',
      entityId: itemId,
      description: `ویرایش اطلاعات کالای "${next.name}" (کد: ${next.code})${openingNote}`,
      details: { before: snapshot(prev), after: snapshot(next), changes: diff, hasChanges, version: next.version }
    });
    return result;
  });
  res.json({ success: true, version: result.item.version, opening_voucher_id: result.openingVoucherId });
}));

// DELETE /items/:id
router.delete('/items/:id', authorizePermission('products.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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

router.post('/items/next-code', authorizePermission('products.create', 'products.edit'), asyncHandler(async (req, res) => {
  const { type, year, prefix, transfer } = req.body || {};
  const result = await ItemCatalogService.consumeNextItemCode({ type, year, prefix, transfer });
  await logActivity({
    req,
    action: 'CREATE',
    entity: 'کد کالا',
    description: `تخصیص بی‌تداخل شماره سری بعدی کد «${result.code}» (نوع: ${result.type})`,
    details: { reserved: result }
  });
  res.json(result);
}));

export default router;
