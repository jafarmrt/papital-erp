import { Router, Request, Response } from 'express';
import { orm } from '../db/drizzle.js';
import { sql, eq, desc, like, and } from 'drizzle-orm';
import { appSettings, items, customers, documents, documentItems, woocommerceOrderLogs, warehouses } from '../db/schema.js';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { DocumentService } from '../services/document.service.js';
import { domainEventBus } from '../services/events/domainEventBus.js';
import { OutboxService } from '../services/events/outboxService.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { assertSafeExternalUrl } from '../lib/ssrfGuard.js';

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

const testConnectionSchema = z.object({
  body: z.object({
    url: z.string().min(1, 'آدرس سایت الزامی است'),
    consumerKey: z.string().min(1, 'کلید مشتری الزامی است'),
    consumerSecret: z.string().min(1, 'رمز مشتری الزامی است')
  })
});

// Secure HTTPS agent with strict TLS validation (SEC-011) and optional custom CA
const wooCaPath = process.env.WOOCOMMERCE_SSL_CA_PATH;
const httpsAgent = new https.Agent({
  rejectUnauthorized: true,
  ca: (wooCaPath && fs.existsSync(wooCaPath)) ? fs.readFileSync(wooCaPath, 'utf8') : undefined,
});

/**
 * Helper to make robust WooCommerce API calls
 */
async function makeWcRequest(
  method: 'GET' | 'POST' | 'PUT',
  urlPath: string,
  storeUrl: string,
  key: string,
  secret: string,
  data?: unknown,
  params: Record<string, unknown> = {}
) {
  let formattedUrl = storeUrl.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'https://' + formattedUrl;
  }
  if (formattedUrl.endsWith('/')) {
    formattedUrl = formattedUrl.slice(0, -1);
  }

  const fullUrl = `${formattedUrl}/wp-json/wc/v3/${urlPath.replace(/^\//, '')}`;
  const authHeader = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');

  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ERP-WooSync/2.0',
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const queryParams = {
    ...params,
    consumer_key: key,
    consumer_secret: secret
  };

  try {
    const response = await axios({
      method,
      url: fullUrl,
      data,
      params: queryParams,
      headers,
      httpsAgent,
      timeout: 15000,
      maxRedirects: 5
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const errorData = error.response.data as { message?: string } | undefined;
      const wcMsg = errorData?.message || '';

      if (status === 401 || status === 403) {
        throw new Error(
          `خطای عدم دسترسی (${status}): ${wcMsg || 'کلید نامعتبر است یا فایروال هاست/کلودفلر مانع شده است.'} \n` +
          `نکته: در صورت استفاده از کلودفلر یا آروان‌کلود، کد $_SERVER['HTTPS']='on'; را در بالای wp-config.php قرار دهید ` +
          `و مطمئن شوید کلید شما دارای دسترسی «خواندن/نوشتن» است.`
        );
      } else if (status === 404) {
        throw new Error(
          `مسیر API یافت نشد (404). بررسی کنید که پیوندهای یکتا در وردپرس روی حالت «نام نوشته» (Post Name) تنظیم باشد ` +
          `و افزونه ووکامرس در سایت فعال باشد.`
        );
      } else {
        throw new Error(`خطای سایت وردپرس (${status}): ${wcMsg || JSON.stringify(errorData) || 'پاسخ نامشخص از سرور'}`);
      }
    } else if (axios.isAxiosError(error) && (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')) {
      throw new Error(`آدرس دامنه یافت نشد (${formattedUrl}). از صحت آدرس ورودی مطمئن شوید.`);
    } else if (axios.isAxiosError(error) && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT')) {
      throw new Error(`زمان ارتباط با سرور وردپرس به پایان رسید یا اتصال رد شد. ممکن است هاست یا فایروال سرور درخواست را بلاک کرده باشد.`);
    } else {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`خطا در برقراری ارتباط با وردپرس: ${errMsg || 'خطای شبکه'}`);
    }
  }
}

