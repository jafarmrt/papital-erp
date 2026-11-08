import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, storefrontOrders } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { EXPIRING_ORDER_STATUSES, type OrderStatus } from '../../lib/storefront/storefrontOrderRules.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { cancelOpenOrder } from './storefrontOrderAdmin.service.js';

/**
 * v11 phase 8.2a (start plan §5): the end of a reservation. Once a minute each order still
 * waiting for payment past its deadline, with no receipt waiting for review (8.2b part 2: or an on-account order no
 * colleague confirmed in time), is cancelled and its proforma voided, which
 * releases the stock. Each order is its own transaction with its own audit rows, so one that cannot be voided (a colleague
 * finalized its proforma in the ERP) is logged and skipped and never stops the others. Nothing runs at boot (§9.2).
 * v12 phase 7 (site review 1.5 and 3.2a): the sweep no longer waits for the order switch (an order switched off for a holiday
 * kept its stock reserved until the switch came back, then every overdue order was cancelled at once), and an order whose
 * proforma was finalized or turned into a draft in the ERP is not picked (it needs a colleague; before, 50 such orders
 * filled every batch and no other order expired).
 */
export const STOREFRONT_EXPIRY_BATCH = 50;
export const STOREFRONT_EXPIRY_INTERVAL_MS = 60_000;

export async function expireDueOrdersOnce(): Promise<{ expired: number; failed: number }> {
  const due = await orm.select({ id: storefrontOrders.id }).from(storefrontOrders)
    .innerJoin(documents, eq(documents.id, storefrontOrders.documentId))
    .where(and(
      inArray(storefrontOrders.status, [...EXPIRING_ORDER_STATUSES]), lte(storefrontOrders.reserveUntil, sql`now()`),
      // a voided proforma is still picked (the order is just cancelled); a live one that is no longer a proforma is not
      or(eq(documents.isDeleted, 1), eq(documents.status, 'proforma')),
    ))
    .orderBy(asc(storefrontOrders.reserveUntil), asc(storefrontOrders.id)).limit(STOREFRONT_EXPIRY_BATCH);
  let expired = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const done = await orm.transaction(async (tx) => {
        const [order] = await tx.select().from(storefrontOrders).where(eq(storefrontOrders.id, id)).for('update');
        // decided again under the lock: a receipt may have arrived since the list was read
        const [{ stillDue }] = (await tx.execute(sql`SELECT (${order?.reserveUntil ?? null}::timestamptz <= now()) AS "stillDue"`)).rows as Array<{ stillDue: boolean | null }>;
        if (!order || !EXPIRING_ORDER_STATUSES.includes(order.status as OrderStatus) || !stillDue) return false;
        await cancelOpenOrder(tx, order, 'expired', { username: STOREFRONT_BOT_USER });
        await logActivity({
          tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'سفارش سایت', entityId: order.id,
          description: order.status === 'awaiting_approval'
            ? `مهلت تأیید سفارش به حساب ${order.orderNumber} گذشت و رزرو آن آزاد شد`
            : `مهلت پرداخت سفارش سایت ${order.orderNumber} گذشت و رزرو آن آزاد شد`,
          details: { before: { status: order.status, reserveUntil: order.reserveUntil }, after: { status: 'cancelled', cancelReason: 'expired' } },
        });
        return true;
      });
      if (done) expired++;
    } catch (err) {
      failed++;
      logger.warn({ message: `[Storefront] order ${id} could not be expired`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { expired, failed };
}

/** The minute timer `server.ts` starts and stops; a minute whose sweep is still running is skipped */
export class StorefrontOrderWorker {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  static start(intervalMs: number = STOREFRONT_EXPIRY_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void expireDueOrdersOnce()
        .then(({ expired, failed }) => {
          if (expired || failed) logger.info(`[Storefront] reservation sweep: ${expired} expired, ${failed} failed`);
        })
        .catch(err => logger.warn({ message: '[Storefront] reservation sweep failed', error: err instanceof Error ? err.message : String(err) }))
        .finally(() => { this.running = false; });
    }, intervalMs);
    this.timer.unref?.();
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
