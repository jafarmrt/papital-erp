import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { eq, and, desc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { itemPrices } from '../db/schema.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, decimalInput } from '../middleware/validate.js';
import { fin } from '../lib/financialDecimal.js';
import { PRICE_AMOUNT_MESSAGE, PRICE_CURRENCIES, PRICE_CURRENCY_MESSAGE, normalizePriceCurrency } from '../lib/items/priceInput.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { ItemsService } from '../services/items.service.js';
import { ItemPricingService } from '../services/items/itemPricing.service.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { priceListMatcher } from '../lib/items/excelPriceColumns.js';
import { NotFoundError, ValidationError } from '../errors/customErrors.js';
import { listPricingPage } from '../services/items/pricingPage.js';
import { PRICING_PAGE_MAX_LIMIT, PRICING_PAGE_SIZE, PRICING_PRICE_FILTERS } from '../lib/items/pricingPage.js';

const router = Router();

function unknownPriceListError(titles: string[]): ValidationError {
  return new ValidationError(
    `«${titles.join('»، «')}» فهرست قیمت تنظیم‌شده‌ای نیست. قیمت فقط برای فهرست‌های قیمت تعریف‌شده در تنظیمات ثبت می‌شود.`,
    { titles },
    'PRICE_LIST_NOT_CONFIGURED',
  );
}

/**
 * v9.0.176 (TD-657 بخش قیمت، تصمیم ت۹ الف): مبلغ قیمت با `decimalInput` و بزرگ‌تر از صفر، ارز فقط از فهرست AGENTS §6
 * (`PRICE_CURRENCIES`)، و حذف قیمت در `batch-update` فقط با `remove: true`. پیش‌تر قیمت منفی ذخیره، «abc» صفر و قیمت صفر
 * یا خالی حذف می‌شد (صفحه قیمت‌گذاری برای عدد نامعتبر صفر می‌فرستاد و قیمت را پاک می‌کرد) و ارز «XYZ» پذیرفته می‌شد.
 */
const priceAmount = decimalInput('قیمت')
  .refine(v => v !== undefined, 'قیمت الزامی است')
  .refine(v => v === undefined || fin(v).isPositive(), PRICE_AMOUNT_MESSAGE);
const priceCurrency = z.preprocess(normalizePriceCurrency, z.enum(PRICE_CURRENCIES, { message: PRICE_CURRENCY_MESSAGE }));

export const itemPriceSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان قیمت الزامی است'),
    price: priceAmount,
    currency: priceCurrency
  }),
  params: z.object({
    id: numericIdString
  })
});

const batchPriceUpdate = z.object({
  itemId: z.coerce.number().int('شناسه کالا باید عدد صحیح باشد').positive('شناسه کالا باید مثبت باشد'),
  title: z.string().min(1, 'عنوان قیمت الزامی است'),
  remove: z.literal(true).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  currency: priceCurrency
}).superRefine((u, ctx) => {
  if (u.remove) {
    if (u.price !== undefined && u.price !== '') ctx.addIssue({ code: 'custom', path: ['price'], message: 'حذف قیمت مبلغ نمی‌گیرد.' });
    return;
  }
  const parsed = priceAmount.safeParse(u.price);
  if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['price'], message: parsed.error.issues[0]?.message ?? PRICE_AMOUNT_MESSAGE });
}).transform(u => ({ ...u, price: u.remove ? undefined : priceAmount.safeParse(u.price).data }));

export const batchPriceUpdateSchema = z.object({
  body: z.object({
    updates: z.array(batchPriceUpdate).min(1, 'فهرست تغییرات قیمت خالی است')
  })
});

// v10.0.33 (OBS-R1-79): یک صفحه از کالاهای صفحه قیمت‌گذاری با قیمت‌ها و فهرست‌های قیمت
const pricingPageSchema = z.object({
  query: z.object({
    type: z.enum(['product', 'raw_material']),
    search: z.string().max(200).optional(),
    category: z.string().max(200).optional(),
    priceFilter: z.enum(PRICING_PRICE_FILTERS).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(PRICING_PAGE_MAX_LIMIT).optional(),
    all: z.enum(['true', 'false']).optional(),
  }),
});

router.get('/items/pricing-page', authorizePermission(...READ_PERMISSIONS.itemPrices), validate(pricingPageSchema), asyncHandler(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof pricingPageSchema>['query'];
  res.json(await listPricingPage({
    type: q.type,
    search: q.search,
    category: q.category,
    priceFilter: q.priceFilter,
    page: q.page ? Number(q.page) : 1,
    limit: q.limit ? Number(q.limit) : PRICING_PAGE_SIZE,
    all: q.all === 'true',
  }));
}));

// GET /items/prices/all
router.get('/items/prices/all', authorizePermission(...READ_PERMISSIONS.itemPrices), asyncHandler(async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(eq(itemPrices.isDeleted, 0));
    const activeStrategies = await ItemsService.getPricingStrategies();
    const activePrices = ItemsService.filterActivePrices(prices, activeStrategies);

    const grouped: Record<number, Array<typeof itemPrices.$inferSelect>> = {};
    for (const p of activePrices) {
      const itId = Number(p.itemId || p.item_id);
      if (!itId) continue;
      if (!grouped[itId]) grouped[itId] = [];
      grouped[itId].push(p as typeof itemPrices.$inferSelect);
    }
    res.json(grouped);
  } catch (err) {
    throw err;
  }
}));