interface WcOrderPayload {
  id?: string | number;
  number?: string | number;
  total?: string | number;
  currency?: string;
  line_items?: Array<{
    id?: number;
    name?: string;
    sku?: string;
    quantity?: number;
    price?: number | string;
    total?: number | string;
    [key: string]: unknown;
  }>;
  billing?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    address_1?: string;
    address_2?: string;
    [key: string]: unknown;
  };
  shipping?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    address_1?: string;
    address_2?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Helper to process a WooCommerce Order JSON into an ERP Invoice & deduct stock atomically and idempotently.
 */
async function processWooCommerceOrder(wcOrder: WcOrderPayload) {
  const wcOrderId = String(wcOrder.id || wcOrder.number || '').trim();
  if (!wcOrderId) {
    throw new Error('داده‌های سفارش ووکامرس حاوی شماره سفارش معتبر نیست.');
  }

  const notesTag = `سفارش ووکامرس #${wcOrderId}`;

  // Execute in isolated database transaction with row locks for strict concurrency safety
  return await orm.transaction(async (tx) => {
    // 1. Check woocommerceOrderLogs with FOR UPDATE lock
    const existingLogs = await tx.select()
      .from(woocommerceOrderLogs)
      .where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId))
      .for('update');

    if (existingLogs.length > 0) {
      const log = existingLogs[0];
      if (log.status === 'processed' && log.erpDocumentId) {
        return {
          success: true,
          alreadyExists: true,
          docId: log.erpDocumentId,
          message: `فاکتور فروش مربوط به سفارش ووکامرس #${wcOrderId} قبلاً با شناسه ${log.erpDocumentId} ثبت گردیده است.`
        };
      }
    }

    // 2. Check existing documents as additional fallback
    const existingDocs = await tx.select()
      .from(documents)
      .where(and(
        eq(documents.type, 'invoice'),
        eq(documents.isDeleted, 0),
        like(documents.notes, `%${notesTag}%`)
      ));

    if (existingDocs.length > 0) {
      const doc = existingDocs[0];
      if (existingLogs.length === 0) {
        try {
          await tx.insert(woocommerceOrderLogs).values({
            wcOrderId,
            erpDocumentId: doc.id,
            status: 'processed',
            buyerName: doc.buyerName || '',
            totalAmount: String(wcOrder.total || 0),
            payload: wcOrder
          });
        } catch (logErr) {
          logger.warn({ message: `Failed to backfill WooCommerce order log for #${wcOrderId}`, error: logErr });
        }
      }
      return {
        success: true,
        alreadyExists: true,
        docId: doc.id,
        message: `فاکتور فروش مربوط به سفارش ووکامرس #${wcOrderId} قبلاً در سیستم با شماره فاکتور ${doc.refNumber} ثبت گردیده است.`
      };
    }

    const lineItems = wcOrder.line_items || [];
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error(`سفارش ووکامرس #${wcOrderId} فاقد اقلام خرید است.`);
    }

    const billing = wcOrder.billing || {};
    const shipping = wcOrder.shipping || {};
    const firstName = (billing.first_name || shipping.first_name || '').trim();
    const lastName = (billing.last_name || shipping.last_name || '').trim();
    const buyerName = `${firstName} ${lastName}`.trim() || `خریدار ووکامرس #${wcOrderId}`;
    const buyerPhone = (billing.phone || shipping.phone || '').trim();
    const buyerCity = (billing.city || shipping.city || '').trim();
    const buyerAddress = `${billing.address_1 || shipping.address_1 || ''} ${billing.address_2 || shipping.address_2 || ''}`.trim();

    // Match or create customer
    if (buyerPhone || buyerName) {
      const matchedCustomer = await tx.select()
        .from(customers)
        .where(and(
          eq(customers.isDeleted, 0),
          buyerPhone ? eq(customers.phone, buyerPhone) : eq(customers.name, buyerName)
        ));

      if (matchedCustomer.length === 0 && buyerName) {
        try {
          await tx.insert(customers).values({
            name: buyerName,
            phone: buyerPhone,
            city: buyerCity,
            address: buyerAddress,
            notes: `مشتری ثبت‌شده خودکار از فروشگاه ووکامرس`
          });
        } catch (custErr) {
          logger.warn({ message: `Failed to auto-create WooCommerce customer for order #${wcOrderId}`, error: custErr });
        }
      }
    }

    // V10-2.3 (TD-022): تعیین انبار پیش‌فرض فعال با fallback به 'main'
    const [defLoc] = await tx.select().from(warehouses).where(eq(warehouses.isActive, 1)).limit(1);
    const targetLoc = defLoc?.code || 'main';

    // V10-2.3 (TD-022): نگاشت ارز سفارش ووکامرس به واژگان استاندارد سیستم (IRR / USD / EUR ...)
    // در صورت ارسال تومان (IRT / TOMAN)، مبالغ برحسب ریال استاندارد (ضریب ۱۰) و ارز سند IRR ثبت می‌شود
    const rawCurrency = String(wcOrder.currency || '').trim().toUpperCase();
    const isToman = rawCurrency === 'IRT' || rawCurrency === 'TOMAN' || rawCurrency === 'تومان';
    const currencyMultiplier = isToman ? 10 : 1;
    const systemCurrency = isToman ? 'IRR' : (rawCurrency || 'IRR');

    // Match items by SKU
    const matchedDocItems: Array<{ itemId: number; quantity: number; unit_price: number; location: string }> = [];
    const unmappedSkus: string[] = [];
    let orderTotalNumeric = 0;

    for (const item of lineItems) {
      const sku = (item.sku || '').trim();
      const qty = Number(item.quantity || 1);
      const rawPrice = Number(item.price || (item.total ? Number(item.total) / qty : 0));
      const unitPrice = Math.round(rawPrice * currencyMultiplier);
      orderTotalNumeric += qty * unitPrice;

      if (sku) {
        const erpItems = await tx.select()
          .from(items)
          .where(and(eq(items.isDeleted, 0), eq(items.code, sku)));

        if (erpItems.length > 0) {
          matchedDocItems.push({
            itemId: erpItems[0].id,
            quantity: qty,
            unit_price: unitPrice,
            location: targetLoc
          });
        } else {
          unmappedSkus.push(`${item.name} (SKU: ${sku})`);
        }
      } else {
        unmappedSkus.push(`${item.name} (فاقد SKU)`);
      }
    }

    if (matchedDocItems.length === 0) {
      const errMessage = `هیچ یک از اقلام سفارش ووکامرس #${wcOrderId} در انبار ERP یافت نشدند. اقلام بدون تطبیق: ${unmappedSkus.join(', ')}`;
      
      if (existingLogs.length > 0) {
        await tx.update(woocommerceOrderLogs)
          .set({ status: 'failed', errorMessage: errMessage, updatedAt: new Date().toISOString() })
          .where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId));
      } else {
        try {
          await tx.insert(woocommerceOrderLogs).values({
            wcOrderId,
            status: 'failed',
            buyerName,
            totalAmount: String(orderTotalNumeric),
            payload: wcOrder,
            errorMessage: errMessage
          });
        } catch (logErr) {
          logger.warn({ message: `Failed to record failed WooCommerce order log for #${wcOrderId}`, error: logErr });
        }
      }
      throw new Error(errMessage);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    // V9-P0: refNumber و سند فاکتور هر دو داخل همان تراکنش اتمیک پردازش سفارش تولید می‌شوند
    const nextRef = await DocumentService.getNextRef('invoice', todayStr, tx);

    let notesText = `${notesTag}`;
    if (unmappedSkus.length > 0) {
      notesText += ` - اقلام بدون تطبیق انبار: ${unmappedSkus.join(', ')}`;
    }

    const newDocId = await DocumentService.createDocument({
      docType: 'invoice',
      refNumber: nextRef,
      date: todayStr,
      user: 'ربات ووکامرس',
      inOut: 'out',
      status: 'final',
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      buyer_city: buyerCity,
      buyer_address: buyerAddress,
      notes: notesText,
      currency: systemCurrency,
      items: matchedDocItems,
      location: targetLoc,
      externalTx: tx
    });

    // Record or update in woocommerceOrderLogs
    if (existingLogs.length > 0) {
      await tx.update(woocommerceOrderLogs)
        .set({
          status: 'processed',
          erpDocumentId: newDocId,
          buyerName,
          totalAmount: String(orderTotalNumeric),
          payload: wcOrder,
          errorMessage: '',
          updatedAt: new Date().toISOString()
        })
        .where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId));
    } else {
      await tx.insert(woocommerceOrderLogs).values({
        wcOrderId,
        erpDocumentId: newDocId,
        status: 'processed',
        buyerName,
        totalAmount: String(orderTotalNumeric),
        payload: wcOrder
      });
    }

    // Emit Domain Event & Outbox Event
    const event = domainEventBus.createEvent(
      'woocommerce.order.synced',
      'WooCommerce',
      wcOrderId,
      {
        wcOrderId,
        docId: newDocId,
        refNumber: nextRef,
        buyerName,
        totalAmount: orderTotalNumeric
      }
    );

    domainEventBus.emit('woocommerce.order.synced', event);
    await OutboxService.saveToOutbox(tx, event);

    return {
      success: true,
      docId: newDocId,
      refNumber: nextRef,
      message: `فاکتور فروش شماره ${nextRef} جهت سفارش ووکامرس #${wcOrderId} با موفقیت صادر گردید و موجودی انبار کسر شد.`
    };
  });
}

