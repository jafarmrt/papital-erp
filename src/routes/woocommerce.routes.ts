import { Router, Request, Response } from 'express';
import { orm } from '../db/drizzle.js';
import { eq, desc, and } from 'drizzle-orm';
import { appSettings, documents, woocommerceOrderLogs } from '../db/schema.js';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { WooOrderSyncService } from '../services/woocommerce/wooOrderSync.service.js';
import { makeWcRequest, requireWcConnection, wcRequest } from '../services/woocommerce/wcClient.js';
import { getWcCatalogReport, refreshWcCatalog } from '../services/woocommerce/wcCatalog.service.js';
import { pushAllStocks, pushItemStock } from '../services/woocommerce/wcStockPush.service.js';
import { getAutoPushView, setAutoPush } from '../services/woocommerce/wcAutoPush.service.js';
import { setShopPriceList, setSkuRename } from '../services/woocommerce/wcFieldPush.service.js';
import { getShopSyncView } from '../services/woocommerce/wcShopSyncView.js';
import { catalogRefreshMessage, trackingEnabledNote } from '../lib/woocommerce/wcCatalog.js';
import { formatPersianNumber } from '../utils/persianNumber.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { AppError, ForbiddenError, ValidationError } from '../errors/customErrors.js';
import { resolveWcTestCredentials } from '../lib/woocommerce/wcConnectionTest.js';
import { readWcConnectionSettings } from '../services/woocommerce/wcConnectionSettings.js';
import { openSettingSecret } from '../services/settings/settingSecrets.js';
import { withUtcTimestampKeys } from '../lib/serverTimestamp.js';
import { WOO_ORDER_LOG_TIMESTAMP_KEYS } from '../services/events/eventTimestamps.js';
import { idempotency } from '../middleware/idempotency.js';
import { wooWebhookAnswer, wooWebhookErrorAnswer } from '../lib/woocommerce/wooWebhookAnswer.js';

const router = Router();

const syncOrderSchema = z.object({
  body: z.object({
    orderId: z.union([z.number(), z.string().min(1, 'شماره سفارش ووکامرس الزامی است')])
  })
});

const syncItemSchema = z.object({
  body: z.object({
    itemId: z.union([z.number(), z.string().regex(/^\d+$/, 'شناسه کالا نامعتبر است')])
  })
});

// 10.2 package 6 (D-04 part B): the target state of «ارسال خودکار», never a toggle
const autoPushSchema = z.object({
  body: z.object({ enabled: z.boolean() }).strict(),
});

// part C: the price list whose prices go to the shop ('' stops the price push) and the target state of the SKU rename
const priceListSchema = z.object({
  body: z.object({ priceList: z.string().max(200) }).strict(),
});
const skuRenameSchema = z.object({
  body: z.object({ enabled: z.boolean() }).strict(),
});

// v9.0.333 (TD-723): هر سه اختیاری‌اند؛ کلید واردنشده یا ماسک‌شده از تنظیمات ذخیره‌شده خوانده می‌شود (resolveWcTestCredentials)
const testConnectionSchema = z.object({
  body: z.object({
    url: z.string().max(500).optional(),
    consumerKey: z.string().max(500).optional(),
    consumerSecret: z.string().max(500).optional()
  })
});

// ==========================================
// UNAUTHENTICATED WEBHOOK ENDPOINT (GET/POST/HEAD)
// ==========================================
const WEBHOOK_REFUSAL_CODES = new Set(['WC_WEBHOOK_SIGNATURE_MISSING', 'WC_WEBHOOK_SIGNATURE_INVALID', 'WC_WEBHOOK_SECRET_NOT_SET']);