// GET /items/:id/prices
router.get('/items/:id/prices', authorizePermission(...READ_PERMISSIONS.itemSalePrices), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(and(eq(itemPrices.itemId, Number(req.params.id)), eq(itemPrices.isDeleted, 0)));
    const activeStrategies = await ItemsService.getPricingStrategies();
    const activePrices = ItemsService.filterActivePrices(prices, activeStrategies);
    res.json(activePrices);
  } catch (err) {
    throw err;
  }
}));

// GET /items/:id/prices/history
router.get('/items/:id/prices/history', authorizePermission(...READ_PERMISSIONS.itemPrices), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const prices = await orm.select().from(itemPrices).where(eq(itemPrices.itemId, Number(req.params.id))).orderBy(desc(itemPrices.id));
    res.json(prices);
  } catch (err) {
    throw err;
  }
}));

// POST /items/:id/prices
// v9.0.175 (TD-660): نوشتن در `ItemPricingService.applyPriceWrites`، درون تراکنش و زیر قفل ردیف کالا، با ردیف ممیزی در همان تراکنش
router.post('/items/:id/prices', authorizePermission('products.edit_price'), validate(itemPriceSchema), asyncHandler(async (req, res) => {
  const { title, price, currency = 'IRR' } = req.body;
  const itemId = Number(req.params.id);
  const saved = await orm.transaction(async (tx) => {
    const strategies = await ItemPricingService.getPricingStrategies(tx);
    // v9.0.152 (TD-647، ت۱ الف): فقط فهرست قیمت تنظیم‌شده
    const configuredTitle = priceListMatcher(strategies).match(String(title));
    if (!configuredTitle) throw unknownPriceListError([String(title)]);
    const result = await ItemPricingService.applyPriceWrites(tx, [{ itemId, title: configuredTitle, price, currency }], strategies);
    if (result.missingItemIds.length > 0) throw new NotFoundError('کالای مورد نظر یافت نشد یا حذف شده است');
    const change = result.changes[0];
    if (change) {
      await logActivity({
        req,
        tx,
        action: 'UPDATE',
        entity: 'قیمت کالا',
        entityId: itemId,
        description: `تنظیم قیمت "${configuredTitle}" برای کالای "${change.itemName}" به مبلغ ${price} ${currency}`,
        details: {
          itemId,
          itemCode: change.itemCode,
          itemName: change.itemName,
          title: configuredTitle,
          currency,
          before: change.beforePrice ? { price: change.beforePrice, currency: change.beforeCurrency } : null,
          after: { price: change.afterPrice, currency: change.currency }
        }
      });
    }
    return { id: result.priceIds[0], title: configuredTitle };
  });
  res.json({ id: saved.id, itemId, title: saved.title, price: Number(price), currency });
}));

// DELETE /items/:id/prices/:priceId — حذف شد (v4.0.29): هیچ فراخوانی frontend ندارد؛
// حذف قیمت‌ها از طریق batch-update انجام می‌شود.

// POST /items/prices/batch-update
// v9.0.175 (TD-660): همه تغییرها و ردیف ممیزی‌شان در یک تراکنش، زیر قفل ردیف کالاها (پیش‌تر قفل ردیف قیمت‌های موجود جلوی
// درج هم‌زمان قیمت تازه را نمی‌گرفت و ممیزی بیرون از تراکنش نوشته می‌شد)
router.post('/items/prices/batch-update', authorizePermission('products.edit_price'), validate(batchPriceUpdateSchema), asyncHandler(async (req, res) => {
  const updates = req.body.updates as Array<{ itemId: number; title: string; remove?: true; price?: string; currency: string }>;
  const changes = await orm.transaction(async (tx) => {
    const strategies = await ItemPricingService.getPricingStrategies(tx);
    // v9.0.152 (TD-647، ت۱ الف): قیمت فقط برای فهرست تنظیم‌شده ثبت می‌شود؛ حذف قیمت هر عنوانی را می‌پذیرد تا ردیف‌های
    // پیشینِ عنوان ناشناخته پاک‌شدنی بمانند. پیش‌تر ورود سریع «موجودی کل» را فهرست قیمت فروش می‌کرد.
    // v9.0.176 (TD-657): حذف فقط با `remove: true`؛ قیمت صفر، منفی یا نامعتبر در اعتبارسنجی بدنه ۴۰۰ است
    const matcher = priceListMatcher(strategies);
    const unknownTitles = [...new Set(updates.filter(u => !u.remove && !matcher.match(u.title)).map(u => u.title))];
    if (unknownTitles.length > 0) throw unknownPriceListError(unknownTitles);

    const writes = updates.map(u => ({ itemId: u.itemId, title: u.title, remove: u.remove === true, price: u.price, currency: u.currency }));
    const result = await ItemPricingService.applyPriceWrites(tx, writes, strategies);
    if (result.changes.length > 0) {
      await logActivity({
        req,
        tx,
        action: 'UPDATE',
        entity: 'قیمت کالا',
        description: `به‌روزرسانی دسته‌ای ${result.changes.length} قیمت کالا در سامانه`,
        details: {
          totalModified: result.changes.length,
          changes: result.changes.map(c => ({
            itemId: c.itemId,
            itemCode: c.itemCode,
            itemName: c.itemName,
            title: c.title,
            beforePrice: c.beforePrice,
            afterPrice: c.afterPrice ?? 0,
            ...(c.currency ? { currency: c.currency } : {}),
            action: c.action
          }))
        }
      });
    }
    return result.changes;
  });

  res.json({ success: true, count: updates.length, changed: changes.length });
}));

export default router;
