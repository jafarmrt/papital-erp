import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowHistoryLogs, workflowInstances } from '../../db/schema.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor.js';

/** اقدام یا امضای خود کاربر روی یک گام (ردیف تاریخچه با انتقال؛ شروع و بستن فرایند انتقال ندارند) */
export const completedByUserCondition = (userId: number) =>
  and(eq(workflowHistoryLogs.performedBy, userId), isNotNull(workflowHistoryLogs.transitionId));

/** فیلدهای فرایند و موجودیت هر ردیف کارتابل */
export async function inboxEntityFields(instance: typeof workflowInstances.$inferSelect) {
  const context = await getEntityContext(instance.entityType, instance.entityId);
  return {
    entityType: instance.entityType,
    entityId: instance.entityId,
    instance: {
      id: instance.id,
      workflowDefinitionId: instance.workflowDefinitionId,
      entityType: instance.entityType,
      entityId: instance.entityId,
      currentStateId: instance.currentStateId,
      status: instance.status,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt
    },
    refNumber: context.refNumber || context.code || instance.entityId,
    buyerName: context.buyerName || '',
    amount: context.amount || context.totalAmount || 0,
  };
}

/**
 * v9.0.41 (TD-448، ت۶ الف): «تکمیل‌شده» = اقدام‌ها و امضاهایی که خود کاربر روی گام‌ها انجام داده، از تاریخچه، جدیدترین
 * اول و صفحه‌بندی‌شده در پایگاه‌داده؛ شروع و بستن خودکار فرایند (بی اقدام) شمرده نمی‌شوند
 */
export async function completedTasksOf(userId: number, page: number, limit: number) {
  const condition = completedByUserCondition(userId);
  const [count] = await orm.select({ n: sql<number>`count(*)::int` }).from(workflowHistoryLogs).where(condition);
  const rows = await orm.select({ log: workflowHistoryLogs, instance: workflowInstances })
    .from(workflowHistoryLogs)
    .innerJoin(workflowInstances, eq(workflowHistoryLogs.instanceId, workflowInstances.id))
    .where(condition)
    .orderBy(desc(workflowHistoryLogs.createdAt), desc(workflowHistoryLogs.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const data = await Promise.all(rows.map(async ({ log, instance }) => ({
    id: log.id,
    instanceId: instance.id,
    transitionId: log.transitionId,
    title: log.actionTitle || log.actionKey,
    description: log.comment || '',
    status: WorkflowTransitionExecutor.isNegativeTransition(log.actionKey, log.actionTitle ?? '') ? 'rejected' : 'approved',
    completedAt: log.createdAt,
    createdAt: log.createdAt,
    isOverdue: false,
    ...(await inboxEntityFields(instance)),
    delegationInfo: null,
  })));
  return { data, total: Number(count?.n ?? 0), page, limit };
}