// ==========================================
// UNAUTHENTICATED WEBHOOK ENDPOINT (GET/POST/HEAD)
// ==========================================
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
    const webhookSecret = secretRow[0]?.value?.trim() || '';

    if (webhookSecret) {
      const signatureHeader = (req.headers['x-wc-webhook-signature'] || '').toString().trim();
      if (!signatureHeader) {
        return res.status(401).json({
          success: false,
          error: 'امضای امنیتی وب‌هوک ووکامرس (X-WC-Webhook-Signature) در هدر درخواست ارسال نشده است.'
        });
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
        return res.status(401).json({
          success: false,
          error: 'امضای محرمانه وب‌هوک ووکامرس نامعتبر است (HMAC SHA-256 Mismatch).'
        });
      }
    } else {
      // V9-P0 (Fail-Closed): اگر کلید امضا تنظیم نشده باشد، پردازش سفارش‌های واقعی ممنوع است
      // تا جلوگیری از صدور فاکتور جعلی و کسر غیرواقعی موجودی انبار. تست‌های ping همچنان مجاز می‌مانند.
      const earlyPayload = req.body || {};
      const earlyTopic = String(req.headers['x-wc-webhook-topic'] || '');
      const isPingLike = String(earlyTopic).includes('ping') || earlyPayload.webhook_id || earlyPayload.ping;
      const isRealOrder = !isPingLike && (earlyPayload.id || earlyPayload.number);
      if (isRealOrder) {
        return res.status(403).json({
          success: false,
          error: 'کلید امضای امنیتی وب‌هوک ووکامرس (wc_webhook_secret) در تنظیمات سیستم تعیین نشده است. جهت جلوگیری از درخواست‌های جعلی، پردازش سفارش تا تنظیم این کلید از مسیر «تنظیمات ← ووکامرس» غیرفعال است.'
        });
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

    const wcStatus = payload.status;
    // Process when order status is valid for stock deduction & invoicing
    if (['processing', 'completed', 'on-hold', 'pending'].includes(wcStatus)) {
      const result = await processWooCommerceOrder(payload);
      return res.status(200).json(result);
    } else {
      return res.status(200).json({
        success: true,
        message: `سفارش ووکامرس #${payload.id} در وضعیت «${wcStatus}» قرار دارد و نیازی به صدور فاکتور در این مرحله نیست.`
      });
    }
  } catch (error) {
    logger.error({ message: 'WooCommerce Webhook error', error });
    // Return 200 with success: false to prevent WooCommerce from retrying continuously, but include error message
    res.status(200).json({ success: false, error: error.message || 'خطا در پردازش وب‌هوک ووکامرس' });
  }
};

