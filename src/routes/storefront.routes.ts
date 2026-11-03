import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/authorize.js';
import { orm } from '../db/drizzle.js';
import { idempotency } from '../middleware/idempotency.js';
import { numericIdString, validate } from '../middleware/validate.js';
import { OPEN_ORDERS_PER_PHONE_MAX } from '../lib/storefront/storefrontOrderRules.js';
import {
  BRAND_IMAGE_KINDS, LOW_STOCK_THRESHOLD_MAX, RESERVATION_HOURS_MAX, SHIPPING_PRICING, SHIPPING_RATES_MAX, STOCK_DISPLAYS, type BrandImageKind,
} from '../lib/storefront/storefrontRules.js';
import { saveStorefrontBrandImage } from '../services/storefront/storefrontBrand.service.js';
import {
  readStorefrontSettings, rotateStorefrontApiKey, saveStorefrontSettings,
} from '../services/storefront/storefrontSettings.service.js';
import {
  createShippingMethod, deleteShippingMethod, listShippingMethods, updateShippingMethod,
} from '../services/storefront/storefrontShipping.service.js';
import { STOREFRONT_PAGE_MAX, listStorefrontProducts, saveStorefrontProduct } from '../services/storefront/storefrontProducts.service.js';
import {
  ADMIN_ORDER_PAGE_MAX, cancelOrder, confirmPayment, fulfilOrder, listOrders, orderDetail, receiptImage, rejectReceipt,
} from '../services/storefront/storefrontOrderAdmin.service.js';
import { ORDER_STATUSES, REJECT_REASON_MAX, TRACKING_CODE_MAX, type OrderStatus } from '../lib/storefront/storefrontOrderRules.js';

/**
 * v11 phase 8.1 (package 18): the ERP side of the storefront (`/api/storefront`), the «فروشگاه سایت» settings tab. `storefront.view` reads,
 * `storefront.manage` writes; every write is checked again in its service (lengths, card and IBAN checks, price lists,
 * the publish rule) and carries the version the form was opened with.
 */
const router = Router();
export const STOREFRONT_VIEW_PERMISSION = 'storefront.view';
export const STOREFRONT_MANAGE_PERMISSION = 'storefront.manage';
export const STOREFRONT_ORDERS_VIEW_PERMISSION = 'site_orders.view';
export const STOREFRONT_ORDERS_MANAGE_PERMISSION = 'site_orders.manage';

const text = (max: number) => z.string().max(max);
const amount = z.union([z.string().max(40), z.number()]).transform(v => String(v));
const version = z.number().int().min(0).max(2_147_483_647);

// a data URL of at most 300 KB decoded is about 410,000 characters; the service checks the exact size and the type
const brandImageSchema = z.object({
  params: z.object({ kind: z.enum(BRAND_IMAGE_KINDS) }).passthrough(),
  body: z.object({ image: z.string().max(420_000), version }).strict(),
});

const emptyBodySchema = z.object({ body: z.object({}).strict().optional() });

const settingsSchema = z.object({
  body: z.object({
    cardNumber: text(40), cardHolder: text(200), bankName: text(200), iban: text(60),
    freeShippingThreshold: amount, reservationHours: z.number().int().min(1).max(RESERVATION_HOURS_MAX),
    retailPriceList: text(200), wholesalePriceList: text(200),
    lowStockThreshold: z.number().int().min(0).max(LOW_STOCK_THRESHOLD_MAX), stockDisplay: z.enum(STOCK_DISPLAYS), warehouseCode: text(100),
    whatsappNumber: text(30), whatsappEnabled: z.boolean(), enabled: z.boolean(),
    ordersEnabled: z.boolean(), treasuryAccountId: z.number().int().min(0).max(2_147_483_647),
    openOrdersPerPhone: z.number().int().min(1).max(OPEN_ORDERS_PER_PHONE_MAX),
    version,
  }).strict(),
});

const shippingBody = z.object({
  code: text(80), title: text(200), description: text(400), pricing: z.enum(SHIPPING_PRICING), flatRate: amount,
  isActive: z.boolean(), isFreeShippingEligible: z.boolean(), sortOrder: z.number().int(),
  rates: z.array(z.object({
    province: text(60), maxWeightGrams: z.number().int().nullable(), rate: amount,
  }).strict()).max(SHIPPING_RATES_MAX + 1),
});
const shippingCreateSchema = z.object({ body: shippingBody.strict() });
const shippingUpdateSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  body: shippingBody.extend({ version: version.min(1) }).strict(),
});
const shippingDeleteSchema = z.object({
  params: z.object({ id: numericIdString }).passthrough(),
  query: z.object({ version: z.string().regex(/^[1-9]\d{0,9}$/, 'نسخه نامعتبر است').transform(Number) }).passthrough(),
});

const productListSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    q: text(100).optional(),
    published: z.enum(['all', 'published', 'unpublished']).optional(),
  }).passthrough(),
});
const productSaveSchema = z.object({
  params: z.object({ itemId: numericIdString }).passthrough(),
  body: z.object({
    published: z.boolean(), slug: text(200), seoTitle: text(200), seoDescription: text(400), sortOrder: z.number().int(), version,
  }).strict(),
});