const handleWebhookPingOrPayload = async (req: Request, res: Response) => {
  try {
    // 1. If method is GET or HEAD (WooCommerce or browser verification)
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.status(200).json({
        success: true,
        status: 'active',
        message: 'اندپوئینت وب‌هوک ووکامرس فعال و آماده دریافت داده است.'
      });
    }

    // 2. HMAC SHA-256 Signature Verification if Secret Key is configured
    const secretRow = await orm.select().from(appSettings).where(eq(appSettings.key, 'wc_webhook_secret')).limit(1);
    // v9.0.361 (TD-898): stored encrypted; a secret that cannot be decrypted fails the request (answered 200 below), never unsigned
    const webhookSecret = openSettingSecret('wc_webhook_secret', secretRow[0]?.value).trim();

    if (webhookSecret) {
      const signatureHeader = (req.headers['x-wc-webhook-signature'] || '').toString().trim();
      if (!signatureHeader) {
        throw new AppError('امضای امنیتی وب‌هوک ووکامرس (X-WC-Webhook-Signature) در هدر درخواست ارسال نشده است.', 401, 'WC_WEBHOOK_SIGNATURE_MISSING');
      }

      const rawBuffer = (req as { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(rawBuffer);
      const computedSignature = hmac.digest('base64');

      let isMatch = false;
      try {
        isMatch = crypto.timingSafeEqual(
          Buffer.from(signatureHeader),
          Buffer.from(computedSignature)
        );
      } catch (err) {
        isMatch = false;
      }

      if (!isMatch) {
        throw new AppError('امضای محرمانه وب‌هوک ووکامرس نامعتبر است (HMAC SHA-256 Mismatch).', 401, 'WC_WEBHOOK_SIGNATURE_INVALID');
      }
    } else {
      // V9-P0 (Fail-Closed): اگر کلید امضا تنظیم نشده باشد، پردازش سفارش‌های واقعی ممنوع است
      // تا جلوگیری از صدور فاکتور جعلی و کسر غیرواقعی موجودی انبار. تست‌های ping همچنان مجاز می‌مانند.
      const earlyPayload = req.body || {};
      const earlyTopic = String(req.headers['x-wc-webhook-topic'] || '');
      const isPingLike = String(earlyTopic).includes('ping') || earlyPayload.webhook_id || earlyPayload.ping;
      const isRealOrder = !isPingLike && (earlyPayload.id || earlyPayload.number);
      if (isRealOrder) {
        throw new AppError('کلید امضای امنیتی وب‌هوک ووکامرس (wc_webhook_secret) در تنظیمات سامانه تعیین نشده است. جهت جلوگیری از درخواست‌های جعلی، پردازش سفارش تا تنظیم این کلید از مسیر «تنظیمات ← ووکامرس» غیرفعال است.', 403, 'WC_WEBHOOK_SECRET_NOT_SET');
      }
    }

    const payload = req.body || {};
    const topicHeader = req.headers['x-wc-webhook-topic'] || '';

    // 3. Handle WooCommerce Webhook ping test request
    if (topicHeader.includes('ping') || payload.webhook_id || payload.ping) {
      return res.status(200).json({
        success: true,
        status: 'ping_received',
        message: 'تست اتصال وب‌هوک ووکامرس با موفقیت دریافت شد.'
      });
    }

    // 4. Handle Empty or non-order payload
    if (!payload || (!payload.id && !payload.number)) {
      return res.status(200).json({
        success: true,
        message: 'درخواست وب‌هوک دریافت شد اما حاوی داده‌های سفارش نیست.'
      });
    }

    // v7.0.30 (TD-190 / audit P1-2): سیاست وضعیت سفارش (فاکتور / ابطال / بررسی / انتظار پرداخت) در سرویس اعمال می‌شود
    // v8.0.126 (TD-407): موضوع order.deleted (سطل زباله یا حذف دائم) بی وضعیت می‌رسد و «نیازمند بررسی» می‌شود
    const result = await WooOrderSyncService.handleOrder(payload, String(topicHeader));
    // v10.2.0: a failure goes to the shop with the general message only; the order log keeps its details
    return res.status(200).json(wooWebhookAnswer(result));
  } catch (error) {
    // 10.3 package 3 (OBS-R2-05): a refused signature keeps its 401 / 403 through errorHandler; only a failure is answered 200
    if (error instanceof AppError && WEBHOOK_REFUSAL_CODES.has(error.code)) throw error;
    logger.error({ message: 'WooCommerce Webhook error', error });
    // تصمیم مالک محصول (v7.0.30): همیشه 200 — ووکامرس تحویل ناموفق را دوباره ارسال نمی‌کند و پس از ۵ پاسخ
    // غیر 2xx پیاپی وب‌هوک را غیرفعال می‌کند. شکست در woocommerce_order_logs ماندگار است و از ERP با
    // «همگام‌سازی دستی سفارش» دوباره پردازش می‌شود.
    // v10.2.0: never the error text itself (a database error carried its SQL to the shop)
    res.status(200).json(wooWebhookErrorAnswer());
  }
};

router.all('/webhook/order', asyncHandler(handleWebhookPingOrPayload));


// ==========================================
// AUTHENTICATED ROUTES
// ==========================================
router.use(authenticateToken);

// Get WooCommerce Order Logs History
router.get('/order-logs', authorizePermission('woocommerce.view'), asyncHandler(async (req, res) => {
  const logs = await orm.select()
    .from(woocommerceOrderLogs)
    .orderBy(desc(woocommerceOrderLogs.id))
    .limit(100);

  // v9.0.436 (TD-725): the log times go to the WooCommerce tab with a Z (AGENTS §1.10)
  res.json(withUtcTimestampKeys(logs, WOO_ORDER_LOG_TIMESTAMP_KEYS));
}));

// Get WooCommerce Synced Orders History
// OBS-R2-83: the invoices the order log names (erp_document_id), never a LIKE over the document notes
router.get('/synced-orders', authorizePermission('woocommerce.view'), asyncHandler(async (req, res) => {
  const rows = await orm.select({ doc: documents })
    .from(woocommerceOrderLogs)
    .innerJoin(documents, eq(documents.id, woocommerceOrderLogs.erpDocumentId))
    .where(and(eq(documents.type, 'invoice'), eq(documents.isDeleted, 0)))
    .orderBy(desc(documents.id))
    .limit(50);
  res.json(rows.map(r => r.doc));
}));

// Manual order sync trigger by Order ID
router.post('/sync-order-by-id', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), validate(syncOrderSchema), asyncHandler(async (req, res) => {
  const conn = await requireWcConnection();
  const wcOrder = await wcRequest(conn, 'GET', `orders/${req.body.orderId}`);
  res.json(await WooOrderSyncService.handleOrder(wcOrder as Parameters<typeof WooOrderSyncService.handleOrder>[0]));
}));

