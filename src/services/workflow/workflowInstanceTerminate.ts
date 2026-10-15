import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { orm } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { WORKFLOW_TERMINATE_REASON_MIN, workflowTerminateRefusal } from '../../lib/workflow/workflowLifecycle.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';
import { closeWorkflowInstances } from './workflowTermination.js';

/** History key and title of a running record closed by the system admin */
export const ADMIN_TERMINATE_ACTION_KEY = 'terminate';
export const ADMIN_TERMINATE_ACTION_TITLE = 'بستن فرایند به دست مدیر';

/**
 * v10.1.15 (D-06 part C, TD-1265): the system admin closes a running record that cannot move on, with a required reason.
 * In one transaction under the instance row lock: the instance `TERMINATED`, pending tasks canceled, one `terminate`
 * history row with the reason, and the audit row written with the same `tx`. The record itself is not changed; only
 * record types whose work goes on without the workflow are closed (`workflowTerminateRefusal`). Only the instance row is
 * locked, so this never waits in the opposite order of a transition (record → instance).
 */
export async function terminateWorkflowInstance(params: {
  instanceId: number;
  reason: string;
  userId?: number | null;
  userName?: string | null;
  req?: Request;
}): Promise<{ instanceId: number; entityType: string; entityId: string }> {
  const reason = params.reason.trim();
  if (reason.length < WORKFLOW_TERMINATE_REASON_MIN) {
    throw new ValidationError('دلیل بستن فرایند را بنویسید.', undefined, 'WF_TERMINATE_REASON_REQUIRED');
  }
  return orm.transaction(async (tx) => {
    const [inst] = await tx.select({
      id: workflowInstances.id,
      entityType: workflowInstances.entityType,
      entityId: workflowInstances.entityId,
      status: workflowInstances.status,
      currentStateId: workflowInstances.currentStateId,
      version: workflowInstances.version,
    }).from(workflowInstances).where(eq(workflowInstances.id, params.instanceId)).for('update');
    if (!inst) throw new NotFoundError('فرایند گردش کار یافت نشد.', undefined, 'WF_INSTANCE_NOT_FOUND');
    if (inst.status !== 'IN_PROGRESS') {
      throw new ConflictError('این فرایند در جریان نیست و بستنی ندارد.', { status: inst.status }, 'WF_INSTANCE_NOT_RUNNING');
    }
    const refusal = workflowTerminateRefusal(inst.entityType);
    if (refusal) throw new ConflictError(refusal, { entityType: inst.entityType }, 'WF_INSTANCE_TERMINATE_REFUSED');

    await closeWorkflowInstances(tx, [inst], {
      actionKey: ADMIN_TERMINATE_ACTION_KEY,
      actionTitle: ADMIN_TERMINATE_ACTION_TITLE,
      comment: reason,
      userId: params.userId ?? null,
      userName: params.userName ?? null,
    });
    await logActivity({
      tx,
      req: params.req,
      action: 'UPDATE',
      entity: `ورکفلو (${inst.entityType})`,
      entityId: inst.entityId,
      description: `فرایند گردش کار ${workflowEntityTypeLabel(inst.entityType)} به دست مدیر بسته شد: ${reason}`,
      details: {
        instanceId: inst.id,
        reason,
        before: { status: inst.status },
        after: { status: 'TERMINATED', action: ADMIN_TERMINATE_ACTION_KEY },
      },
    });
    return { instanceId: inst.id, entityType: inst.entityType, entityId: inst.entityId };
  });
}
