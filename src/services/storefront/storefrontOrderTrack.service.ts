import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { storefrontOrders } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import { PHONE_PROOF_MAX, PHONE_PROOF_PREFIX } from '../../lib/storefront/storefrontSmsRules.js';
import { EMAIL_PROOF_MAX, EMAIL_PROOF_PREFIX, emailMatchKey, normalizeEmail } from '../../lib/storefront/storefrontEmailRules.js';
import { consumeEmailProof } from './storefrontEmailOtp.service.js';
import type { OrderAccessAnswer, OrderAccessRequest } from '../../lib/storefront/storefrontOrderContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { orderAccessKey } from './storefrontOrderKeys.js';
import { consumePhoneProof } from './storefrontSmsOtp.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 8d (start plan §5, site review 2.2): a guest's order opened on a phone that did not place it, without its
 * tracking key. The buyer types the order's number and the buyer's phone, proves the phone with the login code
 * (`/auth/otp/request` and `/auth/otp/verify`, which know nothing of orders, so a code goes to any phone alike), and the
 * proof answers the order's tracking key, which the site keeps in that browser as if it had placed the order.
 *
 * - Only the order's buyer opens it: the phone is the one the order was placed with (since 8c the buyer's, not the
 *   recipient's) and proven then (`phone_proven`), and the proof is a live, unused proof of that phone. A missing order, another phone and a wrong, used or
 *   expired proof are the same 404 with the same words, so the answer says nothing about which orders exist or whose.
 * - The proof is used up only when it opens the order, so a mistyped number does not cost the buyer a new code; a
 *   proof only ever opens its own phone's orders. The route limits the tries per visitor and per order.
 * - Opening an order writes an audit row (the order, never the phone).
 */
const notFound = () => new NotFoundError('سفارشی با این شماره برای این شمارهٔ همراه پیدا نشد.', undefined, 'STOREFRONT_ORDER_NOT_FOUND');

export async function orderAccessByPhone(orderNumber: string, input: OrderAccessRequest): Promise<OrderAccessAnswer> {
  const settings = await storefrontSettingValues(orm);
  if (!settings.enabled) throw new NotFoundError('پیدا نشد');
  if (!/^\d{6,12}$/.test(orderNumber)) throw notFound();
  // v12 phase 8e: an order placed with a proven email opens with that email and a new email code, as one placed with a
  // proven phone opens with the phone
  const byEmail = 'email' in input;
  const phone = byEmail ? '' : normalizeMobile(String(input.phone ?? '')) ?? '';
  const email = byEmail ? normalizeEmail(input.email) : '';
  const proof = String((byEmail ? input.emailProof : input.phoneProof) ?? '');
  const proofShape = byEmail
    ? proof.length <= EMAIL_PROOF_MAX && proof.startsWith(EMAIL_PROOF_PREFIX)
    : proof.length <= PHONE_PROOF_MAX && proof.startsWith(PHONE_PROOF_PREFIX);
  if (!(byEmail ? email : phone) || !proof || !proofShape) throw notFound();
  const opened = await orm.transaction(async (tx) => {
    const [order] = await tx.select({
      id: storefrontOrders.id, orderNumber: storefrontOrders.orderNumber, accessSalt: storefrontOrders.accessSalt, phoneKey: storefrontOrders.phoneKey,
      phoneProven: storefrontOrders.phoneProven, emailKey: storefrontOrders.emailKey,
    }).from(storefrontOrders).where(eq(storefrontOrders.orderNumber, orderNumber));
    if (!order) return null;
    if (byEmail) {
      // only the email an email code proved when the order was placed (an order without one has '' and opens by email never)
      if (!order.emailKey || order.emailKey !== emailMatchKey(email)) return null;
      if (!(await consumeEmailProof(tx, email, proof))) return null;
    } else {
      // only an order whose phone was proven when placed (8d review): before 8c an order's phone was its recipient's, and
      // with the texts off or an unproven account phone nobody showed the phone was the buyer's
      if (order.phoneProven !== 1 || order.phoneKey !== phoneMatchKey(phone)) return null;
      if (!(await consumePhoneProof(tx, phone, proof))) return null;
    }
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'VIEW', entity: 'سفارش سایت', entityId: order.id,
      description: `سفارش سایت ${order.orderNumber} با کد ${byEmail ? 'ایمیلی' : 'پیامکی'} خریدار روی دستگاه دیگری باز شد`,
      details: { before: { proofUsed: false }, after: { proofUsed: true, by: byEmail ? 'email' : 'sms', trackingKeyGiven: true } },
    });
    return order;
  });
  if (!opened) throw notFound();
  return { accessKey: orderAccessKey(opened.orderNumber, opened.accessSalt) };
}
