import { orm, type DbExecutor } from '../../db/drizzle.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { documents, items, woocommerceOrderLogs } from '../../db/schema.js';
import { DocumentService } from '../document.service.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { OutboxService } from '../events/outboxService.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../../lib/businessClock.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { logger } from '../../middleware/logger.js';
import { resolveWooOrderCustomer, type WooOrderBuyer } from './wooOrderCustomer.js';
import { currencyScale, exactLineSplit } from './exactLineTotal.js';
import { allocateFeeDiscount } from './feeDiscount.js';
import { describeOrderChange } from './orderChange.js';
import { resolveShopWarehouseCode } from './shopWarehouse.js';

/**
 * v7.0.30 (TD-190 / audit P1-2): پردازش سفارش‌های ووکامرس — منتقل‌شده از woocommerce.routes.ts (RULE 01).
 *
 * سیاست وضعیت‌ها (تصمیم مالک محصول):
 * - processing / completed  → صدور فاکتور قطعی و کسر موجودی
 * - cancelled / failed      → ابطال خودکار فاکتور صادرشده (حذف نرم + تراکنش معکوس کاردکس + سند حسابداری معکوس)
 * - refunded                → فقط علامت «نیازمند بررسی»؛ استرداد وجه لزوماً به معنای برگشت کالا نیست
 * - trash / وب‌هوک order.deleted → مثل refunded فقط «نیازمند بررسی» (v8.0.126، TD-407)؛ حذف سفارش در فروشگاه فاکتور را باطل نمی‌کند
 * - سایر (pending، on-hold، ...) → ثبت در لاگ بدون فاکتور، تا وب‌هوک وضعیت پرداخت‌شده برسد
 *
 * همزمانی: ردیف woocommerce_order_logs (wc_order_id یکتا) پیش از هر کاری درج و قفل سطری می‌شود؛
 * درخواست‌های همزمان یک سفارش پشت این قفل سریال می‌شوند و منبع حقیقت پایگاه‌داده است (نه کش).
 */

export const WC_INVOICEABLE_STATUSES: ReadonlySet<string> = new Set(['processing', 'completed']);
export const WC_VOIDABLE_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'failed']);
export const WC_REVIEW_STATUSES: ReadonlySet<string> = new Set(['refunded', 'trash']);

/**
 * v8.0.126 (TD-407): وب‌هوک «حذف سفارش» ووکامرس (موضوع order.deleted، هنگام بردن به سطل زباله یا حذف دائم) فقط شناسه سفارش را
 * می‌فرستد و وضعیتی ندارد؛ پیش‌تر به شاخه «در انتظار پرداخت» می‌رفت و فاکتور صادرشده بی‌هیچ علامتی می‌ماند.
 */
export function isWcOrderDeletedTopic(topic: unknown): boolean {
  return String(topic ?? '').trim().toLowerCase() === 'order.deleted';
}

/** وضعیت‌های ردیف لاگ سفارش در ERP */
export type WcOrderLogStatus =
  | 'received'      // ردیف موقت داخل تراکنش در حال پردازش (هرگز commit نمی‌شود مگر با وضعیت نهایی)
  | 'processed'     // فاکتور قطعی صادر شده است
  | 'failed'        // صدور فاکتور ناموفق بود (قابل تلاش مجدد با همگام‌سازی دستی)
  | 'deferred'      // سفارش هنوز پرداخت نشده است (pending / on-hold)
  | 'voided'        // فاکتور پس از لغو/ناموفق شدن سفارش ابطال شد
  | 'cancelled'     // سفارش پیش از صدور فاکتور لغو شد
  | 'needs_review'; // نیازمند اقدام حسابدار (استرداد وجه یا شکست ابطال خودکار)

/** وضعیت‌هایی که فاکتور فعال (یا تصمیم انسانی) پشت آن‌هاست و نباید با شکست بعدی بازنویسی شوند */
const SETTLED_LOG_STATUSES: ReadonlySet<string> = new Set(['processed', 'voided', 'needs_review']);
/** وضعیت‌های بدون فاکتور که با رسیدن وضعیت پرداخت‌نشده به «deferred» تبدیل می‌شوند */
const DEFERRABLE_LOG_STATUSES: ReadonlySet<string> = new Set(['received', 'failed', 'deferred', 'cancelled']);

export const WC_BOT_USER = 'ربات ووکامرس';

