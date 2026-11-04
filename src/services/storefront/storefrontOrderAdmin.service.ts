import fs from 'fs';
import type { Request } from 'express';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, storefrontOrders, storefrontPaymentReceipts } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { phoneSearchKey } from '../../lib/search/phoneMatchKey.js';
import { foldedContains } from '../../lib/search/searchSql.js';
import { toLatinDigits } from '../../lib/numericInput.js';
import { userHasRoleOrPermission } from '../../middleware/authorize.js';
import {
  OPEN_ORDER_STATUSES, REJECT_REASON_MAX, TRACKING_CODE_MAX, cleanText, isOrderStatus, type OrderStatus,
} from '../../lib/storefront/storefrontOrderRules.js';
import type { AdminOrderDetail, AdminOrderPage } from '../../lib/storefront/storefrontOrderContracts.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { documentAuditDetails } from '../documents/documentAudit.js';
import { DocumentService } from '../document.service.js';
import { TreasuryTransactionService } from '../accounting/treasury/treasuryTransaction.service.js';
import { adminOrderView, paymentMethodOf, type OrderRecord } from './storefrontOrderView.js';
import { receiptImageFile } from './storefrontReceiptImage.js';
import { rialText } from './storefrontShipping.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import { queueOrderSms } from './storefrontSms.service.js';
import { releaseDiscount } from './storefrontDiscountApply.js';

/**
 * v11 phase 8.2a (start plan §5): the «سفارش‌های سایت» screen of the ERP. Every action locks the order row first and
 * checks the version the screen was opened with (`AGENTS.md` §2.7), then works in one transaction with one audit row:
 * - confirm: the receipt's amount must equal the order's payable amount; the stock rows of the order are locked, then a
 *   treasury receipt is posted into the chosen account through the one treasury path, linked to the proforma (bank, then
 *   document, the treasury's lock order), and the proforma is finalized into the invoice through the documents service
 *   (stock out of the site's warehouse, the draft voucher). It needs, besides `site_orders.manage`, the treasury and
 *   finalize permissions, since it moves money and stock.
 * - reject: the receipt gets its reason and the order waits for payment again with a fresh reservation window.
 * - cancel: the proforma is voided (its reservation released) through the documents service.
 * - approve on account (8.2b part 2): an on-account order's proforma becomes the invoice, with no treasury row.
 * - fulfil: «ارسال‌شده» with the post's tracking code, then «تحویل‌شده».
 */
export const ADMIN_ORDER_PAGE_MAX = 100;

export interface AdminOrderQuery {
  page: number;
  limit: number;
  status: OrderStatus | 'open' | '';
  q: string;
}

const actorOf = (req: Request) => ({
  userId: req.user?.id, username: req.user?.fullName || req.user?.username || 'کاربر', userFullName: req.user?.fullName,
});

