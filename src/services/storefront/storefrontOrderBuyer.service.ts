import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { storefrontOrders, storefrontPaymentReceipts } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { rialAmountText } from '../../lib/storefront/storefrontRules.js';
import { money } from '../../lib/money.js';
import { RECEIPTS_PER_ORDER_MAX, normalizeCardLast4, normalizeReference } from '../../lib/storefront/storefrontOrderRules.js';
import type { BuyerOrder, ReceiptRequest } from '../../lib/storefront/storefrontOrderContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { orderForKey } from './storefrontOrderPlace.service.js';
import { buyerOrderView } from './storefrontOrderView.js';
import { notifySiteOrder } from './storefrontOrderNotices.js';
import { receiptImageOf, storeReceiptImage } from './storefrontReceiptImage.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.2a (start plan §5): what the buyer who holds an order's key does with it: read the order and send a
 * card-to-card receipt. A receipt is taken only while the order waits for payment and before its reservation ends; it
 * moves the order to «در انتظار تأیید پرداخت», which stops the reservation clock until a colleague decides (§5).
 */
const RECEIPT_PAST_DAYS = 30;
const RECEIPT_FUTURE_SLACK_MS = 10 * 60_000;

async function orderingOn() {
  const settings = await storefrontSettingValues(orm);
  if (!settings.enabled || !settings.ordersEnabled) throw new NotFoundError('پیدا نشد');
  return settings;
}

export async function buyerOrder(orderNumber: string, accessKey: string): Promise<BuyerOrder> {
  const settings = await orderingOn();
  const order = await orderForKey(orm, orderNumber, accessKey);
  return buyerOrderView(orm, order, settings);
}

const fieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_RECEIPT_FIELD_INVALID');

function cleanReceipt(input: ReceiptRequest, nowMs: number) {
  const reference = normalizeReference(input.reference);
  if (!reference) throw fieldError('reference', 'شمارهٔ پیگیری یا ارجاع واریز را درست بنویسید (۴ تا ۴۰ رقم یا حرف لاتین).');
  const cardLast4 = normalizeCardLast4(input.cardLast4);
  if (!cardLast4) throw fieldError('cardLast4', 'چهار رقم آخر کارتی را که با آن پرداخت کردید بنویسید.');
  const amount = rialAmountText(input.amount, { allowZero: false });
  if (!amount) throw fieldError('amount', 'مبلغ واریزی را به ریال بنویسید.');
  const paidMs = Date.parse(String(input.paidAt ?? ''));
  if (!Number.isFinite(paidMs)) throw fieldError('paidAt', 'تاریخ و ساعت واریز را بنویسید.');
  if (paidMs > nowMs + RECEIPT_FUTURE_SLACK_MS) throw fieldError('paidAt', 'زمان واریز نمی‌تواند در آینده باشد.');
  if (paidMs < nowMs - RECEIPT_PAST_DAYS * 86_400_000) throw fieldError('paidAt', 'زمان واریز بیش از یک ماه پیش است؛ با فروشگاه تماس بگیرید.');
  return { reference, cardLast4, amount, paidAt: new Date(paidMs).toISOString() };
}

export async function sendReceipt(orderNumber: string, accessKey: string, input: ReceiptRequest): Promise<BuyerOrder> {
  const settings = await orderingOn();
  const receipt = cleanReceipt(input, Date.parse(systemNowUtcIso()));
  const image = receiptImageOf(input.image);
  return orm.transaction(async (tx) => {
    const order = await orderForKey(tx, orderNumber, accessKey, { lock: true });
    if (order.status !== 'awaiting_payment') {
      throw new ConflictError('برای این سفارش اکنون رسید پذیرفته نمی‌شود.', undefined, 'STOREFRONT_RECEIPT_NOT_EXPECTED');
    }
    const [{ due }] = (await tx.execute(sql`SELECT (${order.reserveUntil}::timestamptz <= now()) AS due`)).rows as Array<{ due: boolean }>;
    if (due) throw new ConflictError('مهلت پرداخت این سفارش گذشته است.', undefined, 'STOREFRONT_ORDER_EXPIRED');
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(storefrontPaymentReceipts).where(eq(storefrontPaymentReceipts.orderId, order.id));
    if (count >= RECEIPTS_PER_ORDER_MAX) {
      throw new ConflictError('برای این سفارش بیش از این رسید پذیرفته نمی‌شود؛ با فروشگاه تماس بگیرید.', undefined, 'STOREFRONT_RECEIPTS_LIMIT');
    }
    const [created] = await tx.insert(storefrontPaymentReceipts).values({ orderId: order.id, ...receipt, amount: money(receipt.amount) }).returning({ id: storefrontPaymentReceipts.id });
    if (image) await storeReceiptImage(tx, created.id, image);
    const [updated] = await tx.update(storefrontOrders).set({
      status: 'payment_submitted', updatedAt: systemNowUtcIso(), updatedBy: STOREFRONT_BOT_USER, version: sql`${storefrontOrders.version} + 1`,
    }).where(eq(storefrontOrders.id, order.id)).returning();
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'سفارش سایت', entityId: order.id,
      description: `رسید کارت‌به‌کارت سفارش سایت ${order.orderNumber} ثبت شد`,
      details: { receiptId: created.id, hasImage: Boolean(image), before: { status: order.status }, after: { status: 'payment_submitted', amount: receipt.amount, cardLast4: receipt.cardLast4 } },
    });
    await notifySiteOrder(tx, 'receipt', updated);
    return buyerOrderView(tx, updated, settings);
  });
}