export interface WcOrderPayload {
  id?: string | number;
  number?: string | number;
  status?: string;
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
  billing?: WcAddress;
  shipping?: WcAddress;
  /** v7.0.103 (TD-191): هزینه‌های ارسال، کارمزدها و مالیات سفارش */
  shipping_lines?: Array<{ total?: number | string; [key: string]: unknown }>;
  shipping_total?: number | string;
  fee_lines?: Array<{ name?: string; total?: number | string; [key: string]: unknown }>;
  total_tax?: number | string;
  [key: string]: unknown;
}

interface WcAddress {
  first_name?: string;
  last_name?: string;
  phone?: string;
  city?: string;
  address_1?: string;
  address_2?: string;
  [key: string]: unknown;
}

export interface WcOrderSyncResult {
  success: boolean;
  /** وضعیت نهایی ردیف لاگ پس از این پردازش */
  status: WcOrderLogStatus;
  alreadyExists?: boolean;
  docId?: number;
  refNumber?: string;
  message: string;
  error?: string;
}

type LockedLog = typeof woocommerceOrderLogs.$inferSelect;

type BuyerInfo = WooOrderBuyer;

const notesTag = (wcOrderId: string) => `سفارش ووکامرس #${wcOrderId}`;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBuyer(wcOrder: WcOrderPayload, wcOrderId: string): BuyerInfo {
  const billing = wcOrder.billing || {};
  const shipping = wcOrder.shipping || {};
  const firstName = String(billing.first_name || shipping.first_name || '').trim();
  const lastName = String(billing.last_name || shipping.last_name || '').trim();
  return {
    buyerName: `${firstName} ${lastName}`.trim() || `خریدار ووکامرس #${wcOrderId}`,
    buyerPhone: String(billing.phone || shipping.phone || '').trim(),
    buyerCity: String(billing.city || shipping.city || '').trim(),
    buyerAddress: `${billing.address_1 || shipping.address_1 || ''} ${billing.address_2 || shipping.address_2 || ''}`.trim(),
  };
}

/** مبلغ عددی ووکامرس (رشته یا عدد)؛ خالی صفر و نامعتبر null */
function wcAmount(raw: unknown): FinancialDecimal | null {
  if (raw === undefined || raw === null || raw === '') return fin(0);
  const n = Number(raw);
  return Number.isFinite(n) ? fin(String(raw).trim()) : null;
}

/**
 * v7.0.103 (TD-191، تصمیم مالک محصول «ثبت کامل»): هزینه ارسال (shipping_lines، وگرنه shipping_total) و کارمزدها
 * (fee_lines) و مالیات (total_tax) سفارش، به واحد ووکامرس. null یعنی مبلغی نامعتبر است.
 */
function orderCharges(wcOrder: WcOrderPayload): { shipping: FinancialDecimal; fees: FinancialDecimal; feeDiscount: FinancialDecimal; tax: FinancialDecimal } | null {
  const sum = (rows: Array<{ total?: unknown }>, keep: (v: FinancialDecimal) => boolean = () => true): FinancialDecimal | null =>
    rows.reduce<FinancialDecimal | null>((acc, r) => {
      const v = wcAmount(r?.total);
      return acc && v ? (keep(v) ? acc.add(v) : acc) : null;
    }, fin(0));
  const feeRows = Array.isArray(wcOrder.fee_lines) ? wcOrder.fee_lines : [];
  const shipping = Array.isArray(wcOrder.shipping_lines) ? sum(wcOrder.shipping_lines) : wcAmount(wcOrder.shipping_total);
  // v8.0.42 (TD-295، تصمیم مالک محصول — گزینه الف): کارمزد مثبت هزینه خدمات است و کارمزد منفی تخفیف سفارش که روی سطرها پخش می‌شود
  const fees = sum(feeRows, v => v.isPositive());
  const negativeFees = sum(feeRows, v => v.isNegative());
  const tax = wcAmount(wcOrder.total_tax);
  return shipping && fees && negativeFees && tax ? { shipping, fees, feeDiscount: negativeFees.negate(), tax } : null;
}

/**
 * واحدهای ریالی ووکامرس و ضریب تبدیلشان به ریال. V10-2.3 (TD-022): تومان (IRT / TOMAN) ضریب ۱۰.
 * v8.0.39 (TD-292): «هزار تومان» (IRHT) و «هزار ریال» (IRHR) افزونه ووکامرس فارسی ضریب ۱۰٬۰۰۰ و ۱٬۰۰۰ دارند؛ پیش‌تر ارز
 * ناشناخته به حساب می‌آمدند و سفارش با خطای «نرخ تسعیر الزامی است» رد می‌شد.
 */
