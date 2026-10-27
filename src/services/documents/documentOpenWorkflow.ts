import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances, workflowTransitions } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { snapshotTransitionsOf } from '../workflow/workflowSnapshot.js';
import { currentStepOf } from './documentReviewLock.js';

/** The menu name of the approval inbox, where a document under approval is finalized */
export const APPROVAL_INBOX_TITLE = 'کارتابل تاییدات و گردش کار';

export const DOCUMENT_IN_WORKFLOW = 'DOCUMENT_IN_WORKFLOW';

interface DocumentInstance {
  id: number;
  status: string | null;
  workflowDefinitionId: number;
  snapshotDsl: unknown;
  currentStateId: number;
}

/** a rejected instance is sent again by an action out of its current step (`reopen`); a design without one ends there */
async function canSendAgain(tx: DbExecutor, instance: DocumentInstance): Promise<boolean> {
  const transitions = snapshotTransitionsOf(instance.snapshotDsl)
    ?? await tx.select({ fromStateId: workflowTransitions.fromStateId }).from(workflowTransitions)
      .where(eq(workflowTransitions.workflowDefinitionId, instance.workflowDefinitionId));
  return transitions.some(t => t.fromStateId === instance.currentStateId);
}

/**
 * v11 phase 6.1p (C2, decision ت۵۲-۴ «الف»): a document in its approval workflow is finalized only from the approval
 * inbox, by the step that finalizes it; `PUT /documents/:id/finalize` refuses it with 409 `DOCUMENT_IN_WORKFLOW`, naming
 * the current step. «In its workflow» is any instance of the document running, or its latest one rejected while its design
 * can send it again: a rejection returns the document to its sender to correct and send again (`reopen`), and finalizing
 * it here would override the rejection. A document without one (none started, the latest completed or closed by an
 * admin, or rejected in a design with no way back) finalizes there as before. Before, a holder of `documents.finalize`
 * finalized it there and the running instance was closed in the same transaction, so the approval steps were skipped.
 */
export async function assertDocumentWorkflowClosed(tx: DbExecutor, documentId: number, documentLabel: string): Promise<void> {
  const instances: DocumentInstance[] = await tx.select({
    id: workflowInstances.id,
    status: workflowInstances.status,
    workflowDefinitionId: workflowInstances.workflowDefinitionId,
    snapshotDsl: workflowInstances.snapshotDsl,
    currentStateId: workflowInstances.currentStateId,
  })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'document'), eq(workflowInstances.entityId, String(documentId))))
    .orderBy(desc(workflowInstances.id));
  const latest = instances[0];
  const open = instances.find(i => i.status === 'IN_PROGRESS')
    ?? (latest?.status === 'REJECTED' && await canSendAgain(tx, latest) ? latest : undefined);
  if (!open) return;
  const title = (await currentStepOf(tx, open.snapshotDsl, open.currentStateId))?.title.trim() ?? '';
  const step = title ? ` (گام «${title}»)` : '';
  const message = open.status === 'REJECTED'
    ? `${documentLabel} در گردش کار تأیید رد شده است${step}؛ آن را اصلاح کنید و از «${APPROVAL_INBOX_TITLE}» دوباره بفرستید تا با گام تأیید قطعی شود.`
    : `${documentLabel} در گردش کار تأیید است${step}؛ قطعی کردن آن از «${APPROVAL_INBOX_TITLE}» و با گام تأیید آن انجام می‌شود.`;
  throw new ConflictError(message, { instanceId: open.id, status: open.status, step: title || null }, DOCUMENT_IN_WORKFLOW);
}
