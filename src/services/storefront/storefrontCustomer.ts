import type { DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { formatPersianPhone } from '../../utils/cardValidation.js';
import { findActiveCustomerByEmailKey, findActiveCustomerByName, findActiveCustomerByPhone, isCustomerNameUniqueViolation } from '../customers/customerIdentity.js';
import { emailMatchKey, maskedEmail } from '../../lib/storefront/storefrontEmailRules.js';

/**
 * v11 phase 8.2a (start plan §3): the customer (طرف حساب) of a site order, by the WooCommerce rule (`docs/rules/woocommerce.md`,
 * «Customer Match by Phone Key» and «Namesake WooCommerce Buyers»): the phone key finds an existing customer, else a new one is
 * made with the buyer's name, or «name (phone)» when another customer already has that name. The proforma takes the stored
 * customer's name, so its voucher row lands on that customer's account.
 */
export interface SiteBuyer {
  name: string;
  phone: string;
  city: string;
  address: string;
  /**
   * v12 phase 8e (owner's decision of 21 Aban 1405): the email an email code proved, for an order whose phone nobody
   * proved. The customer is then found by this email, never by the phone, and a new one keeps the email and no phone,
   * so a stranger who types someone's number cannot put an order on that person's customer. A colleague may merge it
   * with another customer later.
   */
  email?: string;
}

export const STOREFRONT_BOT_USER = 'فروشگاه سایت';

/** `source` names what made the customer in its audit row, e.g. «سفارش سایت 100001» */
export async function resolveSiteCustomer(tx: DbExecutor, source: string, buyer: SiteBuyer): Promise<{ id: number; name: string }> {
  const byEmail = Boolean(buyer.email);
  for (let attempt = 0; ; attempt++) {
    const found = byEmail ? await findActiveCustomerByEmailKey(emailMatchKey(buyer.email ?? ''), tx) : await findActiveCustomerByPhone(buyer.phone, tx);
    if (found) return { id: found.id, name: found.name };
    const namesake = await findActiveCustomerByName(buyer.name, tx);
    const name = namesake ? `${buyer.name} (${byEmail ? buyer.email : formatPersianPhone(buyer.phone) || buyer.phone})` : buyer.name;
    // the audit row names the email masked (start plan §5); the customer's own name keeps it whole, to tell namesakes apart
    const auditName = namesake && byEmail ? `${buyer.name} (${maskedEmail(buyer.email ?? '')})` : name;
    if (namesake && await findActiveCustomerByName(name, tx)) {
      throw new ValidationError(`ثبت با این نام و ${byEmail ? 'ایمیل' : 'شماره'} ممکن نشد؛ لطفاً با فروشگاه تماس بگیرید.`, undefined, 'STOREFRONT_CUSTOMER_NAME_TAKEN');
    }
    try {
      let createdId = 0;
      await tx.transaction(async (sp) => {
        const [created] = await sp.insert(customers).values({
          name, phone: byEmail ? '' : buyer.phone, email: byEmail ? buyer.email : '', city: buyer.city, address: buyer.address,
          notes: byEmail ? 'مشتری ثبت‌شده خودکار از سفارش سایت با ایمیل تأییدشده (شمارهٔ همراه سفارش تأیید نشده بود)' : 'مشتری ثبت‌شده خودکار از سفارش سایت',
        }).returning({ id: customers.id });
        await logActivity({
          tx: sp, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'طرف حساب', entityId: created.id,
          description: `ثبت خودکار طرف حساب «${auditName}» از ${source}`,
          details: { after: { id: created.id, name: auditName, city: buyer.city, byProvenEmail: byEmail }, namesake: namesake ? namesake.name : undefined },
        });
        createdId = created.id;
      });
      return { id: createdId, name };
    } catch (err) {
      // another order made the same customer at the same moment: match once more, now against its committed row
      if (attempt === 0 && isCustomerNameUniqueViolation(err)) continue;
      throw err;
    }
  }
}