const RIAL_UNIT_MULTIPLIERS: ReadonlyMap<string, number> = new Map([
  ['IRR', 1], ['ریال', 1],
  ['IRT', 10], ['TOMAN', 10], ['تومان', 10],
  ['IRHR', 1_000], ['هزار ریال', 1_000],
  ['IRHT', 10_000], ['هزار تومان', 10_000],
]);

function resolveCurrency(wcOrder: WcOrderPayload): { multiplier: number; currency: string } {
  const raw = String(wcOrder.currency || '').trim().toUpperCase();
  const multiplier = RIAL_UNIT_MULTIPLIERS.get(raw || 'IRR');
  return multiplier !== undefined ? { multiplier, currency: 'IRR' } : { multiplier: 1, currency: raw };
}

/** بدنه وب‌هوک حذف فقط { id } است؛ بدنه کامل پیشین (مبنای مقایسه TD-294) با آن بازنویسی نمی‌شود */
function keptPayload(previous: unknown, incoming: WcOrderPayload): unknown {
  return Array.isArray(incoming.line_items) || !previous ? incoming : previous;
}

export class WooOrderSyncService {
  /** نقطه ورود واحد وب‌هوک و همگام‌سازی دستی؛ سیاست وضعیت‌ها را اعمال می‌کند. */
  static async handleOrder(wcOrder: WcOrderPayload, webhookTopic?: string): Promise<WcOrderSyncResult> {
    const wcOrderId = String(wcOrder?.id || wcOrder?.number || '').trim();
    if (!wcOrderId) {
      return {
        success: false,
        status: 'failed',
        message: 'داده‌های سفارش ووکامرس حاوی شماره سفارش معتبر نیست.',
        error: 'داده‌های سفارش ووکامرس حاوی شماره سفارش معتبر نیست.',
      };
    }

    const wcStatus = isWcOrderDeletedTopic(webhookTopic) ? 'trash' : String(wcOrder.status || '').trim().toLowerCase();
    if (WC_INVOICEABLE_STATUSES.has(wcStatus)) {
      return this.invoiceOrder(wcOrderId, wcOrder);
    }
    if (WC_VOIDABLE_STATUSES.has(wcStatus)) {
      return this.voidOrderInvoice(wcOrderId, wcOrder, wcStatus);
    }
    if (WC_REVIEW_STATUSES.has(wcStatus)) {
      return this.flagForReview(wcOrderId, wcOrder, wcStatus);
    }
    return this.deferOrder(wcOrderId, wcOrder, wcStatus);
  }