const orderListSchema = z.object({
  query: z.object({
    page: z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).optional(),
    q: text(100).optional(),
    status: z.enum([...ORDER_STATUSES, 'open']).optional(),
  }).passthrough(),
});
const orderIdParams = z.object({ id: numericIdString }).passthrough();
const orderDetailSchema = z.object({ params: orderIdParams });
const receiptId = z.number().int().min(1).max(2_147_483_647);
const confirmSchema = z.object({ params: orderIdParams, body: z.object({ receiptId, version: version.min(1) }).strict() });
const rejectSchema = z.object({ params: orderIdParams, body: z.object({ receiptId, reason: text(REJECT_REASON_MAX * 2), version: version.min(1) }).strict() });
const cancelSchema = z.object({ params: orderIdParams, body: z.object({ version: version.min(1) }).strict() });
const fulfilSchema = z.object({
  params: orderIdParams,
  body: z.object({ status: z.enum(['shipped', 'delivered']), trackingCode: text(TRACKING_CODE_MAX * 2), version: version.min(1) }).strict(),
});

router.use(authenticateToken);

router.get('/settings', requirePermission(STOREFRONT_VIEW_PERMISSION), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await readStorefrontSettings(orm) });
}));

router.put('/settings', requirePermission(STOREFRONT_MANAGE_PERMISSION), validate(settingsSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveStorefrontSettings(req, req.body) });
}));

// the new key is answered once; the form shows it to be copied into the site app's settings
router.post('/api-key', requirePermission(STOREFRONT_MANAGE_PERMISSION), idempotency({ scope: 'storefront_key' }), validate(emptyBodySchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await rotateStorefrontApiKey(req) });
}));

router.put('/brand/:kind', requirePermission(STOREFRONT_MANAGE_PERMISSION), validate(brandImageSchema), asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { image: string; version: number };
  res.json({ data: await saveStorefrontBrandImage(req, String(req.params.kind) as BrandImageKind, body.image, body.version) });
}));

router.get('/shipping-methods', requirePermission(STOREFRONT_VIEW_PERMISSION), asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await listShippingMethods(orm) });
}));

router.post('/shipping-methods', requirePermission(STOREFRONT_MANAGE_PERMISSION), idempotency({ scope: 'storefront' }), validate(shippingCreateSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, data: await createShippingMethod(req, req.body) });
}));

router.put('/shipping-methods/:id', requirePermission(STOREFRONT_MANAGE_PERMISSION), validate(shippingUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await updateShippingMethod(req, Number(req.params.id), req.body) });
}));

router.delete('/shipping-methods/:id', requirePermission(STOREFRONT_MANAGE_PERMISSION), validate(shippingDeleteSchema), asyncHandler(async (req: Request, res: Response) => {
  await deleteShippingMethod(req, Number(req.params.id), Number((req.query as { version?: number }).version));
  res.json({ success: true });
}));

router.get('/products', requirePermission(STOREFRONT_VIEW_PERMISSION), validate(productListSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; q?: string; published?: 'all' | 'published' | 'unpublished' };
  res.json(await listStorefrontProducts({
    page: query.page ?? 1, limit: Math.min(query.limit ?? 50, STOREFRONT_PAGE_MAX), q: query.q ?? '', published: query.published ?? 'all',
  }));
}));

router.put('/products/:itemId', requirePermission(STOREFRONT_MANAGE_PERMISSION), validate(productSaveSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await saveStorefrontProduct(req, Number(req.params.itemId), req.body) });
}));

// v11 phase 8.2a: the «سفارش‌های سایت» page. Reads need site_orders.view; every action site_orders.manage, and
// confirming a payment also the treasury and finalize keys (checked in the service, since it posts money and stock)
router.get('/orders', requirePermission(STOREFRONT_ORDERS_VIEW_PERMISSION), validate(orderListSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { page?: number; limit?: number; q?: string; status?: OrderStatus | 'open' };
  res.json(await listOrders({ page: query.page ?? 1, limit: Math.min(query.limit ?? 30, ADMIN_ORDER_PAGE_MAX), q: query.q ?? '', status: query.status ?? '' }));
}));

router.get('/orders/:id', requirePermission(STOREFRONT_ORDERS_VIEW_PERMISSION), validate(orderDetailSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await orderDetail(Number(req.params.id)) });
}));

// v11 phase 8.2a: a receipt's photo, only for the orders page (the general attachment route never serves it)
const receiptImageSchema = z.object({ params: z.object({ id: numericIdString, receiptId: numericIdString }).passthrough() });
router.get('/orders/:id/receipts/:receiptId/image', requirePermission(STOREFRONT_ORDERS_VIEW_PERMISSION), validate(receiptImageSchema), asyncHandler(async (req: Request, res: Response) => {
  const image = await receiptImage(Number(req.params.id), Number(req.params.receiptId));
  res.setHeader('Content-Type', image.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.send(image.buffer);
}));

router.post('/orders/:id/confirm', requirePermission(STOREFRONT_ORDERS_MANAGE_PERMISSION), idempotency({ scope: 'storefront_orders' }), validate(confirmSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await confirmPayment(req, Number(req.params.id), req.body) });
}));

router.post('/orders/:id/reject-receipt', requirePermission(STOREFRONT_ORDERS_MANAGE_PERMISSION), idempotency({ scope: 'storefront_orders' }), validate(rejectSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await rejectReceipt(req, Number(req.params.id), req.body) });
}));

router.post('/orders/:id/cancel', requirePermission(STOREFRONT_ORDERS_MANAGE_PERMISSION), idempotency({ scope: 'storefront_orders' }), validate(cancelSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await cancelOrder(req, Number(req.params.id), req.body) });
}));

router.post('/orders/:id/fulfil', requirePermission(STOREFRONT_ORDERS_MANAGE_PERMISSION), idempotency({ scope: 'storefront_orders' }), validate(fulfilSchema), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await fulfilOrder(req, Number(req.params.id), req.body) });
}));

export default router;
