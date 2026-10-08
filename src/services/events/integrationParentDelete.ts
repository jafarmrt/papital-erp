import { and, count, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { eventActionLogs, eventActionRules, integrationDeliveryJobs, webhookDeliveries, webhookSubscriptions } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.445 (TD-611، B01-31، تصمیم ت۶ الف): حذف اشتراک وب‌هوک و قانون خودکار. سرویس‌ها والد را فیزیکی حذف می‌کردند و قید پایگاه‌داده
 * نبود، پس ردیف‌های تحویل اشتراک و گزارش‌های اجرای قانون به شناسه حذف‌شده اشاره می‌ماندند. اکنون مهاجرت 0090 همان `onDelete`
 * اعلام‌شده در Drizzle را دارد (تحویل‌ها با اشتراک پاک می‌شوند، گزارش اجرا می‌ماند و شناسه قانونش تهی می‌شود) و حذف در یک
 * تراکنش است: ردیف والد قفل می‌شود (نبودنش ۴۰۴)، کارهای تحویل در صف آن بسته می‌شوند و یک ردیف ممیزی با «قبل» و شمار فرزندان
 * با همان `tx` نوشته می‌شود. کلید امضا و سرآیندها هرگز وارد ممیزی نمی‌شوند.
 */

export interface IntegrationDeleteActor {
  req?: unknown;
  userId?: number;
  username?: string;
}

function actorFields(actor: IntegrationDeleteActor) {
  const reqUser = (actor.req as { user?: { id?: number; username?: string; full_name?: string } } | undefined)?.user;
  return {
    req: actor.req,
    userId: actor.userId ?? reqUser?.id,
    username: actor.username || reqUser?.username || 'سیستم',
    userFullName: reqUser?.full_name || '',
  };
}

const CANCELLED_BY_DELETE = 'مقصد این تحویل حذف شد.';

/** حذف اشتراک وب‌هوک با تحویل‌هایش (قید CASCADE) و بستن کارهای در صف آن */
export async function deleteWebhookSubscription(id: number, actor: IntegrationDeleteActor = {}) {
  return orm.transaction(async (tx) => {
    const [sub] = await tx.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).for('update');
    if (!sub) throw new NotFoundError('اشتراک وب‌هوک یافت نشد.', undefined, 'WEBHOOK_SUBSCRIPTION_NOT_FOUND');

    const [deliveries] = await tx.select({ n: count() }).from(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, id));
    const cancelled = await tx.update(integrationDeliveryJobs)
      .set({ status: 'cancelled', lockedAt: null, lastError: CANCELLED_BY_DELETE, updatedAt: sql`now()` })
      .where(and(eq(integrationDeliveryJobs.kind, 'webhook'), eq(integrationDeliveryJobs.targetId, id), eq(integrationDeliveryJobs.status, 'pending')))
      .returning({ id: integrationDeliveryJobs.id });
    await tx.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));

    const deliveriesRemoved = Number(deliveries?.n ?? 0);
    await logActivity({
      tx,
      ...actorFields(actor),
      action: 'DELETE',
      entity: `اشتراک وب‌هوک: ${sub.name}`,
      entityId: id,
      description: `حذف اشتراک وب‌هوک «${sub.name}» به نشانی ${sub.targetUrl} با ${toPersianDigits(deliveriesRemoved, 0)} ردیف تحویل`,
      details: {
        before: {
          id: sub.id, name: sub.name, targetUrl: sub.targetUrl, eventPatterns: sub.eventPatterns, isActive: sub.isActive,
          totalDeliveries: sub.totalDeliveries, lastStatus: sub.lastStatus,
        },
        deliveriesRemoved,
        pendingDeliveriesCancelled: cancelled.length,
      },
    });
    return { deliveriesRemoved, pendingDeliveriesCancelled: cancelled.length };
  });
}

/** حذف قانون خودکار؛ گزارش‌های اجرایش می‌مانند و شناسه قانونشان تهی می‌شود (قید SET NULL)، نامش در گزارش هست */
export async function deleteEventActionRule(id: number, actor: IntegrationDeleteActor = {}) {
  return orm.transaction(async (tx) => {
    const [rule] = await tx.select().from(eventActionRules).where(eq(eventActionRules.id, id)).for('update');
    if (!rule) throw new NotFoundError('قانون خودکار یافت نشد.', undefined, 'EVENT_RULE_NOT_FOUND');

    const [logs] = await tx.select({ n: count() }).from(eventActionLogs).where(eq(eventActionLogs.ruleId, id));
    const cancelled = await tx.update(integrationDeliveryJobs)
      .set({ status: 'cancelled', lockedAt: null, lastError: CANCELLED_BY_DELETE, updatedAt: sql`now()` })
      .where(and(eq(integrationDeliveryJobs.kind, 'rule_action'), eq(integrationDeliveryJobs.targetId, id), eq(integrationDeliveryJobs.status, 'pending')))
      .returning({ id: integrationDeliveryJobs.id });
    await tx.delete(eventActionRules).where(eq(eventActionRules.id, id));

    const logsKept = Number(logs?.n ?? 0);
    await logActivity({
      tx,
      ...actorFields(actor),
      action: 'DELETE',
      entity: `قانون واکنش خودکار #${id}`,
      entityId: id,
      description: `حذف قانون «${rule.name}»؛ ${toPersianDigits(logsKept, 0)} گزارش اجرای آن با نام قانون می‌ماند`,
      details: {
        before: {
          id: rule.id, name: rule.name, eventType: rule.eventType, actionType: rule.actionType, isActive: rule.isActive,
          executionCount: rule.executionCount,
        },
        logsKept,
        pendingActionsCancelled: cancelled.length,
      },
    });
    return { logsKept, pendingActionsCancelled: cancelled.length };
  });
}
