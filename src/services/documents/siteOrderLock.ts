import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontOrders } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';

export const DOCUMENT_SITE_ORDER_OPEN = 'DOCUMENT_SITE_ORDER_OPEN';

/**
 * The open statuses of a site order (OPEN_ORDER_STATUSES of src/lib/storefront/storefrontOrderRules.ts, which this package
 * may not import, scripts/ratchets/PACKAGE_MAP.txt); siteOrderLock.test.ts keeps the two lists equal.
 */
export const SITE_ORDER_OPEN_STATUSES = ['awaiting_payment', 'payment_submitted', 'awaiting_approval'] as const;

/**
 * v12 phase 7 (site review 1.6 and 3.2a): the proforma of an open site order (waiting for payment, a receipt under review
 * or an on-account approval) belongs to that order. Its edit, finalize and void in the ERP's own paths are refused:
 * finalizing it left the order «waiting for payment» on the site (the buyer could pay twice) and the expiry sweep failed on it
 * every minute; editing its lines or amounts put the invoice out of step with the amount the payment confirmation posts.
 * The site's own confirm, on-account approval and cancel move the order out of the open statuses first, in the same
 * transaction, so they pass. A read of the storefront's table by its unique `document_id` (package 1 schema, read only,
 * AGENTS.md §2.14); called with the document row locked.
 */
export async function assertNoOpenSiteOrder(tx: DbExecutor, documentId: number): Promise<void> {
  const [open] = await tx.select({ orderNumber: storefrontOrders.orderNumber }).from(storefrontOrders)
    .where(and(eq(storefrontOrders.documentId, documentId), inArray(storefrontOrders.status, [...SITE_ORDER_OPEN_STATUSES]))).limit(1);
  if (open) {
    throw new ConflictError(
      `این پیش‌فاکتور مال سفارش سایت ${open.orderNumber} است؛ تأیید پرداخت، تأیید سفارش به حساب یا لغو آن را از صفحهٔ «سفارش‌های سایت» انجام دهید.`,
      { orderNumber: open.orderNumber }, DOCUMENT_SITE_ORDER_OPEN,
    );
  }
}
