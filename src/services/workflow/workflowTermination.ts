import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowHistoryLogs, workflowInstances, workflowPendingApprovals, workflowTasks } from '../../db/schema.js';
import { closeWorkflowTaskNotices } from './workflowTaskNotice.js';

export interface TerminateWorkflowParams {
  entityType: string;
  entityId: string | number;
  /** کلید و عنوان ردیف تاریخچه */
  actionKey: string;
  actionTitle: string;
  comment: string;
  userId?: number | null;
  userName?: string | null;
}

/**
 * فرایندهای در جریان یک موجودیت را در تراکنش فراخواننده می‌بندد: نمونه `TERMINATED`، کارهای در انتظار `canceled`، ردیف‌های
 * انتظار تأیید پاک و یک ردیف تاریخچه در گام جاری. فراخواننده پیش‌تر ردیف خود موجودیت را قفل کرده است (همان ترتیب
 * «موجودیت ← نمونه» اجرای انتقال). خروجی: شناسه نمونه‌های بسته‌شده.
 *
 * v9.0.40 (TD-447، ت۵): ابطال یا حذف موجودیت. (v9.0.39، TD-446: قطعی کردن مستقیم سند هم آن را می‌بست، تا v11 phase 6.1p که
 * قطعی کردن سندِ در گردش کار را رد می‌کند.)
 */
export async function terminateOpenWorkflows(tx: DbExecutor, params: TerminateWorkflowParams): Promise<number[]> {
  const open = await tx.select({ id: workflowInstances.id, currentStateId: workflowInstances.currentStateId, version: workflowInstances.version })
    .from(workflowInstances)
    .where(and(
      eq(workflowInstances.entityType, params.entityType),
      eq(workflowInstances.entityId, String(params.entityId)),
      eq(workflowInstances.status, 'IN_PROGRESS'),
    ))
    .orderBy(asc(workflowInstances.id))
    .for('update');
  return closeWorkflowInstances(tx, open, params);
}

/**
 * Closes the given running instances (already locked `FOR UPDATE` by the caller): instance `TERMINATED`, pending tasks
 * `canceled`, pending approvals removed and one history row each at its current step. Returns their ids.
 */
export async function closeWorkflowInstances(
  tx: DbExecutor,
  open: ReadonlyArray<{ id: number; currentStateId: number | null; version: number | null }>,
  params: Omit<TerminateWorkflowParams, 'entityType' | 'entityId'>,
): Promise<number[]> {
  if (open.length === 0) return [];
  const ids = open.map(i => i.id);
  const now = new Date().toISOString();
  await tx.delete(workflowPendingApprovals).where(inArray(workflowPendingApprovals.instanceId, ids));
  await tx.update(workflowTasks)
    .set({ status: 'canceled', completedAt: now })
    .where(and(inArray(workflowTasks.instanceId, ids), eq(workflowTasks.status, 'pending')));
  // v11 phase 6.3p (U6): the ended workflow's notices close with its tasks
  await closeWorkflowTaskNotices(tx, ids);
  for (const inst of open) {
    await tx.update(workflowInstances)
      .set({ status: 'TERMINATED', version: (inst.version ?? 1) + 1, updatedAt: now })
      .where(eq(workflowInstances.id, inst.id));
    await tx.insert(workflowHistoryLogs).values({
      instanceId: inst.id,
      fromStateId: inst.currentStateId,
      toStateId: inst.currentStateId,
      performedBy: params.userId ?? null,
      performedByName: params.userName || 'سیستم',
      actionKey: params.actionKey,
      actionTitle: params.actionTitle,
      comment: params.comment,
      createdAt: now,
    });
  }
  return ids;
}
