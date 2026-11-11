import type { DbTransaction } from '../../db/drizzle.js';
import { logger } from '../../middleware/logger.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';

/**
 * v11 phase 8.2a, part 2 (start plan §5): the colleagues who handle site orders (holders of `site_orders.manage`) learn
 * of a new order and of a new card-to-card receipt in their bell, and in Bale or Telegram unless they turned the category
 * off. The bell names the order number only; the messenger copy is the category's fixed sentence (no name, no amount).
 * A notice is not worth the order: it is written in a savepoint of the order's transaction, and a failure is logged and
 * the order goes on.
 */
export const SITE_ORDER_NOTIFY_PERMISSION = 'site_orders.manage';

export type SiteOrderNotice = 'placed' | 'receipt' | 'approval_due';

const TEXTS: Readonly<Record<SiteOrderNotice, { title: (n: string) => string; message: string }>> = {
  placed: { title: n => `سفارش تازه از سایت: ${n}`, message: 'کالاها برای این سفارش نگه داشته شده‌اند تا خریدار پرداخت کند.' },
  receipt: { title: n => `رسید کارت‌به‌کارت سفارش ${n}`, message: 'خریدار رسید پرداخت فرستاد؛ آن را بررسی و تأیید یا رد کنید.' },
  // v12 phase 8b (site review 2.7): an «به حساب» order whose wait for a colleague's confirmation runs out soon
  approval_due: { title: n => `مهلت تأیید سفارش به حساب ${n} نزدیک است`, message: 'اگر تا پایان مهلت تأیید نشود، سفارش خودکار لغو و کالاهایش آزاد می‌شود.' },
};

export async function notifySiteOrder(
  tx: DbTransaction, kind: SiteOrderNotice, order: { id: number; orderNumber: string }, options: { rethrow?: boolean } = {},
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const recipients = await permissionHolderUserIdsWith(sp, SITE_ORDER_NOTIFY_PERMISSION);
      const text = TEXTS[kind];
      await createNotifications(sp, recipients.map(userId => ({
        userId,
        category: 'site_order' as const,
        type: 'system',
        senderName: STOREFRONT_BOT_USER,
        title: text.title(order.orderNumber),
        message: text.message,
        link: `/site-orders?id=${order.id}`,
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error notifying colleagues of a site order', orderId: order.id, kind, error: err });
    // v12 phase 8b review: where the bell is the whole action (the approval reminder), a failed bell fails the action,
    // so it is not marked done and the next minute rings again
    if (options.rethrow) throw err;
  }
}
