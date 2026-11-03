import type { DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { formatPersianPhone } from '../../utils/cardValidation.js';
import { findActiveCustomerByName, findActiveCustomerByPhone, isCustomerNameUniqueViolation } from '../customers/customerIdentity.js';

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
}

export const STOREFRONT_BOT_USER = 'فروشگاه سایت';

/** `source` names what made the customer in its audit row, e.g. «سفارش سایت 100001» */
export async function resolveSiteCustomer(tx: DbExecutor, source: string, buyer: SiteBuyer): Promise<{ id: number; name: string }> {
  for (let attempt = 0; ; attempt++) {
    const found = await findActiveCustomerByPhone(buyer.phone, tx);
    if (found) return { id: found.id, name: found.name };
    const namesake = await findActiveCustomerByName(buyer.name, tx);
    const name = namesake ? `${buyer.name} (${formatPersianPhone(buyer.phone) || buyer.phone})` : buyer.name;
    if (namesake && await findActiveCustomerByName(name, tx)) {
      throw new ValidationError('ثبت با این نام و شماره ممکن نشد؛ لطفاً با فروشگاه تماس بگیرید.', undefined, 'STOREFRONT_CUSTOMER_NAME_TAKEN');
    }
    try {
      let createdId = 0;
      await tx.transaction(async (sp) => {
        const [created] = await sp.insert(customers).values({
          name, phone: buyer.phone, city: buyer.city, address: buyer.address, notes: 'مشتری ثبت‌شده خودکار از سفارش سایت',
        }).returning({ id: customers.id });
        await logActivity({
          tx: sp, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'طرف حساب', entityId: created.id,
          description: `ثبت خودکار طرف حساب «${name}» از ${source}`,
          details: { after: { id: created.id, name, city: buyer.city }, namesake: namesake ? namesake.name : undefined },
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
