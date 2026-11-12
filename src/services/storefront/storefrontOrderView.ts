import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import {
  documentItems, documents, items, storefrontBuyerAccounts, storefrontDiscountCodes, storefrontBuyerGroups, storefrontOrders, storefrontPaymentReceipts, storefrontProducts,
} from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import {
  CANCEL_REASON_TITLES, NEXT_FULFILMENT, ORDER_STATUS_TITLES, PAYMENT_METHOD_TITLES, RECEIPTS_PER_ORDER_MAX, RECEIPT_STATUS_TITLES, isOrderStatus,
  isPaymentMethod, tomanText, type CancelReason, type OrderStatus, type PaymentMethod, type ReceiptStatus,
} from '../../lib/storefront/storefrontOrderRules.js';
import type { AdminOrderDetail, AdminReceipt, BuyerOrder, BuyerOrderLine } from '../../lib/storefront/storefrontOrderContracts.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import { rialText } from './storefrontShipping.service.js';
import { receiptIdsWithImage } from './storefrontReceiptImage.js';
import { appliedDiscount } from './storefrontDiscountApply.js';
import type { AppliedDiscount } from '../../lib/storefront/storefrontDiscountContracts.js';

/**
 * v11 phase 8.2a: what a buyer and the ERP orders screen see of an order. The lines are read from the order's document
 * (the proforma, or the invoice it became), so the site shows exactly what the ERP sold; the payment card is shown only
 * while the order waits for payment, and the buyer's answer has no ERP id, document number or reviewer.
 */
export type OrderRecord = typeof storefrontOrders.$inferSelect;
type ReceiptRecord = typeof storefrontPaymentReceipts.$inferSelect;

const status = (order: OrderRecord): OrderStatus => (isOrderStatus(order.status) ? order.status : 'awaiting_payment');
export const paymentMethodOf = (order: Pick<OrderRecord, 'paymentMethod'>): PaymentMethod => (isPaymentMethod(order.paymentMethod) ? order.paymentMethod : 'card');

async function linesOf(executor: DbExecutor, documentId: number): Promise<BuyerOrderLine[]> {
  const rows = await executor.select({
    slug: storefrontProducts.slug, sku: items.code, name: items.name,
    quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount,
  }).from(documentItems)
    .innerJoin(items, eq(items.id, documentItems.itemId))
    .leftJoin(storefrontProducts, eq(storefrontProducts.itemId, documentItems.itemId))
    .where(and(eq(documentItems.documentId, documentId), eq(documentItems.isDeleted, 0)))
    .orderBy(asc(documentItems.id));
  return rows.map(r => {
    const unit = r.unitPrice ?? fin(0);
    const line = unit.multiply(r.quantity).subtract(r.discount ?? fin(0));
    return { slug: r.slug ?? '', sku: r.sku, name: r.name, quantity: Number(r.quantity), unitPrice: unit.round(0).toString(), lineAmount: line.round(0).toString() };
  });
}

async function receiptsOf(executor: DbExecutor, orderId: number): Promise<ReceiptRecord[]> {
  return executor.select().from(storefrontPaymentReceipts).where(eq(storefrontPaymentReceipts.orderId, orderId)).orderBy(asc(storefrontPaymentReceipts.id));
}

function receiptStatus(value: string): ReceiptStatus {
  return value === 'accepted' || value === 'rejected' ? value : 'pending';
}

function cancelReasonOf(order: OrderRecord): CancelReason | null {
  return order.cancelReason === 'expired' || order.cancelReason === 'staff' ? order.cancelReason : null;
}

/** v11 phase 8.2c: the code the order used (its title as it is now) and the amount taken off its lines */
async function discountOf(executor: DbExecutor, order: OrderRecord): Promise<AppliedDiscount | null> {
  if (order.discountCodeId === null) return null;
  const [code] = await executor.select({ title: storefrontDiscountCodes.title }).from(storefrontDiscountCodes)
    .where(eq(storefrontDiscountCodes.id, order.discountCodeId));
  return appliedDiscount(order.discountCode, code?.title ?? '', rialText(order.discountAmount));
}

