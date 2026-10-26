import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances, workflowStates } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';

/** The menu name of the approval inbox, where a document under approval is finalized */
export const APPROVAL_INBOX_TITLE = 'کارتابل تاییدات و گردش کار';

/**
 * v11 phase 6.1پ (C2, decision ت۵۲-۴ «الف»): a document whose approval workflow is running is finalized only from the
 * approval inbox, by the step that finalizes it; `PUT /documents/:id/finalize` refuses it with 409
 * `DOCUMENT_WORKFLOW_OPEN`, naming the current step. A document without a running instance (none started, or one already
 * ended, rejected or closed) finalizes there as before. Before, a holder of `documents.finalize` finalized it there and the
 * running instance was closed in the same transaction, so the approval steps were skipped.
 */
export async function assertDocumentWorkflowClosed(tx: DbExecutor, documentId: number, documentLabel: string): Promise<void> {
  const [open] = await tx.select({ id: workflowInstances.id, step: workflowStates.title })
    .from(workflowInstances)
    .leftJoin(workflowStates, eq(workflowStates.id, workflowInstances.currentStateId))
    .where(and(
      eq(workflowInstances.entityType, 'document'),
      eq(workflowInstances.entityId, String(documentId)),
      eq(workflowInstances.status, 'IN_PROGRESS'),
    ))
    .orderBy(asc(workflowInstances.id))
    .limit(1);
  if (!open) return;
  const step = open.step ? ` (گام «${open.step}»)` : '';
  throw new ConflictError(
    `${documentLabel} در گردش کار تأیید است${step}؛ قطعی کردن آن از «${APPROVAL_INBOX_TITLE}» و با گام تأیید آن انجام می‌شود.`,
    { instanceId: open.id, step: open.step },
    'DOCUMENT_WORKFLOW_OPEN',
  );
}
