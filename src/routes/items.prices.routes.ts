import { Router } from 'express';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { items, itemPrices } from '../db/schema.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { logActivity } from '../lib/auditLogger.js';
import { ItemsService } from '../services/items.service.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey, formatStrategyDisplayTitle } from '../utils.js';

const router = Router();

export const itemPriceSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان قیمت الزامی است'),
    price: z.union([z.string(), z.number()]),
    currency: z.string().optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

const itemPriceDeleteSchema = z.object({
  params: z.object({
    id: numericIdString,
    priceId: numericIdString
  })
});

export const batchPriceUpdateSchema = z.object({
  body: z.object({
    updates: z.array(z.object({
      itemId: z.union([z.number(), z.string()]),
      title: z.string().min(1, 'عنوان قیمت الزامی است'),
      price: z.union([z.number(), z.string(), z.null()]).optional(),
      currency: z.string().optional()
    })).min(1, 'لیست تغییرات قیمت خالی است')
  })
});

// GET /items/prices/all
router.get('/items/prices/all', async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(eq(itemPrices.isDeleted, 0));
    const activeStrategies = await ItemsService.getPricingStrategies();
    const activePrices = ItemsService.filterActivePrices(prices, activeStrategies);

    const grouped: Record<number, any[]> = {};
    for (const p of activePrices) {
      if (!grouped[p.itemId]) grouped[p.itemId] = [];
      grouped[p.itemId].push(p);
    }
    res.json(grouped);
  } catch (err: any) {
    throw err;
  }
});

// GET /items/:id/prices
router.get('/items/:id/prices', validate(paramsIdSchema), async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(and(eq(itemPrices.itemId, Number(req.params.id)), eq(itemPrices.isDeleted, 0)));
    const activeStrategies = await ItemsService.getPricingStrategies();
    const activePrices = ItemsService.filterActivePrices(prices, activeStrategies);
    res.json(activePrices);
  } catch (err: any) {
    throw err;
  }
});

// GET /items/:id/prices/history
router.get('/items/:id/prices/history', validate(paramsIdSchema), async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(eq(itemPrices.itemId, Number(req.params.id))).orderBy(desc(itemPrices.id));
    res.json(prices);
  } catch (err: any) {
    throw err;
  }
});

// POST /items/:id/prices
router.post('/items/:id/prices', authorize('admin', 'manager'), validate(itemPriceSchema), async (req, res) => {
  try {
    const { title, price, currency = 'IRR' } = req.body;
    const itemId = Number(req.params.id);
    const cleanTitle = normalizeStrategyTitle(String(title));
    const canKey = getStrategyCanonicalKey(cleanTitle);

    const [targetItem] = await orm.select({ id: items.id, name: items.name, code: items.code })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));

    if (!targetItem) {
      return res.status(404).json({ error: 'کالای مورد نظر یافت نشد یا حذف شده است' });
    }

    const existingPrices = await orm.select()
      .from(itemPrices)
      .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)));

    const matchingActive = existingPrices.filter(p => getStrategyCanonicalKey(p.title) === canKey);
    const nowIso = new Date().toISOString();

    for (const m of matchingActive) {
      await orm.update(itemPrices)
        .set({ isDeleted: 1, updatedAt: nowIso })
        .where(eq(itemPrices.id, m.id));
    }

    const [inserted] = await orm.insert(itemPrices).values({
      itemId,
      title: cleanTitle,
      price: Number(price),
      currency: String(currency || 'IRR'),
      createdAt: nowIso,
      updatedAt: nowIso,
      isDeleted: 0
    }).returning({ id: itemPrices.id });

    await logActivity({
      req,
      action: 'UPDATE',
      entity: 'قیمت کالا',
      entityId: itemId,
      description: `تنظیم قیمت "${cleanTitle}" برای کالای "${targetItem.name}" به مبلغ ${price} ${currency}`,
      details: {
        itemId,
        itemCode: targetItem.code,
        itemName: targetItem.name,
        title: cleanTitle,
        currency,
        before: matchingActive[0] ? { price: matchingActive[0].price, currency: matchingActive[0].currency } : null,
        after: { price: Number(price), currency: String(currency || 'IRR') }
      }
    });

    res.json({ id: inserted.id, itemId, title: cleanTitle, price: Number(price), currency });
  } catch (err: any) {
    throw err;
  }
});

