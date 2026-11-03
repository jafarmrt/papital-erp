import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontOrders } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';

/**
 * v11 phase 8.4b (start plan docs/roadmap/V11_STOREFRONT_8_4B_SMS_LOGIN_START_PLAN.md, work item 5): the orders a buyer
 * placed as a guest join their account once the account's phone is proven in the same transaction (a sign-up with a phone
 * proof, or an SMS sign-in). Only orders of that phone with no account are touched, and only their account: a guest order
 * stays a retail card order (no buyer group, payment method unchanged), as the order checks of 8.2b part 2 require. An
 * order already on an account (a claim with its tracking key, or an order placed signed in) is never moved. One audit row
 * per order, like a claim with the tracking key.
 */
export async function attachGuestOrders(tx: DbExecutor, account: { id: number; phone: string }, phoneKey: string, now: string): Promise<number> {
  const attached = await tx.update(storefrontOrders).set({
    buyerAccountId: account.id, updatedAt: now, updatedBy: STOREFRONT_BOT_USER, version: sql`${storefrontOrders.version} + 1`,
  }).where(and(eq(storefrontOrders.phoneKey, phoneKey), isNull(storefrontOrders.buyerAccountId)))
    .returning({ id: storefrontOrders.id, orderNumber: storefrontOrders.orderNumber });
  for (const order of attached) {
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} پس از تأیید شمارهٔ ${account.phone} با پیامک به حساب خریدار وصل شد`,
      details: { before: { buyerAccountId: null }, after: { buyerAccountId: account.id } },
    });
  }
  return attached.length;
}
