import { eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { workflowDefinitions, workflowInstances } from '../../db/schema.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { APPROVAL_INBOX_LINK, workflowTaskArrivedNotice } from '../../lib/notifications/notificationNotices.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowDelegationService } from './workflowDelegationService.js';
import { snapshotTransitionsOf } from './workflowSnapshot.js';
import { workflowTaskRecipients, type WorkflowTaskRow } from './workflowTaskRecipients.js';

/**
 * v10.1.42 (messenger notifications plan part 3, §2.4): when a step's tasks are created, everyone who will see one of
 * them in their approval inbox gets one notice for that step (bell and linked messenger, in the step's own transaction):
 * the assigned and candidate users, else the members of the task's role holding its required permission, and their
 * active deputies. The user who moved the record into the step is left out, a step closed to the initiator does not
 * notify the initiator, and a step only the initiator runs notifies only the initiator and their deputies.
 */
export async function notifyWorkflowTasksArrived(
  tx: DbTransaction,
  instanceId: number,
  tasks: readonly WorkflowTaskRow[],
  options: { actorUserId?: number | null; now?: Date } = {},
): Promise<number> {
  if (tasks.length === 0) return 0;
  const [instance] = await tx.select({
    entityType: workflowInstances.entityType,
    entityId: workflowInstances.entityId,
    startedBy: workflowInstances.startedBy,
    snapshotDsl: workflowInstances.snapshotDsl,
    workflowCode: workflowDefinitions.code,
  }).from(workflowInstances)
    .innerJoin(workflowDefinitions, eq(workflowInstances.workflowDefinitionId, workflowDefinitions.id))
    .where(eq(workflowInstances.id, instanceId));
  if (!instance) return 0;
  const now = options.now ?? new Date();
  const transitions = snapshotTransitionsOf(instance.snapshotDsl) ?? [];
  const recipients = new Set<number>();
  for (const task of tasks) {
    let users = await workflowTaskRecipients(tx, task, instance.workflowCode ?? '', instance.snapshotDsl, now);
    const transition = transitions.find((t) => t.id === task.transitionId);
    const starter = instance.startedBy ?? null;
    if (transition && Number(transition.isInitiatorOnly) === 1) {
      if (!starter) continue;
      const deputies = await WorkflowDelegationService.activeDelegations(tx, { fromUserIds: [starter] }, now);
      const allowed = new Set([starter, ...deputies
        .filter((d) => WorkflowDelegationService.delegationCovers(d.scope, instance.workflowCode ?? ''))
        .map((d) => d.toUserId)]);
      users = [...allowed];
    } else if (transition && Number(transition.isInitiatorExcluded) === 1 && starter) {
      users = users.filter((id) => id !== starter);
    }
    for (const id of users) recipients.add(id);
  }
  if (options.actorUserId) recipients.delete(options.actorUserId);
  if (recipients.size === 0) return 0;

  const context = await getEntityContext(instance.entityType, instance.entityId, tx);
  const notice = workflowTaskArrivedNotice({
    taskTitle: String(tasks[0].title || ''),
    entityLabel: workflowEntityTypeLabel(instance.entityType),
    reference: String(context.refNumber || context.code || instance.entityId),
  });
  await createNotifications(tx, [...recipients].map((userId) => ({
    userId,
    category: 'workflow_task' as const,
    senderId: null,
    senderName: 'گردش کار',
    type: 'task',
    title: notice.title,
    message: notice.message,
    link: APPROVAL_INBOX_LINK,
  })));
  return recipients.size;
}