export async function listOrders(query: AdminOrderQuery): Promise<AdminOrderPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(ADMIN_ORDER_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [];
  if (query.status === 'open') conditions.push(inArray(storefrontOrders.status, [...OPEN_ORDER_STATUSES]));
  else if (query.status) conditions.push(eq(storefrontOrders.status, query.status));
  const q = query.q.trim();
  if (q) {
    const phoneKey = phoneSearchKey(q);
    const matches: SQL[] = [eq(storefrontOrders.orderNumber, toLatinDigits(q))];
    const text = foldedContains([storefrontOrders.recipientName, storefrontOrders.city], q);
    if (text) matches.push(text);
    if (phoneKey) matches.push(foldedContains([storefrontOrders.phoneKey], phoneKey)!);
    conditions.push(or(...matches)!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontOrders).where(where);
  const rows = await orm.select({
    id: storefrontOrders.id, number: storefrontOrders.orderNumber, createdAt: storefrontOrders.createdAt,
    recipientName: storefrontOrders.recipientName, phone: storefrontOrders.phone, city: storefrontOrders.city, status: storefrontOrders.status,
    payableAmount: storefrontOrders.payableAmount, reserveUntil: storefrontOrders.reserveUntil,
    paymentMethod: storefrontOrders.paymentMethod,
    hasPendingReceipt: sql<boolean>`EXISTS (SELECT 1 FROM storefront_payment_receipts r WHERE r.order_id = ${storefrontOrders.id} AND r.status = 'pending')`,
  }).from(storefrontOrders).where(where)
    .orderBy(desc(storefrontOrders.createdAt), desc(storefrontOrders.id))
    .limit(limit).offset((page - 1) * limit);
  return {
    data: rows.map(r => {
      const status: OrderStatus = isOrderStatus(r.status) ? r.status : 'awaiting_payment';
      return {
        id: r.id, number: r.number, createdAt: r.createdAt, recipientName: r.recipientName, phone: r.phone, city: r.city, status,
        payableAmount: rialText(r.payableAmount), hasPendingReceipt: Boolean(r.hasPendingReceipt),
        payBefore: status === 'awaiting_payment' || status === 'awaiting_approval' ? r.reserveUntil : null,
        paymentMethod: paymentMethodOf(r),
      };
    }),
    total, page, limit,
  };
}

async function orderById(executor: DbExecutor, id: number, lock = false): Promise<OrderRecord> {
  const query = executor.select().from(storefrontOrders).where(eq(storefrontOrders.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('سفارش سایت پیدا نشد.', undefined, 'STOREFRONT_ORDER_NOT_FOUND');
  return row;
}

export async function orderDetail(id: number): Promise<AdminOrderDetail> {
  return adminOrderView(orm, await orderById(orm, id));
}

/** Locks the order and checks the screen's version (stale = 409) */
async function lockedOrder(tx: DbExecutor, id: number, version: number): Promise<OrderRecord> {
  const order = await orderById(tx, id, true);
  if (order.version !== version) {
    throw new OptimisticLockError({ entityType: 'StorefrontOrder', entityId: String(id), expectedVersion: version, currentVersion: order.version });
  }
  return order;
}

async function moveOrder(tx: DbExecutor, order: OrderRecord, by: string, set: PgUpdateSetSource<typeof storefrontOrders>): Promise<OrderRecord> {
  const [row] = await tx.update(storefrontOrders).set({ ...set, updatedAt: systemNowUtcIso(), updatedBy: by, version: sql`${storefrontOrders.version} + 1` })
    .where(eq(storefrontOrders.id, order.id)).returning();
  return row;
}

async function pendingReceipt(tx: DbExecutor, order: OrderRecord, receiptId: number) {
  const [receipt] = await tx.select().from(storefrontPaymentReceipts)
    .where(and(eq(storefrontPaymentReceipts.id, receiptId), eq(storefrontPaymentReceipts.orderId, order.id))).for('update');
  if (!receipt) throw new NotFoundError('رسید پیدا نشد.', undefined, 'STOREFRONT_RECEIPT_NOT_FOUND');
  if (receipt.status !== 'pending') throw new ConflictError('این رسید پیش‌تر بررسی شده است.', undefined, 'STOREFRONT_RECEIPT_REVIEWED');
  return receipt;
}

const assertOpen = (order: OrderRecord) => {
  if (!OPEN_ORDER_STATUSES.includes(order.status as OrderStatus)) {
    throw new ConflictError('این سفارش دیگر در انتظار پرداخت نیست.', undefined, 'STOREFRONT_ORDER_NOT_OPEN');
  }
};

/** The order's document must still be its live proforma (a colleague may have voided or finalized it in the ERP) */
async function assertLiveProforma(tx: DbExecutor, order: OrderRecord): Promise<void> {
  const [doc] = await tx.select({ status: documents.status, isDeleted: documents.isDeleted }).from(documents).where(eq(documents.id, order.documentId));
  if (!doc || doc.isDeleted === 1 || doc.status !== 'proforma') {
    throw new ConflictError('پیش‌فاکتور این سفارش در ERP باطل یا قطعی شده است؛ سفارش را از همان سند پیگیری کنید.', undefined, 'STOREFRONT_PROFORMA_CHANGED');
  }
}

export async function confirmPayment(req: Request, id: number, input: { receiptId: number; version: number }): Promise<AdminOrderDetail> {
  const mayPost = await userHasRoleOrPermission(req.user, 'accounting.treasury');
  const mayFinalize = await userHasRoleOrPermission(req.user, 'documents.finalize');
  if (!mayPost || !mayFinalize) {
    throw new ForbiddenError('تأیید پرداخت دریافت خزانه ثبت می‌کند و فاکتور را قطعی می‌کند؛ مجوز خزانه و قطعی کردن سند هم لازم است.', undefined, 'STOREFRONT_CONFIRM_FORBIDDEN');
  }
  const actor = actorOf(req);
  const settings = await storefrontSettingValues(orm);
  if (!settings.treasuryAccountId) {
    throw new ValidationError('حساب دریافت کارت‌به‌کارت در تنظیمات «فروشگاه سایت» انتخاب نشده است.', undefined, 'STOREFRONT_TREASURY_ACCOUNT_UNSET');
  }
  return orm.transaction(async (tx) => {
    const order = await lockedOrder(tx, id, input.version);
    assertOpen(order);
    const receipt = await pendingReceipt(tx, order, input.receiptId);
    const payable = rialText(order.payableAmount);
    if (rialText(receipt.amount) !== payable) {
      throw new ValidationError('مبلغ رسید با مبلغ قابل پرداخت سفارش برابر نیست؛ رسید را رد کنید یا با خریدار هماهنگ کنید.', { receipt: rialText(receipt.amount), payable }, 'STOREFRONT_RECEIPT_AMOUNT_MISMATCH');
    }
    // the document's items first (its finalize locks them again), then the treasury's bank and document locks
    const lines = await tx.select({ itemId: documentItems.itemId }).from(documentItems)
      .where(and(eq(documentItems.documentId, order.documentId), eq(documentItems.isDeleted, 0)));
    await lockStockItems(tx, lines.map(l => l.itemId));
    await assertLiveProforma(tx, order);
    const posted = await TreasuryTransactionService.createTreasuryTransaction({
      type: 'receipt', method: 'bank_transfer', amount: Number(payable), currency: 'IRR', bankAccountId: settings.treasuryAccountId,
      partyType: 'customer', partyId: order.customerId, partyName: order.recipientName, trackingNumber: receipt.reference,
      documentId: order.documentId, description: `دریافت کارت‌به‌کارت سفارش سایت ${order.orderNumber}`,
      userId: actor.userId, username: actor.username, audit: { req, userFullName: actor.userFullName },
    }, tx);
    const change = await DocumentService.finalizeDocument(order.documentId, actor.username, tx);
    if (change) {
      await logActivity({
        req, tx, action: 'UPDATE', entity: 'اسناد انبار', entityId: order.documentId,
        description: `نهایی‌سازی پیش‌فاکتور سفارش سایت ${order.orderNumber} با تأیید پرداخت (فاکتور "${change.after?.refNumber ?? order.documentId}")`,
        details: documentAuditDetails(change.before, change.after),
      });
    }
    const now = systemNowUtcIso();
    await tx.update(storefrontPaymentReceipts).set({
      status: 'accepted', reviewedBy: actor.username, reviewedAt: now, treasuryTransactionId: posted.id,
    }).where(eq(storefrontPaymentReceipts.id, receipt.id));
    const updated = await moveOrder(tx, order, actor.username, { status: 'paid', paidAt: now });
    await queueOrderSms(tx, updated, 'order_paid');
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `پرداخت سفارش سایت ${order.orderNumber} تأیید شد`,
      details: { before: { status: order.status }, after: { status: 'paid', receiptId: receipt.id, treasuryTransactionId: posted.id, amount: payable } },
    });
    return adminOrderView(tx, updated);
  });
}

/**
 * v11 phase 8.2b part 2 (start plan §6): «تأیید سفارش به حساب». An on-account order needs no receipt: the colleague,
 * having looked at the customer's balance and the group's credit limit in the ERP, turns its proforma into the invoice
 * on the customer's account (stock out of the site's warehouse, the draft voucher), in one transaction. No treasury row
 * is made, so only the finalize permission is needed besides `site_orders.manage`. The balance never goes to the site.
 */
export async function approveOnAccount(req: Request, id: number, input: { version: number }): Promise<AdminOrderDetail> {
  if (!(await userHasRoleOrPermission(req.user, 'documents.finalize'))) {
    throw new ForbiddenError('تأیید سفارش به حساب فاکتور را قطعی می‌کند؛ مجوز قطعی کردن سند هم لازم است.', undefined, 'STOREFRONT_CONFIRM_FORBIDDEN');
  }
  const actor = actorOf(req);
  return orm.transaction(async (tx) => {
    const order = await lockedOrder(tx, id, input.version);
    if (order.status !== 'awaiting_approval' || paymentMethodOf(order) !== 'on_account') {
      throw new ConflictError('این سفارش در انتظار تأیید به حساب نیست.', undefined, 'STOREFRONT_ORDER_NOT_OPEN');
    }
    const lines = await tx.select({ itemId: documentItems.itemId }).from(documentItems)
      .where(and(eq(documentItems.documentId, order.documentId), eq(documentItems.isDeleted, 0)));
    await lockStockItems(tx, lines.map(l => l.itemId));
    await assertLiveProforma(tx, order);
    const change = await DocumentService.finalizeDocument(order.documentId, actor.username, tx);
    if (change) {
      await logActivity({
        req, tx, action: 'UPDATE', entity: 'اسناد انبار', entityId: order.documentId,
        description: `نهایی‌سازی پیش‌فاکتور سفارش سایت ${order.orderNumber} با تأیید سفارش به حساب (فاکتور "${change.after?.refNumber ?? order.documentId}")`,
        details: documentAuditDetails(change.before, change.after),
      });
    }
    const updated = await moveOrder(tx, order, actor.username, { status: 'confirmed', confirmedAt: systemNowUtcIso() });
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} به حساب تأیید شد`,
      details: { before: { status: order.status }, after: { status: 'confirmed', paymentMethod: 'on_account', payable: rialText(order.payableAmount) } },
    });
    return adminOrderView(tx, updated);
  });
}

export async function rejectReceipt(req: Request, id: number, input: { receiptId: number; reason: string; version: number }): Promise<AdminOrderDetail> {
  const reason = cleanText(input.reason, REJECT_REASON_MAX);
  if (!reason) throw new ValidationError('دلیل رد رسید را بنویسید؛ خریدار آن را می‌بیند.', undefined, 'STOREFRONT_REJECT_REASON_REQUIRED');
  const actor = actorOf(req);
  const settings = await storefrontSettingValues(orm);
  return orm.transaction(async (tx) => {
    const order = await lockedOrder(tx, id, input.version);
    assertOpen(order);
    const receipt = await pendingReceipt(tx, order, input.receiptId);
    await tx.update(storefrontPaymentReceipts).set({ status: 'rejected', rejectReason: reason, reviewedBy: actor.username, reviewedAt: systemNowUtcIso() })
      .where(eq(storefrontPaymentReceipts.id, receipt.id));
    // the buyer gets a fresh window to pay or send the right receipt; the proforma keeps its reservation meanwhile
    const updated = await moveOrder(tx, order, actor.username, {
      status: 'awaiting_payment', reserveUntil: sql`GREATEST(${storefrontOrders.reserveUntil}, now() + make_interval(hours => ${settings.reservationHours}))`,
    });
    await queueOrderSms(tx, updated, 'receipt_rejected');
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `رسید سفارش سایت ${order.orderNumber} رد شد`,
      details: { before: { status: order.status }, after: { status: 'awaiting_payment', receiptId: receipt.id, reason } },
    });
    return adminOrderView(tx, updated);
  });
}

/** Voids the order's proforma (its reservation is released) and cancels the order; used by the screen and the expiry sweep */
export async function cancelOpenOrder(tx: DbExecutor, order: OrderRecord, reason: 'staff' | 'expired', actor: { userId?: number; username: string; userFullName?: string }): Promise<OrderRecord> {
  const [doc] = await tx.select({ status: documents.status, isDeleted: documents.isDeleted }).from(documents).where(eq(documents.id, order.documentId));
  if (doc && doc.isDeleted === 0) {
    if (doc.status !== 'proforma') {
      throw new ConflictError('پیش‌فاکتور این سفارش در ERP قطعی شده است؛ لغو آن از مسیر برگشت از فروش است.', undefined, 'STOREFRONT_PROFORMA_CHANGED');
    }
    await DocumentService.deleteDocument(order.documentId, actor.username, tx, {
      actor, note: reason === 'expired' ? `مهلت پرداخت سفارش سایت ${order.orderNumber} گذشت` : `لغو سفارش سایت ${order.orderNumber}`,
    });
  }
  await tx.update(storefrontPaymentReceipts).set({ status: 'rejected', rejectReason: 'سفارش لغو شد', reviewedBy: actor.username, reviewedAt: systemNowUtcIso() })
    .where(and(eq(storefrontPaymentReceipts.orderId, order.id), eq(storefrontPaymentReceipts.status, 'pending')));
  const cancelled = await moveOrder(tx, order, actor.username, { status: 'cancelled', cancelReason: reason, cancelledAt: systemNowUtcIso() });
  // v11 phase 8.2c: a cancelled order (by a colleague or when its time ran out) gives its discount code's use back
  await releaseDiscount(tx, order.id);
  await queueOrderSms(tx, cancelled, 'order_cancelled');
  return cancelled;
}

export async function cancelOrder(req: Request, id: number, input: { version: number }): Promise<AdminOrderDetail> {
  const actor = actorOf(req);
  return orm.transaction(async (tx) => {
    const order = await lockedOrder(tx, id, input.version);
    assertOpen(order);
    const updated = await cancelOpenOrder(tx, order, 'staff', actor);
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} لغو شد`,
      details: { before: { status: order.status }, after: { status: 'cancelled', cancelReason: 'staff' } },
    });
    return adminOrderView(tx, updated);
  });
}

