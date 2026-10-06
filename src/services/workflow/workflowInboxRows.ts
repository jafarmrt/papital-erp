import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowHistoryLogs, workflowInstances, workflowStates } from '../../db/schema.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowTransitionExecutor, type WorkflowSnapshotDsl } from './workflowTransitionExecutor.js';
import { isUsableSnapshot } from './workflowSnapshot.js';

/** اقدام یا امضای خود کاربر روی یک گام (ردیف تاریخچه با انتقال؛ شروع و بستن فرایند انتقال ندارند) */
export const completedByUserCondition = (userId: number) =>
  and(eq(workflowHistoryLogs.performedBy, userId), isNotNull(workflowHistoryLogs.transitionId));

/** عنوان گام جاری فرایند از تصویر نسخه خودش؛ تصویر قدیمی بی شناسه: جدول جاری */
async function currentStepTitleOf(instance: typeof workflowInstances.$inferSelect): Promise<string> {
  const snapshot = instance.snapshotDsl as WorkflowSnapshotDsl | null;
  if (isUsableSnapshot(snapshot)) return snapshot.states?.find(st => st.id === instance.currentStateId)?.title ?? '';
  const [state] = await orm.select({ title: workflowStates.title }).from(workflowStates).where(eq(workflowStates.id, instance.currentStateId));
  return state?.title ?? '';
}

/**
 * فیلدهای فرایند و موجودیت هر ردیف کارتابل. TD-465 (یافته B14-23): کارت کار عنوان گام جاری و نام آغازکننده را از همین
 * ردیف می‌خواند؛ پیش‌تر نه گام فرستاده می‌شد و نه نام، و کارت «گام جاری» را همان عنوان کار و «متقاضی» را همیشه
 * «ثبت‌کننده سیستم» نشان می‌داد. مبلغ سند ریالی است (workflowDocumentAmount).
 */
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
      startedBy: instance.startedBy,
      startedByName: instance.startedByName || '',
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt
    },
    refNumber: context.refNumber || context.code || instance.entityId,
    buyerName: context.buyerName || '',
    amount: Number(context.amount || context.totalAmount || 0),
    currentStepTitle: await currentStepTitleOf(instance),
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