// 10.2 package 6 (D-04 part A): the links between items and the shop's products, for the WooCommerce tab
router.get('/catalog', authorizePermission('woocommerce.view'), asyncHandler(async (req, res) => {
  const [report, autoPush, shopSync] = await Promise.all([getWcCatalogReport(), getAutoPushView(), getShopSyncView()]);
  res.json({ ...report, autoPush, shopSync });
}));

// «فهرست قیمت فروشگاه» (part C; none by default): the active price of this list goes to each linked product's regular price
// review M-3: choosing a price list also needs the key that edits prices, turning the SKU rename on the key that changes
// item codes; turning either off needs only `woocommerce.manage`, so an operator can always stop a send (review N-3)
router.post('/price-list', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), validate(priceListSchema), asyncHandler(async (req, res) => {
  if (String(req.body.priceList).trim() !== '' && !(await can(req.user, 'products.edit_price'))) {
    throw new ForbiddenError('برگزیدن فهرست قیمت فروشگاه مجوز «ویرایش قیمت‌ها» را هم می‌خواهد.', undefined, 'WC_PRICE_LIST_NEEDS_PRICE_EDIT');
  }
  const result = await setShopPriceList({ req }, String(req.body.priceList));
  const notRead = result.priceList && result.notRead > 0
    ? ` نوع ${formatPersianNumber(result.notRead)} محصول هنوز از سایت خوانده نشده و قیمت آن‌ها پس از «بازخوانی محصولات سایت» فرستاده می‌شود.`
    : '';
  res.json({
    success: true, ...result,
    message: (result.priceList ? `قیمت فهرست «${result.priceList}» از دقیقه بعد به سایت فرستاده می‌شود.` : 'ارسال خودکار قیمت به سایت خاموش شد.') + notRead,
  });
}));

