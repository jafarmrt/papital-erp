import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import {
  registerWorkflowTransitionAction, workflowEntityNumericId,
  type WorkflowActionEntity, type WorkflowActionTarget, type WorkflowTransitionEvent,
} from '../workflow/workflowTransitionActions.js';
import { SALES_FINALIZE_PERMISSION } from '../../lib/permissions/documentPermissions.js';
import { permissionToFinalizeDocument } from './documentRecordRule.js';
import { DocumentLifecycleService } from './documentLifecycle.service.js';
import { documentAuditDetails } from './documentAudit.js';
import { logActivity } from '../../lib/auditLogger.js';

/**
 * v9.0.2 (TD-415): تأیید نهایی گردش‌کار سند (گام «approved» یا اقدام خودکار POST_INVOICE) سند را در همان تراکنش انتقال
 * قطعی می‌کند و قطعی‌سازیِ ناممکن (کسری موجودی، سال مالی بسته، نرخ ارز) تأیید را با همان خطا رد می‌کند. پیش‌تر شنونده
 * workflowEventBus بیرون از تراکنش قطعی می‌کرد و خطا را می‌بلعید: گردش‌کار «تأییدشده» و سند پیش‌نویس می‌ماند.
 */
export async function finalizeApprovedDocument(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  if (event.toStateKey !== 'approved' && event.autoActionKey !== 'POST_INVOICE') return;
  const documentId = Number(event.entityId);
  // شناسه غیرعددی، نمونه‌ای بی سند واقعی است (مانند پیش)
  if (!Number.isInteger(documentId) || documentId <= 0) return;
  const user = event.performedByName || 'تایید خودکار گردش‌کار';
  const change = await DocumentLifecycleService.finalizeDocument(documentId, user, tx, { allowBackdate: event.allowBackdate });
  // v10.0.22 (TD-929، P5-S-05): ردیف ممیزی نهایی‌سازی با سند پیش و پس، با همین تراکنش، همان ردیف `PUT /documents/:id/finalize`
  // (TD-785)؛ پیش‌تر سندی که گردش کار قطعی می‌کرد در خط زمانی ممیزی دیده نمی‌شد. سند از پیش قطعی ردیفی نمی‌گیرد.
  if (change) {
    await logActivity({
      tx,
      userId: event.performedBy,
      username: user,
      action: 'UPDATE',
      entity: 'اسناد انبار',
      entityId: documentId,
      description: `نهایی‌سازی سند شماره "${change.after?.refNumber || change.before?.refNumber || documentId}" با تأیید گردش کار`,
      details: { ...documentAuditDetails(change.before, change.after), operation: 'WORKFLOW_APPROVAL', workflowInstanceId: event.instanceId },
    });
  }
}

/** v9.0.33 (TD-443): سند هست و حذف نشده است */
async function documentExists(tx: DbExecutor, entityId: string): Promise<boolean> {
  const id = workflowEntityNumericId(entityId);
  if (id === undefined) return false;
  const [row] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
  return !!row;
}

/** v9.0.125 (TD-541 / TD-771): گام قطعی‌سازی مجوز نهایی کردن همین نوع سند را می‌خواهد؛ سند ناپیدا مانند سند فروش */
async function finalizePermissionsOfStep(target: WorkflowActionTarget, entity: WorkflowActionEntity): Promise<string[]> {
  if (target.toStateKey !== 'approved' && target.autoActionKey !== 'POST_INVOICE') return [];
  const id = workflowEntityNumericId(entity.entityId);
  const [doc] = id === undefined ? [] : await entity.tx.select({ type: documents.type }).from(documents).where(eq(documents.id, id));
  return [doc ? permissionToFinalizeDocument(doc.type) : SALES_FINALIZE_PERMISSION];
}

export function registerDocumentWorkflowAction(): void {
  registerWorkflowTransitionAction(['document'], {
    run: finalizeApprovedDocument,
    entityExists: documentExists,
    // v9.0.35 (TD-445، ت۳): قطعی‌سازی از گردش‌کار همان مجوز `PUT /documents/:id/finalize` را می‌خواهد؛ از v9.0.125
    // (TD-541 / TD-771) همان مجوز جدول برای نوع همین سند (سند فروش: «قطعی کردن سند فروش»)، نه هر یک از سه مجوز
    requiredPermissions: finalizePermissionsOfStep,
  });
}
