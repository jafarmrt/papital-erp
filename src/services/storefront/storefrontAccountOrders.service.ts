import { and, desc, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documentItems, storefrontOrders } from '../../db/schema.js';
import { ConflictError, NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { ORDER_STATUS_TITLES, isOrderStatus, tomanText } from '../../lib/storefront/storefrontOrderRules.js';
import type { AccountOrderPage, BuyerOrder, ClaimOrderRequest, ReceiptRequest } from '../../lib/storefront/storefrontOrderContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { requireAccount } from './storefrontBuyerAuth.service.js';
import { orderForKey } from './storefrontOrderPlace.service.js';
import { receiptFor } from './storefrontOrderBuyer.service.js';
import { buyerOrderView, paymentMethodOf } from './storefrontOrderView.js';
import { rialText } from './storefrontShipping.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.2b part 2 (start plan §6): a signed-in buyer's own orders. The history holds only the orders linked to the
 * account: placed while signed in, or claimed with the order's own tracking key. Until SMS proves a phone (8.4b), an
 * order of the same phone placed as a guest is never shown just because the phone matches. Another account's order, or
 * an order number the account does not hold, is the same 404.
 */
export const ACCOUNT_ORDER_PAGE_MAX = 50;

const notFound = () => new NotFoundError('سفارش پیدا نشد.', undefined, 'STOREFRONT_ORDER_NOT_FOUND');

/** `GET /account/orders` */
export async function myOrders(rawToken: unknown, query: { page: number; limit: number }): Promise<AccountOrderPage> {
  const account = await requireAccount(rawToken);
  const page = Math.max(1, query.page);
  const limit = Math.min(ACCOUNT_ORDER_PAGE_MAX, Math.max(1, query.limit));
  const mine = eq(storefrontOrders.buyerAccountId, account.id);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontOrders).where(mine);
  const rows = await orm.select({
    number: storefrontOrders.orderNumber, createdAt: storefrontOrders.createdAt, status: storefrontOrders.status,
    payableAmount: storefrontOrders.payableAmount, paymentMethod: storefrontOrders.paymentMethod,
    itemCount: sql<number>`(SELECT count(*)::int FROM ${documentItems} di WHERE di.document_id = ${storefrontOrders.documentId} AND di.is_deleted = 0)`,
  }).from(storefrontOrders).where(mine)
    .orderBy(desc(storefrontOrders.createdAt), desc(storefrontOrders.id))
    .limit(limit).offset((page - 1) * limit);
  return {
    data: rows.map((r) => {
      const status = isOrderStatus(r.status) ? r.status : 'awaiting_payment';
      const payable = rialText(r.payableAmount);
      return {
        number: r.number, createdAt: r.createdAt, status, statusTitle: ORDER_STATUS_TITLES[status],
        payableAmount: payable, payableToman: tomanText(payable), paymentMethod: paymentMethodOf(r), itemCount: Number(r.itemCount),
      };
    }),
    total, page, limit,
  };
}

/** `GET /account/orders/:number`: one of the account's orders, as its tracking page shows it */
export async function myOrder(rawToken: unknown, orderNumber: string): Promise<BuyerOrder> {
  const account = await requireAccount(rawToken);
  if (!/^\d{6,12}$/.test(orderNumber)) throw notFound();
  const [order] = await orm.select().from(storefrontOrders)
    .where(and(eq(storefrontOrders.orderNumber, orderNumber), eq(storefrontOrders.buyerAccountId, account.id)));
  if (!order) throw notFound();
  return buyerOrderView(orm, order, await storefrontSettingValues(orm));
}

/**
 * `POST /account/orders/:number/receipts`: v11 phase 8.2, a card-to-card receipt for one of the account's own orders,
 * from any phone the buyer is signed in on (a guest's order still needs its tracking key). The same checks and answer as
 * the keyed route; another account's order, or a number the account does not hold, is the same 404.
 */
export async function sendAccountReceipt(rawToken: unknown, orderNumber: string, input: ReceiptRequest): Promise<BuyerOrder> {
  const account = await requireAccount(rawToken);
  if (!/^\d{6,12}$/.test(orderNumber)) throw notFound();
  return receiptFor(async (tx) => {
    const [order] = await tx.select().from(storefrontOrders)
      .where(and(eq(storefrontOrders.orderNumber, orderNumber), eq(storefrontOrders.buyerAccountId, account.id))).for('update');
    if (!order) throw notFound();
    return order;
  }, input);
}

/**
 * `POST /account/orders/claim`: a guest order joins the signed-in account. The tracking key proves the buyer placed it
 * (start plan §6: «پس از خرید مهمان … آن سفارش به حساب تازه وصل می‌شود»). An order that already belongs to an account
 * stays where it is (409 when it is another account's, the same answer when it is this one's). Only the account link
 * changes: the order keeps its retail prices and customer.
 */
export async function claimOrder(rawToken: unknown, input: ClaimOrderRequest): Promise<BuyerOrder> {
  const account = await requireAccount(rawToken);
  const settings = await storefrontSettingValues(orm);
  return orm.transaction(async (tx) => {
    const order = await orderForKey(tx, String(input.number ?? '').trim(), String(input.accessKey ?? '').trim(), { lock: true });
    if (order.buyerAccountId === account.id) return buyerOrderView(tx, order, settings);
    if (order.buyerAccountId !== null) {
      throw new ConflictError('این سفارش به حساب دیگری وصل است.', undefined, 'STOREFRONT_ORDER_CLAIMED');
    }
    const [claimed] = await tx.update(storefrontOrders).set({
      buyerAccountId: account.id, updatedAt: systemNowUtcIso(), updatedBy: STOREFRONT_BOT_USER, version: sql`${storefrontOrders.version} + 1`,
    }).where(eq(storefrontOrders.id, order.id)).returning();
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} با کلید پیگیری به حساب خریدار وصل شد`,
      details: { before: { buyerAccountId: null }, after: { buyerAccountId: account.id } },
    });
    return buyerOrderView(tx, claimed, settings);
  });
}