router.all('/webhook/order', handleWebhookPingOrPayload);


// ==========================================
// AUTHENTICATED ROUTES
// ==========================================
router.use(authenticateToken);

// Get WooCommerce Order Logs History
router.get('/order-logs', authorize('admin', 'manager', 'woocommerce.view'), async (req, res) => {
  try {
    const logs = await orm.select()
      .from(woocommerceOrderLogs)
      .orderBy(desc(woocommerceOrderLogs.id))
      .limit(100);

    res.json(logs);
  } catch (error) {
    throw error;
  }
});

// Get WooCommerce Synced Orders History
router.get('/synced-orders', authorize('admin', 'manager', 'woocommerce.view'), async (req, res) => {
  try {
    const docs = await orm.select()
      .from(documents)
      .where(and(
        eq(documents.type, 'invoice'),
        eq(documents.isDeleted, 0),
        like(documents.notes, '%سفارش ووکامرس%')
      ))
      .orderBy(desc(documents.id))
      .limit(50);

    res.json(docs);
  } catch (error) {
    throw error;
  }
});

// Manual order sync trigger by Order ID
router.post('/sync-order-by-id', authorize('admin', 'manager', 'woocommerce.manage'), validate(syncOrderSchema), async (req, res) => {
  try {
    const { orderId } = req.body;

    const settingsRows = await orm.select().from(appSettings).where(
      sql`key IN ('wc_store_url', 'wc_consumer_key', 'wc_consumer_secret')`
    );

    let url = '', key = '', secret = '';
    settingsRows.forEach(row => {
      if (row.key === 'wc_store_url') url = row.value;
      if (row.key === 'wc_consumer_key') key = row.value;
      if (row.key === 'wc_consumer_secret') secret = row.value;
    });

    if (!url || !key || !secret) {
      return res.status(400).json({ error: 'تنظیمات اتصال به ووکامرس تکمیل نشده است.' });
    }

    const wcOrder = await makeWcRequest('GET', `orders/${orderId}`, url, key, secret);
    const result = await processWooCommerceOrder(wcOrder);

    res.json(result);
  } catch (error) {
    throw error;
  }
});