// «تغییر خودکار کد در سایت» on or off (part C; off by default)
router.post('/sku-rename', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), validate(skuRenameSchema), asyncHandler(async (req, res) => {
  if (req.body.enabled === true && !(await can(req.user, 'products.change_code'))) {
    throw new ForbiddenError('روشن کردن تغییر خودکار کد در سایت مجوز «تغییر کد کالا» را هم می‌خواهد.', undefined, 'WC_SKU_RENAME_NEEDS_CODE_CHANGE');
  }
  const result = await setSkuRename({ req }, req.body.enabled === true);
  res.json({
    success: true, ...result,
    message: result.enabled ? 'تغییر خودکار کد محصولات سایت روشن شد.' : 'تغییر خودکار کد محصولات سایت خاموش شد.',
  });
}));

// «ارسال خودکار موجودی» on or off (part B; off by default)
router.post('/auto-push', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), validate(autoPushSchema), asyncHandler(async (req, res) => {
  const result = await setAutoPush({ req }, req.body.enabled === true);
  res.json({
    success: true, ...result,
    message: result.enabled ? 'ارسال خودکار موجودی به سایت روشن شد.' : 'ارسال خودکار موجودی به سایت خاموش شد.',
  });
}));

// «بازخوانی محصولات سایت»: reads the shop's catalog and links each product to the item its SKU finds
router.post('/refresh-products', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), asyncHandler(async (req, res) => {
  const summary = await refreshWcCatalog({ req });
  res.json({ success: true, ...summary, message: catalogRefreshMessage(summary) });
}));

// Sync single item stock to WooCommerce, through the item's link (OBS-R2-83)
router.post('/sync-item', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), validate(syncItemSchema), asyncHandler(async (req, res) => {
  const { sku, quantity, trackingEnabledCount } = await pushItemStock({ req }, Number(req.body.itemId));
  res.json({ success: true, trackingEnabledCount, message: `موجودی کالا (${sku}) در سایت ${formatPersianNumber(quantity)} شد.${trackingEnabledNote(trackingEnabledCount)}` });
}));

// The stock of every linked item, in batches of 100 (OBS-R2-83: was two requests per item)
router.post('/sync-all-stocks', authorizePermission('woocommerce.manage'), idempotency({ scope: 'woocommerce' }), asyncHandler(async (req, res) => {
  const result = await pushAllStocks({ req });
  res.json({ success: true, ...result, message: `موجودی ${formatPersianNumber(result.syncedCount)} کالا در سایت به‌روز شد.${trackingEnabledNote(result.trackingEnabledCount)}` });
}));

// Test Connection
router.post('/test-connection', authorizePermission('woocommerce.manage'), validate(testConnectionSchema), asyncHandler(async (req, res) => {
  // v9.0.333 (TD-723): غیرمدیر کلیدها را «********» می‌بیند و نمی‌فرستد؛ کلید ذخیره‌شده فقط با نشانی ذخیره‌شده به کار می‌رود
  const resolved = resolveWcTestCredentials(req.body, await readWcConnectionSettings());
  if (!resolved.ok) throw new ValidationError(resolved.message, undefined, resolved.code);
  const { url, consumerKey, consumerSecret } = resolved.credentials;

  // V3.0.7 (TD-057): the shop address passes the SSRF guard inside makeWcRequest (OBS-R2-82), without the local echo
  const data = await makeWcRequest('GET', 'products', url, consumerKey, consumerSecret, null, { per_page: 1, _t: Date.now() });

  if (Array.isArray(data)) {
    res.json({ success: true, message: 'اتصال به سایت وردپرسی و فروشگاه ووکامرس با موفقیت برقرار شد.' });
  } else {
    res.json({ success: true, message: 'اتصال برقرار شد، اما پاسخ دریافتی فرمت استاندارد ووکامرس را ندارد.' });
  }
}));

export default router;