export async function fulfilOrder(req: Request, id: number, input: { status: 'shipped' | 'delivered'; trackingCode: string; version: number }): Promise<AdminOrderDetail> {
  const actor = actorOf(req);
  const trackingText = String(input.trackingCode ?? '').trim();
  const trackingCode = trackingText ? cleanText(trackingText, TRACKING_CODE_MAX) : '';
  if (trackingCode === null) throw new ValidationError(`کد رهگیری حداکثر ${TRACKING_CODE_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'STOREFRONT_TRACKING_CODE_INVALID');
  return orm.transaction(async (tx) => {
    const order = await lockedOrder(tx, id, input.version);
    const from: readonly string[] = input.status === 'shipped' ? ['paid', 'confirmed'] : ['shipped'];
    if (!from.includes(order.status)) {
      throw new ConflictError(input.status === 'shipped' ? 'فقط سفارش پرداخت‌شده یا تأییدشده به حساب ارسال می‌شود.' : 'فقط سفارش ارسال‌شده تحویل می‌شود.', undefined, 'STOREFRONT_ORDER_STEP_INVALID');
    }
    const now = systemNowUtcIso();
    const updated = await moveOrder(tx, order, actor.username, input.status === 'shipped'
      ? { status: 'shipped', shippedAt: now, trackingCode: trackingCode || order.trackingCode }
      : { status: 'delivered', deliveredAt: now, ...(trackingCode ? { trackingCode } : {}) });
    await queueOrderSms(tx, updated, input.status === 'shipped' ? 'order_shipped' : 'order_delivered');
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} ${input.status === 'shipped' ? 'ارسال' : 'تحویل'} شد`,
      details: { before: { status: order.status, trackingCode: order.trackingCode }, after: { status: updated.status, trackingCode: updated.trackingCode } },
    });
    return adminOrderView(tx, updated);
  });
}

/** The photo a buyer sent with a receipt of this order (at most 3 MB, so it is read whole); 404 when there is none */
export async function receiptImage(orderId: number, receiptId: number): Promise<{ buffer: Buffer; mime: string }> {
  const notFound = new NotFoundError('تصویری برای این رسید نیست.', undefined, 'STOREFRONT_RECEIPT_IMAGE_NOT_FOUND');
  const [receipt] = await orm.select({ id: storefrontPaymentReceipts.id }).from(storefrontPaymentReceipts)
    .where(and(eq(storefrontPaymentReceipts.id, receiptId), eq(storefrontPaymentReceipts.orderId, orderId)));
  if (!receipt) throw notFound;
  const file = await receiptImageFile(orm, receipt.id);
  if (!file) throw notFound;
  try {
    return { buffer: await fs.promises.readFile(file.absolutePath), mime: file.mime };
  } catch {
    throw notFound;
  }
}