// DELETE /items/:id/prices/:priceId
router.delete('/items/:id/prices/:priceId', authorize('admin', 'manager'), validate(itemPriceDeleteSchema), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const priceId = Number(req.params.priceId);

    const [targetItem] = await orm.select({ id: items.id, name: items.name, code: items.code })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));

    const [existingPrice] = await orm.select()
      .from(itemPrices)
      .where(and(eq(itemPrices.id, priceId), eq(itemPrices.itemId, itemId)));

    await orm.update(itemPrices)
      .set({ isDeleted: 1, updatedAt: new Date().toISOString() })
      .where(and(eq(itemPrices.id, priceId), eq(itemPrices.itemId, itemId)));

    if (existingPrice) {
      await logActivity({
        req,
        action: 'DELETE',
        entity: 'قیمت کالا',
        entityId: itemId,
        description: `حذف قیمت سطح "${existingPrice.title}" برای کالای "${targetItem?.name || itemId}"`,
        details: {
          itemId,
          itemCode: targetItem?.code,
          itemName: targetItem?.name,
          title: existingPrice.title,
          before: { price: existingPrice.price, currency: existingPrice.currency }
        }
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    throw err;
  }
});

// POST /items/prices/batch-update
router.post('/items/prices/batch-update', authorize('admin', 'manager'), validate(batchPriceUpdateSchema), async (req, res) => {
  try {
    const { updates } = req.body;
    const nowIso = new Date().toISOString();
    const auditChanges: any[] = [];

    await orm.transaction(async (tx) => {
      const itemIds = Array.from(new Set(updates.map((u: any) => Number(u.itemId)).filter((id: any) => Boolean(id) && !isNaN(id)))) as number[];
      if (itemIds.length === 0) return;

      const validItems = await tx.select({ id: items.id, name: items.name, code: items.code })
        .from(items)
        .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0)));
      const validItemMap = new Map<number, { id: number; name: string; code: string }>(validItems.map(i => [i.id, i]));

      for (const item of updates) {
        const { itemId, title, price, currency = 'IRR' } = item;
        const numItemId = Number(itemId);
        const itemObj = validItemMap.get(numItemId);
        if (!numItemId || !title || !itemObj) continue;

        const cleanTitle = normalizeStrategyTitle(String(title));
        const canKey = getStrategyCanonicalKey(cleanTitle);

        const existingList = await tx.select()
          .from(itemPrices)
          .where(and(eq(itemPrices.itemId, numItemId), eq(itemPrices.isDeleted, 0)))
          .for('update');

        const matchingActive = existingList.filter(p => getStrategyCanonicalKey(p.title) === canKey);

        if (price === null || price === undefined || price === '' || Number(price) <= 0) {
          if (matchingActive.length > 0) {
            for (const m of matchingActive) {
              await tx.update(itemPrices)
                .set({ isDeleted: 1, updatedAt: nowIso })
                .where(eq(itemPrices.id, m.id));
            }
            auditChanges.push({
              itemId: numItemId,
              itemCode: itemObj.code,
              itemName: itemObj.name,
              title: cleanTitle,
              beforePrice: matchingActive[0].price,
              afterPrice: 0,
              action: 'DELETED'
            });
          }
        } else {
          const numPrice = Number(price);
          const strCurrency = String(currency || 'IRR');
          const primaryActive = matchingActive[0];

          if (primaryActive) {
            if (primaryActive.price !== numPrice || primaryActive.currency !== strCurrency) {
              for (const m of matchingActive) {
                await tx.update(itemPrices)
                  .set({ isDeleted: 1, updatedAt: nowIso })
                  .where(eq(itemPrices.id, m.id));
              }
              await tx.insert(itemPrices).values({
                itemId: numItemId,
                title: cleanTitle,
                price: numPrice,
                currency: strCurrency,
                createdAt: nowIso,
                updatedAt: nowIso,
                isDeleted: 0
              });
              auditChanges.push({
                itemId: numItemId,
                itemCode: itemObj.code,
                itemName: itemObj.name,
                title: cleanTitle,
                beforePrice: primaryActive.price,
                afterPrice: numPrice,
                currency: strCurrency,
                action: 'UPDATED'
              });
            }
          } else {
            await tx.insert(itemPrices).values({
              itemId: numItemId,
              title: cleanTitle,
              price: numPrice,
              currency: strCurrency,
              createdAt: nowIso,
              updatedAt: nowIso,
              isDeleted: 0
            });
            auditChanges.push({
              itemId: numItemId,
              itemCode: itemObj.code,
              itemName: itemObj.name,
              title: cleanTitle,
              beforePrice: null,
              afterPrice: numPrice,
              currency: strCurrency,
              action: 'CREATED'
            });
          }
        }
      }
    });

    if (auditChanges.length > 0) {
      await logActivity({
        req,
        action: 'UPDATE',
        entity: 'قیمت کالا',
        description: `به‌روزرسانی دسته‌ای ${auditChanges.length} قیمت کالا در سامانه`,
        details: {
          totalModified: auditChanges.length,
          changes: auditChanges
        }
      });
    }

    res.json({ success: true, count: updates.length });
  } catch (err: any) {
    logger.error({ message: 'Error in batch price update', error: err });
    throw err;
  }
});

export default router;
