import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { activityLogs, documents } from '../../db/schema.js';
import {
  registerWorkflowTransitionAction, workflowEntityNumericId,
  type WorkflowActionEntity, type WorkflowActionTarget, type WorkflowTransitionEvent,
} from '../workflow/workflowTransitionActions.js';
import { SALES_FINALIZE_PERMISSION } from '../../lib/permissions/documentPermissions.js';
import { permissionToFinalizeDocument } from './documentRecordRule.js';
import { DocumentLifecycleService } from './documentLifecycle.service.js';
import { documentAuditDetails, documentAuditSnapshot } from './documentAudit.js';
import { logActivity } from '../../lib/auditLogger.js';
import { RESERVING_DOCUMENT_STATUS } from '../../lib/documents/reservingDocuments.js';
import { assertProformaResendWithinSellable } from './documentSellableGate.js';

/** audit operation of `returnRejectedProformaToDraft`, read back by the resend (TD-1204) */
const REJECT_TO_DRAFT_OPERATION = 'WORKFLOW_REJECT_TO_DRAFT';

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
  // v10.0.41 (TD-929، P5-S-05): ردیف ممیزی نهایی‌سازی با سند پیش و پس، با همین تراکنش، همان ردیف `PUT /documents/:id/finalize`
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

/**
 * v10.0.85 (TD-1137، تصمیم مالک محصول ت۱۲ «پیش‌نویس شود»): ردِ گردش کار (گام `rejected`) پیش‌فاکتور را در همان تراکنش
 * انتقال پیش‌نویس می‌کند، پس رزروش آزاد می‌شود؛ فروشنده آن را اصلاح، دوباره پیش‌فاکتور و پس از «بازگشایی» دوباره ارسال
 * می‌کند. نسخه سند بالا می‌رود و ردیف ممیزی با پیش و پس از سند در همان تراکنش نوشته می‌شود. سند در وضعیت دیگر دست نمی‌خورد.
 * پیش‌تر پیش‌فاکتور ردشده پیش‌فاکتور می‌ماند و تا ابطال کالا را رزرو می‌کرد.
 */
export async function returnRejectedProformaToDraft(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  if (event.toStateKey !== 'rejected') return;
  const documentId = workflowEntityNumericId(event.entityId);
  if (documentId === undefined) return;
  const [doc] = await tx.select({ status: documents.status, version: documents.version, refNumber: documents.refNumber })
    .from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0))).for('update');
  if (!doc || doc.status !== RESERVING_DOCUMENT_STATUS) return;
  const before = await documentAuditSnapshot(tx, documentId);
  await tx.update(documents).set({ status: 'draft', version: Number(doc.version ?? 1) + 1 }).where(eq(documents.id, documentId));
  const after = await documentAuditSnapshot(tx, documentId);
  await logActivity({
    tx,
    userId: event.performedBy,
    username: event.performedByName || 'رد گردش کار',
    action: 'UPDATE',
    entity: 'اسناد انبار / پیش‌فاکتور',
    entityId: documentId,
    description: `پیش‌فاکتور شماره "${doc.refNumber ?? documentId}" با رد گردش کار پیش‌نویس شد`,
    details: { ...documentAuditDetails(before, after), operation: REJECT_TO_DRAFT_OPERATION, workflowInstanceId: event.instanceId },
  });
}

/**
 * TD-1204 (product-owner decision t19 «خودکار»): a proforma that a rejection of this same workflow instance turned into a
 * draft (`returnRejectedProformaToDraft`) becomes a proforma again in the transaction of the transition that sends it on
 * from the initial step, so it reserves again during the second review. A line above the sellable stock refuses the
 * resend (`assertProformaResendWithinSellable`). A direct approval finalizes as before; a draft that was never a proforma
 * stays a draft. The version goes up and the audit row holds the document before and after. Before, the resent document
 * stayed a draft through the second review and reserved nothing until it was invoiced.
 */
export async function resendRejectedProformaAsProforma(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  if (event.fromStateKey !== 'draft') return;
  if (['draft', 'rejected', 'approved'].includes(event.toStateKey) || event.autoActionKey === 'POST_INVOICE') return;
  const documentId = workflowEntityNumericId(event.entityId);
  if (documentId === undefined) return;
  const [doc] = await tx.select({ status: documents.status, version: documents.version, refNumber: documents.refNumber })
    .from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0))).for('update');
  if (!doc || doc.status !== 'draft') return;
  const [rejected] = await tx.select({ id: activityLogs.id }).from(activityLogs).where(and(
    eq(activityLogs.entityId, String(documentId)),
    sql`${activityLogs.details}->>'operation' = ${REJECT_TO_DRAFT_OPERATION}`,
    sql`${activityLogs.details}->>'workflowInstanceId' = ${String(event.instanceId)}`,
  )).limit(1);
  if (!rejected) return;
  await assertProformaResendWithinSellable(tx, documentId);
  const before = await documentAuditSnapshot(tx, documentId);
  await tx.update(documents).set({ status: RESERVING_DOCUMENT_STATUS, version: Number(doc.version ?? 1) + 1 })
    .where(eq(documents.id, documentId));
  const after = await documentAuditSnapshot(tx, documentId);
  await logActivity({
    tx,
    userId: event.performedBy,
    username: event.performedByName || 'ارسال دوباره گردش کار',
    action: 'UPDATE',
    entity: 'اسناد انبار / پیش‌فاکتور',
    entityId: documentId,
    description: `پیش‌فاکتور شماره "${doc.refNumber ?? documentId}" با ارسال دوباره برای بررسی دوباره پیش‌فاکتور شد و کالایش رزرو شد`,
    details: { ...documentAuditDetails(before, after), operation: 'WORKFLOW_RESEND_TO_PROFORMA', workflowInstanceId: event.instanceId },
  });
}

async function runDocumentTransition(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  await returnRejectedProformaToDraft(tx, event);
  await resendRejectedProformaAsProforma(tx, event);
  await finalizeApprovedDocument(tx, event);
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
    run: runDocumentTransition,
    entityExists: documentExists,
    // v9.0.35 (TD-445، ت۳): قطعی‌سازی از گردش‌کار همان مجوز `PUT /documents/:id/finalize` را می‌خواهد؛ از v9.0.125
    // (TD-541 / TD-771) همان مجوز جدول برای نوع همین سند (سند فروش: «قطعی کردن سند فروش»)، نه هر یک از سه مجوز
    requiredPermissions: finalizePermissionsOfStep,
  });
}