  /**
   * ردیف لاگ سفارش را (در صورت نبود) درج و قفل سطری می‌کند. درج همزمان روی ایندکس یکتای wc_order_id
   * تا پایان تراکنش اول منتظر می‌ماند؛ بنابراین فراخوان دوم همیشه نتیجه commitشده اولی را می‌بیند.
   */
  private static async lockOrderLog(tx: DbExecutor, wcOrderId: string): Promise<LockedLog> {
    await tx.insert(woocommerceOrderLogs)
      .values({ wcOrderId, status: 'received' })
      .onConflictDoNothing({ target: woocommerceOrderLogs.wcOrderId });
    const [log] = await tx.select()
      .from(woocommerceOrderLogs)
      .where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId))
      .for('update');
    return log;
  }

  /**
   * فاکتور فعال مرتبط با سفارش: ابتدا از لاگ، سپس (برای فاکتورهای قدیمی پیش از جدول لاگ) جستجوی
   * مرزدار در یادداشت فاکتور. (الف) LIKE قبلی «#12» را با «#123» تطبیق می‌داد.
   */
  private static async findActiveInvoice(
    tx: DbExecutor,
    wcOrderId: string,
    log: LockedLog
  ): Promise<{ id: number; refNumber: string; buyerName: string | null } | null> {
    if (log.erpDocumentId) {
      const [doc] = await tx.select({ id: documents.id, refNumber: documents.refNumber, buyerName: documents.buyerName })
        .from(documents)
        .where(and(eq(documents.id, log.erpDocumentId), eq(documents.isDeleted, 0)));
      if (doc) return doc;
    }
    const pattern = `${escapeRegex(notesTag(wcOrderId))}(\\D|$)`;
    const [legacy] = await tx.select({ id: documents.id, refNumber: documents.refNumber, buyerName: documents.buyerName })
      .from(documents)
      .where(and(
        eq(documents.type, 'invoice'),
        eq(documents.isDeleted, 0),
        sql`${documents.notes} ~ ${pattern}`
      ))
      .orderBy(asc(documents.id))
      .limit(1);
    return legacy ?? null;
  }

  private static async invoiceOrder(wcOrderId: string, wcOrder: WcOrderPayload): Promise<WcOrderSyncResult> {
    const buyer = extractBuyer(wcOrder, wcOrderId);
    try {
      return await orm.transaction(async (tx) => {
        const log = await this.lockOrderLog(tx, wcOrderId);

        if (log.status === 'processed' && log.erpDocumentId) {
          // v8.0.43 (TD-294، تصمیم مالک محصول — گزینه الف): سفارشِ فاکتورشده‌ای که اقلام یا مبلغش عوض شده یا استرداد تازه گرفته
          // «نیازمند بررسی» می‌شود؛ پیش‌تر فقط «قبلاً ثبت شده» پاسخ می‌گرفت و فاکتور بی‌هیچ علامتی با سفارش نمی‌خواند
          const change = describeOrderChange(log.payload as WcOrderPayload | null, wcOrder);
          if (change) {
            const message = `سفارش ووکامرس #${wcOrderId} پس از صدور فاکتور (شناسه ${log.erpDocumentId}) در فروشگاه تغییر کرد: ${change}. فاکتور نیازمند بررسی حسابدار است (ابطال و صدور دوباره، یا برگشت از فروش).`;
            await tx.update(woocommerceOrderLogs).set({
              status: 'needs_review',
              payload: wcOrder,
              errorMessage: message,
              updatedAt: systemNowUtcIso(),
            }).where(eq(woocommerceOrderLogs.id, log.id));
            logger.warn({ message: `[WooCommerce] ${message}` });
            return { success: true, status: 'needs_review' as const, alreadyExists: true, docId: log.erpDocumentId, message };
          }
          return {
            success: true,
            status: 'processed' as const,
            alreadyExists: true,
            docId: log.erpDocumentId,
            message: `فاکتور فروش مربوط به سفارش ووکامرس #${wcOrderId} قبلاً با شناسه ${log.erpDocumentId} ثبت گردیده است.`,
          };
        }
        if (log.status === 'needs_review') {
          return {
            success: true,
            status: 'needs_review' as const,
            alreadyExists: true,
            docId: log.erpDocumentId ?? undefined,
            message: `سفارش ووکامرس #${wcOrderId} در انتظار بررسی حسابدار است و فاکتور جدیدی صادر نمی‌شود.`,
          };
        }

        // فاکتورهای قدیمی که پیش از جدول لاگ صادر شده‌اند (فقط وقتی لاگ فاکتور دیگری را معرفی نکرده)
        if (log.status !== 'voided') {
          const legacy = await this.findActiveInvoice(tx, wcOrderId, log);
          if (legacy) {
            await tx.update(woocommerceOrderLogs).set({
              status: 'processed',
              erpDocumentId: legacy.id,
              buyerName: legacy.buyerName || buyer.buyerName,
              payload: wcOrder,
              errorMessage: '',
              updatedAt: systemNowUtcIso(),
            }).where(eq(woocommerceOrderLogs.id, log.id));
            return {
              success: true,
              status: 'processed' as const,
              alreadyExists: true,
              docId: legacy.id,
              refNumber: legacy.refNumber,
              message: `فاکتور فروش مربوط به سفارش ووکامرس #${wcOrderId} قبلاً در سیستم با شماره فاکتور ${legacy.refNumber} ثبت گردیده است.`,
            };
          }
        }

        // تطبیق اقلام: هر قلم باید SKU معتبر و مقدار مثبت داشته باشد؛ در غیر این صورت کل سفارش رد می‌شود
        const lineItems = Array.isArray(wcOrder.line_items) ? wcOrder.line_items : [];
        if (lineItems.length === 0) {
          return this.markFailed(tx, log, wcOrder, buyer.buyerName, 0, `سفارش ووکامرس #${wcOrderId} فاقد اقلام خرید است.`);
        }

        const { multiplier, currency } = resolveCurrency(wcOrder);
        const skus = [...new Set(lineItems.map(li => String(li.sku || '').trim()).filter(Boolean))];
        const erpItems = skus.length > 0
          ? await tx.select({ id: items.id, code: items.code })
            .from(items)
            .where(and(eq(items.isDeleted, 0), inArray(items.code, skus)))
            .orderBy(asc(items.id))
          : [];
        const itemBySku = new Map<string, number>();
        for (const it of erpItems) {
          if (it.code && !itemBySku.has(it.code)) itemBySku.set(it.code, it.id);
        }

        // v8.0.44 (TD-293، تصمیم مالک محصول — گزینه الف): فاکتور از «انبار فروشگاه اینترنتی» کم می‌کند (تنظیم wc_shop_warehouse؛
        // بی‌تنظیم انبار پیش‌فرض)، همان انباری که همگام‌سازی موجودی قابل فروشش را به فروشگاه می‌فرستد
        const targetLoc = await resolveShopWarehouseCode(tx);

        const docLines: Array<{ itemId: number; quantity: number; unit_price: number; discount?: number; location: string }> = [];
        const problems: string[] = [];
        let orderTotal = fin(0);
        for (const li of lineItems) {
          const sku = String(li.sku || '').trim();
          const label = String(li.name || 'قلم بدون نام');
          const qty = Number(li.quantity ?? 0);
          // v7.0.103 (TD-191): فی از جمع ردیف (total ÷ مقدار) تا جمع فاکتور با مبلغ سفارش یکی باشد؛ بدون total همان price
          const hasLineTotal = li.total !== undefined && li.total !== null && li.total !== '';
          const rawPrice = hasLineTotal
            ? (qty > 0 ? Number(li.total) / qty : NaN)
            : (li.price !== undefined && li.price !== null && li.price !== '' ? Number(li.price) : NaN);
          if (!Number.isFinite(qty) || qty <= 0) {
            problems.push(`${label} (مقدار نامعتبر: ${String(li.quantity)})`);
            continue;
          }
          if (!Number.isFinite(rawPrice) || rawPrice < 0) {
            problems.push(`${label} (قیمت نامعتبر)`);
            continue;
          }
          if (!sku) {
            problems.push(`${label} (فاقد SKU)`);
            continue;
          }
          const itemId = itemBySku.get(sku);
          if (!itemId) {
            problems.push(`${label} (SKU: ${sku})`);
            continue;
          }
          // v8.0.41 (TD-297): جمع ردیف دقیق می‌ماند؛ ردیف بخش‌ناپذیر دو سطر می‌شود (exactLineSplit)، نه فی با کسر ریال
          const parts = hasLineTotal
            ? exactLineSplit(fin(String(li.total).trim()).multiply(multiplier), qty, currencyScale(currency))
            : [{ quantity: qty, unitPrice: fin(rawPrice).multiply(multiplier).round(4) }];
          for (const part of parts) {
            orderTotal = orderTotal.add(fin(part.quantity).multiply(part.unitPrice));
            docLines.push({ itemId, quantity: part.quantity, unit_price: part.unitPrice.toNumber(), location: targetLoc });
          }
        }

        // v7.0.103 (TD-191، «ثبت کامل»): هزینه ارسال و کارمزدها روی فاکتور (درآمد حمل و خدمات) و مالیات سفارش در
        // vat_amount؛ جمع فاکتور باید با مبلغ پرداختی سفارش (total) برابر باشد، وگرنه کل سفارش رد می‌شود
        const charges = orderCharges(wcOrder);
        if (!charges) {
          problems.push('مبلغ ارسال، کارمزد یا مالیات سفارش نامعتبر است');
        }
        const serviceCharge = charges ? charges.shipping.add(charges.fees).multiply(multiplier).round(4) : fin(0);
        const orderVat = charges ? charges.tax.multiply(multiplier).round(4) : fin(0);
        // v8.0.42 (TD-295، گزینه الف): تخفیف کارمزدی به نسبت مبلغ سطرها تخفیف سطر می‌شود (مانند کوپن)؛ پیش‌تر کارمزد منفی از هزینه
        // ارسال کم می‌شد و اگر ارسالی برای جبرانش نبود، کل سفارش رد می‌شد
        const feeDiscount = charges ? charges.feeDiscount.multiply(multiplier).round(4) : fin(0);
        if (feeDiscount.isPositive() && problems.length === 0) {
          const shares = allocateFeeDiscount(docLines.map(l => fin(l.quantity).multiply(l.unit_price)), feeDiscount, currencyScale(currency));
          if (!shares) {
            problems.push(`تخفیف کارمزدی سفارش (${feeDiscount.toString()}) از جمع اقلام بیشتر است`);
          } else {
            shares.forEach((share, i) => { docLines[i].discount = share.toNumber(); });
            orderTotal = orderTotal.subtract(feeDiscount);
          }
        }
        if (serviceCharge.isNegative()) {
          problems.push(`جمع هزینه ارسال و کارمزدهای سفارش منفی است (${serviceCharge.toString()})`);
        }
        if (orderVat.isNegative()) {
          problems.push(`مالیات سفارش منفی است (${orderVat.toString()})`);
        }
        orderTotal = orderTotal.add(serviceCharge).add(orderVat);
        const orderTotalNum = orderTotal.round(2).toNumber();
        const paidTotal = wcAmount(wcOrder.total);
        if (problems.length === 0 && paidTotal && wcOrder.total !== undefined && wcOrder.total !== null && wcOrder.total !== '') {
          const paid = paidTotal.multiply(multiplier);
          if (orderTotal.subtract(paid).abs().greaterThan(fin(0.01).multiply(multiplier))) {
            return this.markFailed(
              tx, log, wcOrder, buyer.buyerName, orderTotalNum,
              `فاکتور سفارش ووکامرس #${wcOrderId} صادر نشد؛ جمع اقلام، ارسال، کارمزد و مالیات (${orderTotal.round(2).toString()}) با مبلغ پرداختی سفارش (${paid.round(2).toString()}) برابر نیست.`
            );
          }
        }

        if (problems.length > 0) {
          return this.markFailed(
            tx, log, wcOrder, buyer.buyerName, orderTotalNum,
            `فاکتور سفارش ووکامرس #${wcOrderId} صادر نشد؛ اقلام زیر با کالاهای سیستم تطبیق ندارند یا نامعتبرند: ${problems.join('، ')}. پس از تعریف/اصلاح کالا، سفارش را با «همگام‌سازی دستی» دوباره دریافت کنید.`
          );
        }

        // (ز) تطبیق یا ایجاد مشتری؛ نام فاکتور همان نام پرونده مشتری است تا سند حسابداری روی حساب
        // تفصیلی همان مشتری بنشیند. v9.0.332 (TD-703، ت۱ الف): خریدار هم‌نام با تلفن دیگر طرف حساب متمایز می‌گیرد
        const orderCustomer = await resolveWooOrderCustomer(tx, wcOrderId, buyer, WC_BOT_USER);
        const invoiceBuyerName = orderCustomer.name;

        const todayStr = await businessTodayIsoDate();
        const nextRef = await DocumentService.getNextRef('invoice', todayStr, tx);
        const newDocId = await DocumentService.createDocument({
          docType: 'invoice',
          refNumber: nextRef,
          date: todayStr,
          user: WC_BOT_USER,
          inOut: 'out',
          status: 'final',
          buyer_name: invoiceBuyerName,
          buyer_phone: buyer.buyerPhone,
          buyer_city: buyer.buyerCity,
          buyer_address: buyer.buyerAddress,
          notes: notesTag(wcOrderId),
          currency,
          vatAmount: orderVat.toNumber(),
          serviceChargeAmount: serviceCharge.toNumber(),
          items: docLines,
          location: targetLoc,
          externalTx: tx,
        });

        await tx.update(woocommerceOrderLogs).set({
          status: 'processed',
          erpDocumentId: newDocId,
          buyerName: invoiceBuyerName,
          totalAmount: money(orderTotalNum),
          payload: wcOrder,
          errorMessage: orderCustomer.note,
          updatedAt: systemNowUtcIso(),
        }).where(eq(woocommerceOrderLogs.id, log.id));

        // AGENTS §15: رویداد فقط از مسیر Outbox (اتمیک با فاکتور) منتشر می‌شود
        await OutboxService.saveToOutbox(tx, domainEventBus.createEvent(
          'woocommerce.order.synced',
          'WooCommerce',
          wcOrderId,
          { wcOrderId, docId: newDocId, refNumber: nextRef, buyerName: invoiceBuyerName, totalAmount: orderTotalNum },
          { userName: WC_BOT_USER }
        ));

        return {
          success: true,
          status: 'processed' as const,
          docId: newDocId,
          refNumber: nextRef,
          message: `فاکتور فروش شماره ${nextRef} جهت سفارش ووکامرس #${wcOrderId} با موفقیت صادر گردید و موجودی انبار کسر شد.${orderCustomer.note ? ` ${orderCustomer.note}` : ''}`,
        };
      });
    } catch (error) {
      // (ب) تراکنش اصلی rollback شده است؛ شکست در تراکنش مستقل ماندگار می‌شود
      const msg = error instanceof Error ? error.message : String(error);
      const message = `صدور فاکتور سفارش ووکامرس #${wcOrderId} ناموفق بود: ${msg}`;
      return this.persistFailure(wcOrderId, wcOrder, buyer.buyerName, 'failed', message);
    }
  }

  private static async markFailed(
    tx: DbExecutor,
    log: LockedLog,
    wcOrder: WcOrderPayload,
    buyerName: string,
    totalAmount: number,
    message: string
  ): Promise<WcOrderSyncResult> {
    await tx.update(woocommerceOrderLogs).set({
      status: 'failed',
      buyerName,
      totalAmount: money(totalAmount),
      payload: wcOrder,
      errorMessage: message,
      updatedAt: systemNowUtcIso(),
    }).where(eq(woocommerceOrderLogs.id, log.id));
    logger.warn({ message: `[WooCommerce] ${message}` });
    return { success: false, status: 'failed', message, error: message };
  }

  /**
   * ثبت شکست در تراکنش مستقل (پس از rollback تراکنش اصلی). وضعیت‌های تثبیت‌شده (فاکتور فعال یا
   * نیازمند بررسی) فقط پیام خطا می‌گیرند و وضعیتشان بازنویسی نمی‌شود.
   */
  private static async persistFailure(
    wcOrderId: string,
    wcOrder: WcOrderPayload,
    buyerName: string,
    status: 'failed' | 'needs_review',
    message: string
  ): Promise<WcOrderSyncResult> {
    logger.error({ message: `[WooCommerce] ${message}` });
    try {
      await orm.transaction(async (tx) => {
        const log = await this.lockOrderLog(tx, wcOrderId);
        const keepStatus = SETTLED_LOG_STATUSES.has(log.status) && status === 'failed';
        await tx.update(woocommerceOrderLogs).set({
          status: keepStatus ? log.status : status,
          buyerName: log.buyerName || buyerName,
          payload: wcOrder,
          errorMessage: message,
          updatedAt: systemNowUtcIso(),
        }).where(eq(woocommerceOrderLogs.id, log.id));
      });
    } catch (logErr) {
      logger.error({ message: `[WooCommerce] Could not persist failure log for order #${wcOrderId}`, error: logErr });
    }
    return { success: false, status, message, error: message };
  }

  private static async voidOrderInvoice(wcOrderId: string, wcOrder: WcOrderPayload, wcStatus: string): Promise<WcOrderSyncResult> {
    const buyer = extractBuyer(wcOrder, wcOrderId);
    try {
      return await orm.transaction(async (tx) => {
        const log = await this.lockOrderLog(tx, wcOrderId);
        if (log.status === 'voided') {
          return {
            success: true,
            status: 'voided' as const,
            alreadyExists: true,
            docId: log.erpDocumentId ?? undefined,
            message: `فاکتور سفارش ووکامرس #${wcOrderId} قبلاً ابطال شده است.`,
          };
        }
        if (log.status === 'needs_review') {
          return {
            success: true,
            status: 'needs_review' as const,
            alreadyExists: true,
            docId: log.erpDocumentId ?? undefined,
            message: `سفارش ووکامرس #${wcOrderId} در انتظار بررسی حسابدار است و ابطال خودکار انجام نمی‌شود.`,
          };
        }

        const invoice = await this.findActiveInvoice(tx, wcOrderId, log);
        const now = systemNowUtcIso();
        if (!invoice) {
          await tx.update(woocommerceOrderLogs).set({
            status: 'cancelled',
            buyerName: log.buyerName || buyer.buyerName,
            payload: wcOrder,
            errorMessage: '',
            updatedAt: now,
          }).where(eq(woocommerceOrderLogs.id, log.id));
          return {
            success: true,
            status: 'cancelled' as const,
            message: `سفارش ووکامرس #${wcOrderId} در وضعیت «${wcStatus}» است و فاکتوری برای ابطال ندارد.`,
          };
        }

        // DB-009: حذف نرم + تراکنش معکوس کاردکس + برگشت موجودی + سند حسابداری معکوس، همه در همین تراکنش
        await DocumentService.deleteDocument(invoice.id, WC_BOT_USER, tx);

        await tx.update(woocommerceOrderLogs).set({
          status: 'voided',
          erpDocumentId: invoice.id,
          payload: wcOrder,
          errorMessage: '',
          updatedAt: now,
        }).where(eq(woocommerceOrderLogs.id, log.id));

        await OutboxService.saveToOutbox(tx, domainEventBus.createEvent(
          'woocommerce.order.voided',
          'WooCommerce',
          wcOrderId,
          { wcOrderId, docId: invoice.id, refNumber: invoice.refNumber, wcStatus },
          { userName: WC_BOT_USER }
        ));

        return {
          success: true,
          status: 'voided' as const,
          docId: invoice.id,
          refNumber: invoice.refNumber,
          message: `فاکتور شماره ${invoice.refNumber} به دلیل وضعیت «${wcStatus}» سفارش ووکامرس #${wcOrderId} ابطال شد و موجودی به انبار برگشت.`,
        };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.persistFailure(
        wcOrderId, wcOrder, buyer.buyerName, 'needs_review',
        `ابطال خودکار فاکتور سفارش ووکامرس #${wcOrderId} (وضعیت «${wcStatus}») ناموفق بود و نیازمند بررسی حسابدار است: ${msg}`
      );
    }
  }

  private static async flagForReview(wcOrderId: string, wcOrder: WcOrderPayload, wcStatus: string): Promise<WcOrderSyncResult> {
    const buyer = extractBuyer(wcOrder, wcOrderId);
    return orm.transaction(async (tx) => {
      const log = await this.lockOrderLog(tx, wcOrderId);
      const invoice = log.status === 'voided' ? null : await this.findActiveInvoice(tx, wcOrderId, log);
      const now = systemNowUtcIso();
      if (!invoice) {
        const finalStatus: WcOrderLogStatus = log.status === 'voided' ? 'voided' : 'cancelled';
        await tx.update(woocommerceOrderLogs).set({
          status: finalStatus,
          buyerName: log.buyerName || buyer.buyerName,
          payload: keptPayload(log.payload, wcOrder),
          updatedAt: now,
        }).where(eq(woocommerceOrderLogs.id, log.id));
        return {
          success: true,
          status: finalStatus,
          message: `سفارش ووکامرس #${wcOrderId} در وضعیت «${wcStatus}» است و فاکتور فعالی ندارد.`,
        };
      }
      const message = wcStatus === 'trash'
        ? `سفارش ووکامرس #${wcOrderId} در فروشگاه حذف شد (سطل زباله)؛ فاکتور شماره ${invoice.refNumber} نیازمند بررسی حسابدار است (ابطال در صورت لغو فروش، یا نگه‌داشتن اگر حذف فقط پاک‌سازی فروشگاه بوده است).`
        : `سفارش ووکامرس #${wcOrderId} در فروشگاه مسترد شد؛ فاکتور شماره ${invoice.refNumber} نیازمند بررسی حسابدار است (ابطال یا صدور سند برگشت از فروش در صورت برگشت کالا).`;
      await tx.update(woocommerceOrderLogs).set({
        status: 'needs_review',
        erpDocumentId: invoice.id,
        payload: keptPayload(log.payload, wcOrder),
        errorMessage: message,
        updatedAt: now,
      }).where(eq(woocommerceOrderLogs.id, log.id));
      logger.warn({ message: `[WooCommerce] ${message}` });
      return { success: true, status: 'needs_review' as const, docId: invoice.id, refNumber: invoice.refNumber, message };
    });
  }

  private static async deferOrder(wcOrderId: string, wcOrder: WcOrderPayload, wcStatus: string): Promise<WcOrderSyncResult> {
    const buyer = extractBuyer(wcOrder, wcOrderId);
    return orm.transaction(async (tx) => {
      const log = await this.lockOrderLog(tx, wcOrderId);
      // فقط وضعیت‌های بدون فاکتور به «در انتظار پرداخت» می‌روند؛ فاکتور صادرشده/ابطال‌شده دست نمی‌خورد
      const becomesDeferred = DEFERRABLE_LOG_STATUSES.has(log.status);
      if (becomesDeferred) {
        await tx.update(woocommerceOrderLogs).set({
          status: 'deferred',
          buyerName: buyer.buyerName,
          payload: wcOrder,
          errorMessage: '',
          updatedAt: systemNowUtcIso(),
        }).where(eq(woocommerceOrderLogs.id, log.id));
      }
      return {
        success: true,
        status: becomesDeferred ? 'deferred' as const : log.status as WcOrderLogStatus,
        message: `سفارش ووکامرس #${wcOrderId} در وضعیت «${wcStatus || 'نامشخص'}» قرار دارد؛ فاکتور پس از پرداخت (وضعیت processing یا completed) صادر می‌شود.`,
      };
    });
  }
}
