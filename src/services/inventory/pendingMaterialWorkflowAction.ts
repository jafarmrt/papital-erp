import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { pendingMaterials } from '../../db/schema.js';
import {
  registerWorkflowTransitionAction, workflowEntityNumericId,
  type WorkflowActionTarget, type WorkflowTransitionEvent,
} from '../workflow/workflowTransitionActions.js';
import { PendingMaterialsService } from '../pendingMaterials.service.js';

/** The designer's automatic action «تأیید و افزودن به فهرست مواد اولیه» (`WorkflowDesignerCanvas.tsx`) */
export const APPROVE_PENDING_MATERIAL_ACTION = 'APPROVE_PENDING_MATERIAL';

const approvesRequest = (t: WorkflowActionTarget) => t.toStateKey === 'approved' || t.autoActionKey === APPROVE_PENDING_MATERIAL_ACTION;
const rejectsRequest = (t: WorkflowActionTarget) => t.toStateKey === 'rejected';

/**
 * v9.0.398 (TD-826، یافته B07-10، تصمیم ت۵ «الف»): گام «تأییدشده» یا اقدام خودکار `APPROVE_PENDING_MATERIAL` درخواست را
 * در همان تراکنش انتقال تأیید می‌کند (کالا از مسیر تعریف کالا و با همان قاعده‌های تأیید مستقیم) و گام «ردشده» آن را رد
 * می‌کند؛ خطای تأیید (کد تکراری، درخواست بررسی‌شده) انتقال را رد می‌کند. پیش‌تر هیچ اقدامی برای `pending_material` ثبت
 * نبود و گام‌های گردش کار درخواست را تغییر نمی‌دادند.
 */
export async function applyPendingMaterialTransition(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  const id = workflowEntityNumericId(event.entityId);
  if (id === undefined) return;
  const actor = { userId: event.performedBy || undefined, username: event.performedByName || 'گردش کار', viaWorkflow: true };
  if (approvesRequest(event)) {
    await PendingMaterialsService.approvePendingMaterial(id, {}, actor, tx);
  } else if (rejectsRequest(event)) {
    await PendingMaterialsService.rejectPendingMaterial(id, 'رد در گردش کار', actor, tx);
  }
}

async function lockRequest(tx: DbExecutor, entityId: string): Promise<boolean> {
  const id = workflowEntityNumericId(entityId);
  if (id === undefined) return false;
  const [row] = await tx.select({ id: pendingMaterials.id }).from(pendingMaterials)
    .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)))
    .for('update');
  return !!row;
}

export function registerPendingMaterialWorkflowAction(): void {
  registerWorkflowTransitionAction(['pending_material'], {
    // the request row before the instance row, the order of the direct approval (request lock, then terminateOpenWorkflows)
    lockEntity: async (tx, entityId) => { await lockRequest(tx, entityId); },
    entityExists: async (tx, entityId) => {
      const id = workflowEntityNumericId(entityId);
      if (id === undefined) return false;
      const [row] = await tx.select({ id: pendingMaterials.id }).from(pendingMaterials)
        .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));
      return !!row;
    },
    run: applyPendingMaterialTransition,
    // the same key as the direct approve and reject routes
    requiredPermissions: (t) => (approvesRequest(t) || rejectsRequest(t) ? ['pending_materials.approve'] : []),
  });
}