// Sync single item stock to WooCommerce
router.post('/sync-item', authorize('admin', 'manager', 'woocommerce.manage'), validate(syncItemSchema), async (req, res) => {
  try {
    const { itemId } = req.body;

    const settingsRows = await orm.select().from(appSettings).where(
      sql`key IN ('wc_store_url', 'wc_consumer_key', 'wc_consumer_secret')`
    );

    let url = '', key = '', secret = '';
    settingsRows.forEach(row => {
      if (row.key === 'wc_store_url') url = row.value;
      if (row.key === 'wc_consumer_key') key = row.value;
      if (row.key === 'wc_consumer_secret') secret = row.value;
    });

    if (!url || !key || !secret) {
      return res.status(400).json({ error: 'تنظیمات ووکامرس تکمیل نشده است. ابتدا به صفحه تنظیمات > اتصال به ووکامرس بروید.' });
    }

    const [item] = await orm.select().from(items).where(eq(items.id, Number(itemId)));
    if (!item) return res.status(404).json({ error: 'کالای مورد نظر در سیستم یافت نشد.' });
    if (!item.code) return res.status(400).json({ error: 'کالا فاقد کد (SKU) است و قابل همگام‌سازی نیست.' });

    const sku = item.code;
    const currentStock = Number(item.currentStock || 0);

    const wcProducts = await makeWcRequest('GET', 'products', url, key, secret, null, { sku });

    if (!Array.isArray(wcProducts) || wcProducts.length === 0) {
      return res.status(404).json({ error: `محصولی با کد شناسه (SKU) «${sku}» در سایت ووکامرس شما یافت نشد.` });
    }

    const wcProductId = wcProducts[0].id;

    await makeWcRequest('PUT', `products/${wcProductId}`, url, key, secret, {
      manage_stock: true,
      stock_quantity: currentStock,
      stock_status: currentStock > 0 ? 'instock' : 'outofstock'
    });

    res.json({ success: true, message: `موجودی کالا (SKU: ${sku}) با موفقیت به ${currentStock} عدد در ووکامرس به‌روزرسانی شد.` });

  } catch (error) {
    throw error;
  }
});