async function common(executor: DbExecutor, order: OrderRecord) {
  const orderStatus = status(order);
  const reason = cancelReasonOf(order);
  const payable = rialText(order.payableAmount);
  return {
    number: order.orderNumber,
    status: orderStatus,
    statusTitle: ORDER_STATUS_TITLES[orderStatus],
    createdAt: order.createdAt,
    payBefore: orderStatus === 'awaiting_payment' ? order.reserveUntil : null,
    // v12 phase 8c (site review 2.5): the recipient's own phone when another person gave one, else the buyer's
    recipient: {
      name: order.recipientName, phone: order.recipientPhone || order.phone, province: order.province, city: order.city, address: order.address,
      postalCode: order.postalCode,
    },
    orderedBy: { name: order.buyerName || order.recipientName, phone: order.phone, email: order.email },
    gift: order.isGift === 1 ? { message: order.giftMessage } : null,
    note: order.buyerNote,
    shipping: {
      code: order.shippingMethodCode, title: order.shippingMethodTitle,
      kind: order.shippingOnDelivery === 1 ? 'on_delivery' as const : 'cost' as const, amount: rialText(order.shippingAmount),
    },
    lines: await linesOf(executor, order.documentId),
    itemsAmount: rialText(order.itemsAmount),
    payableAmount: payable,
    payableToman: tomanText(payable),
    trackingCode: order.trackingCode,
    cancelReason: reason,
    cancelReasonTitle: reason ? CANCEL_REASON_TITLES[reason] : '',
    paymentMethod: paymentMethodOf(order),
    paymentMethodTitle: PAYMENT_METHOD_TITLES[paymentMethodOf(order)],
    wholesale: order.buyerGroupId !== null,
    discount: await discountOf(executor, order),
  };
}

const buyerReceipt = (r: ReceiptRecord) => {
  const s = receiptStatus(r.status);
  return {
    reference: r.reference, paidAt: r.paidAt, cardLast4: r.cardLast4, amount: rialText(r.amount),
    status: s, statusTitle: RECEIPT_STATUS_TITLES[s], rejectReason: r.rejectReason, createdAt: r.createdAt,
  };
};

export async function buyerOrderView(executor: DbExecutor, order: OrderRecord, settings: StorefrontSettingsInput): Promise<BuyerOrder> {
  const base = await common(executor, order);
  const receipts = await receiptsOf(executor, order.id);
  // an on-account order is never «awaiting_payment», so it never shows the card
  const awaiting = base.status === 'awaiting_payment';
  return {
    ...base,
    payment: awaiting ? { cardNumber: settings.cardNumber, cardHolder: settings.cardHolder, bankName: settings.bankName, iban: settings.iban } : null,
    canSendReceipt: awaiting && receipts.length < RECEIPTS_PER_ORDER_MAX,
    receipts: receipts.map(buyerReceipt),
  };
}

export async function adminOrderView(executor: DbExecutor, order: OrderRecord): Promise<AdminOrderDetail> {
  const base = await common(executor, order);
  const receipts = await receiptsOf(executor, order.id);
  const [doc] = await executor.select({ refNumber: documents.refNumber, status: documents.status, isDeleted: documents.isDeleted })
    .from(documents).where(eq(documents.id, order.documentId));
  const withImage = await receiptIdsWithImage(executor, receipts.map(r => r.id));
  const pending = receipts.some(r => r.status === 'pending');
  const open = base.status === 'awaiting_payment' || base.status === 'payment_submitted' || base.status === 'awaiting_approval';
  const [buyer] = order.buyerAccountId === null ? [] : await executor.select({
    accountId: storefrontBuyerAccounts.id, name: storefrontBuyerAccounts.name, companyName: storefrontBuyerAccounts.companyName,
  }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, order.buyerAccountId));
  const [group] = order.buyerGroupId === null ? [] : await executor.select({
    id: storefrontBuyerGroups.id, title: storefrontBuyerGroups.title, creditLimit: storefrontBuyerGroups.creditLimit,
  }).from(storefrontBuyerGroups).where(eq(storefrontBuyerGroups.id, order.buyerGroupId));
  return {
    ...base,
    id: order.id,
    version: order.version,
    customerId: order.customerId,
    documentId: order.documentId,
    documentRef: doc?.refNumber ?? '',
    documentStatus: doc ? (doc.isDeleted === 1 ? 'voided' : String(doc.status ?? '')) : '',
    receipts: receipts.map((r): AdminReceipt => ({
      ...buyerReceipt(r), id: r.id, hasImage: withImage.has(r.id), reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, treasuryTransactionId: r.treasuryTransactionId,
    })),
    updatedBy: order.updatedBy,
    buyer: buyer ?? null,
    group: group ? { id: group.id, title: group.title, creditLimit: rialText(group.creditLimit) } : null,
    actions: {
      confirm: pending && open, reject: pending && open, cancel: open, approveOnAccount: base.status === 'awaiting_approval',
      fulfil: NEXT_FULFILMENT[base.status] ?? null,
    },
  };
}
