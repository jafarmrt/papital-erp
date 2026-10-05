import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { orm, DbExecutor } from '../../db/drizzle.js';
import {
  notifications,
  users,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
} from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { logger } from '../../middleware/logger.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowDelegationService } from './workflowDelegationService.js';

/**
 * v7.0.101 (TD-085 بند ۴، تصمیم مالک محصول «یک بار به مسئول کار»): وقتی مهلت کار تاییدی (due_at از slaHours مرحله)
 * می‌گذرد، مسئول همان کار یک اعلان درون‌برنامه‌ای می‌گیرد؛ بدون تکرار، بدون رونوشت به مدیر و بدون پیامک یا ایمیل.
 * مسئول کار همان کسی است که کار را در کارتابل می‌بیند: کاربر تعیین‌شده و کاربران نامزد (به‌علاوه جانشین فعال آن‌ها
 * در تفویض)، وگرنه کاربران نقش تعیین‌شده (نقش «همه» یعنی همه کاربران). هر فرایند برای هر کاربر یک اعلان می‌گیرد،
 * حتی اگر مرحله چند کار هم‌زمان داشته باشد. sla_reminded_at در همان تراکنش اعلان پر می‌شود.
 */

export const WORKFLOW_SLA_REMINDER_LINK = '/approval-inbox';
const ALL_ROLES = new Set(['all', '*']);

type TaskRow = typeof workflowTasks.$inferSelect;

export interface SlaReminderRunResult {
  tasks: number;
  notifications: number;
}

const positiveIds = (values: unknown): number[] =>
  (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > 0);

async function resolveRecipients(tx: DbExecutor, task: TaskRow, workflowCode: string, now: Date): Promise<number[]> {
  const assigned = [...new Set([...positiveIds([task.assignedUserId]), ...positiveIds(task.candidateUsers)])];
  let owners: number[];
  if (assigned.length > 0) {
    const active = await tx.select({ id: users.id }).from(users)
      .where(and(inArray(users.id, assigned), eq(users.isDeleted, 0)));
    owners = active.map((u) => u.id);
  } else {
    const candidateRoles = (Array.isArray(task.candidateRoles) ? task.candidateRoles : [])
      .map((r) => String(r).trim().toLowerCase()).filter(Boolean);
    const roles = candidateRoles.length > 0 ? candidateRoles : [String(task.assignedRole || '').trim().toLowerCase()].filter(Boolean);
    if (roles.length === 0) return [];
    const byRole = roles.some((r) => ALL_ROLES.has(r))
      ? await tx.select({ id: users.id }).from(users).where(eq(users.isDeleted, 0))
      : await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.isDeleted, 0), inArray(sql`lower(${users.role})`, roles)));
    owners = byRole.map((u) => u.id);
  }
  // v8.0.88 (TD-377): جانشین فعالِ هم‌حوزه مسئولان کار (کاربر تعیین‌شده، نامزد یا عضو نقش) هم یادآوری می‌گیرد
  const delegates = await WorkflowDelegationService.activeDelegations(tx, { fromUserIds: owners }, now);
  const deputies = delegates.filter((d) => WorkflowDelegationService.delegationCovers(d.scope, workflowCode)).map((d) => d.toUserId);
  return [...new Set([...owners, ...deputies])];
}

export class WorkflowSlaReminderService {
  private static intervalId: ReturnType<typeof setInterval> | null = null;

  /** یادآوری کارهای در انتظاری که مهلتشان گذشته و هنوز یادآوری نگرفته‌اند. */
  static async sendDueReminders(now: Date = new Date()): Promise<SlaReminderRunResult> {
    const nowIso = now.toISOString();
    return await orm.transaction(async (tx) => {
      const due = await tx.select().from(workflowTasks)
        .where(and(
          eq(workflowTasks.status, 'pending'),
          isNull(workflowTasks.slaRemindedAt),
          sql`${workflowTasks.dueAt} IS NOT NULL`,
          sql`${workflowTasks.dueAt} <= ${nowIso}`,
        ))
        .orderBy(workflowTasks.id)
        .for('update', { skipLocked: true });
      if (due.length === 0) return { tasks: 0, notifications: 0 };

      const instanceIds = [...new Set(due.map((t) => t.instanceId))];
      const instances = await tx.select({
        id: workflowInstances.id,
        entityType: workflowInstances.entityType,
        entityId: workflowInstances.entityId,
        workflowCode: workflowDefinitions.code,
        workflowTitle: workflowDefinitions.title,
      })
        .from(workflowInstances)
        .innerJoin(workflowDefinitions, eq(workflowInstances.workflowDefinitionId, workflowDefinitions.id))
        .where(inArray(workflowInstances.id, instanceIds));
      const instanceById = new Map(instances.map((i) => [i.id, i]));

      let sent = 0;
      for (const instanceId of instanceIds) {
        const tasks = due.filter((t) => t.instanceId === instanceId);
        const instance = instanceById.get(instanceId);
        const recipients = new Set<number>();
        for (const task of tasks) {
          for (const id of await resolveRecipients(tx, task, instance?.workflowCode ?? '', now)) recipients.add(id);
        }
        if (instance && recipients.size > 0) {
          const context = await getEntityContext(instance.entityType, instance.entityId, tx);
          const ref = String(context.refNumber || context.code || instance.entityId);
          const step = tasks[0].title;
          const message = `مهلت «${step}» در فرایند «${instance.workflowTitle}» برای ${ref} به پایان رسید؛ لطفاً از کارتابل تایید اقدام کنید.`;
          await tx.insert(notifications).values([...recipients].map((userId) => ({
            userId,
            senderId: null,
            senderName: 'موتور ورکفلو',
            type: 'system',
            title: 'مهلت کار تاییدی گذشت',
            message,
            link: WORKFLOW_SLA_REMINDER_LINK,
            isRead: 0,
          })));
          sent += recipients.size;
        } else {
          logger.warn(`[Workflow SLA] No recipient for overdue tasks of instance #${instanceId}; marked as reminded`);
        }
      }

      await tx.update(workflowTasks)
        .set({ slaRemindedAt: nowIso })
        .where(inArray(workflowTasks.id, due.map((t) => t.id)));
      return { tasks: due.length, notifications: sent };
    });
  }

  /** اجرای انحصاری (قفل مشورتی 91006)؛ اجرای هم‌زمان دیگر بی‌اثر برمی‌گردد. */
  static async runExclusive(now: Date = new Date()): Promise<SlaReminderRunResult | null> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.WORKFLOW_SLA_REMINDER, () => this.sendDueReminders(now));
    return outcome.acquired ? outcome.result : null;
  }

  static start(intervalMs: number = 60_000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.runExclusive()
        .then((res) => {
          if (res && res.tasks > 0) logger.info(`[Workflow SLA] Reminded ${res.tasks} overdue task(s) with ${res.notifications} notification(s)`);
        })
        .catch((err: unknown) => logger.error(`[Workflow SLA] Reminder run failed: ${err instanceof Error ? err.message : String(err)}`));
    }, intervalMs);
    logger.info(`[Workflow SLA] Reminder worker started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