// Bulk sync all active ERP items' stock to WooCommerce
router.post('/sync-all-stocks', authorize('admin', 'manager', 'woocommerce.manage'), async (req, res) => {
  try {
    const settingsRows = await orm.select().from(appSettings).where(
      sql`key IN ('wc_store_url', 'wc_consumer_key', 'wc_consumer_secret')`
    );

    let url = '', key = '', secret = '';
    settingsRows.forEach(row => {
      if (row.key === 'wc_store_url') url = row.value;
      if (row.key === 'wc_consumer_key') key = row.value;
      if (row.key === 'wc_consumer_secret') secret = row.value;
    });

    if (!url || !key || !secret) {
      return res.status(400).json({ error: 'تنظیمات کلیدهای دسترسی ووکامرس در سیستم پیکربندی نشده است.' });
    }

    const erpItems = await orm.select()
      .from(items)
      .where(and(eq(items.isDeleted, 0), sql`code IS NOT NULL AND code != ''`));

    let updatedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const item of erpItems) {
      const sku = (item.code || '').trim();
      if (!sku) continue;
      const currentStock = Number(item.currentStock || 0);

      try {
        const wcProducts = await makeWcRequest('GET', 'products', url, key, secret, null, { sku });
        if (Array.isArray(wcProducts) && wcProducts.length > 0) {
          const wcProductId = wcProducts[0].id;
          await makeWcRequest('PUT', `products/${wcProductId}`, url, key, secret, {
            manage_stock: true,
            stock_quantity: currentStock,
            stock_status: currentStock > 0 ? 'instock' : 'outofstock'
          });
          updatedCount++;
        }
      } catch (err) {
        failedCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`خطا در SKU (${sku}): ${errMsg}`);
      }
    }

    res.json({
      success: true,
      totalItems: erpItems.length,
      syncedCount: updatedCount,
      failedCount,
      errors,
      message: `همگام‌سازی دسته‌ای موجودی کل کالاها انجام شد. ${updatedCount} کالا در ووکامرس به‌روزرسانی شدند.`
    });
  } catch (error) {
    throw error;
  }
});

// Test Connection
router.post('/test-connection', authorize('admin', 'manager', 'woocommerce.manage'), validate(testConnectionSchema), async (req, res) => {
  try {
    const { url, consumerKey, consumerSecret } = req.body;

    // V3.0.7 (TD-057): مسیر test-connection یک URL کاربر-محور را fetch می‌کند و
    // باید از گارد SSRF عبور کند (قبلاً بدون گارد بود). echo محلی مجاز نیست.
    await assertSafeExternalUrl(url, { allowLocalEcho: false });

    const data = await makeWcRequest('GET', 'products', url, consumerKey, consumerSecret, null, { per_page: 1, _t: Date.now() });

    if (Array.isArray(data)) {
      res.json({ success: true, message: 'اتصال به سایت وردپرسی و فروشگاه ووکامرس با موفقیت برقرار شد.' });
    } else {
      res.json({ success: true, message: 'اتصال برقرار شد، اما پاسخ دریافتی فرمت استاندارد ووکامرس را ندارد.' });
    }
  } catch (error) {
    throw error;
  }
});

export default router;
