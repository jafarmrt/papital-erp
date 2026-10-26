import { and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { currentStepOf } from './documentReviewLock.js';

/** The menu name of the approval inbox, where a document under approval is finalized */
export const APPROVAL_INBOX_TITLE = 'کارتابل تاییدات و گردش کار';

export const DOCUMENT_IN_WORKFLOW = 'DOCUMENT_IN_WORKFLOW';

/**
 * v11 phase 6.1p (C2, decision ت۵۲-۴ «الف»): a document in its approval workflow is finalized only from the approval
 * inbox, by the step that finalizes it; `PUT /documents/:id/finalize` refuses it with 409 `DOCUMENT_IN_WORKFLOW`, naming
 * the current step. «In its workflow» is the document's latest instance running, or rejected: a rejection returns the
 * document to its sender to correct and send again (`reopen`), and finalizing it here would override the rejection. A
 * document without one (none started, or the latest one completed or closed by an admin) finalizes there as before.
 * Before, a holder of `documents.finalize` finalized it there and the running instance was closed in the same
 * transaction, so the approval steps were skipped.
 */
export async function assertDocumentWorkflowClosed(tx: DbExecutor, documentId: number, documentLabel: string): Promise<void> {
  const [latest] = await tx.select({
    id: workflowInstances.id, status: workflowInstances.status, snapshotDsl: workflowInstances.snapshotDsl, currentStateId: workflowInstances.currentStateId,
  })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'document'), eq(workflowInstances.entityId, String(documentId))))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  if (!latest || (latest.status !== 'IN_PROGRESS' && latest.status !== 'REJECTED')) return;
  const title = (await currentStepOf(tx, latest.snapshotDsl, latest.currentStateId))?.title.trim() ?? '';
  const step = title ? ` (گام «${title}»)` : '';
  const message = latest.status === 'REJECTED'
    ? `${documentLabel} در گردش کار تأیید رد شده است${step}؛ آن را اصلاح کنید و از «${APPROVAL_INBOX_TITLE}» دوباره بفرستید تا با گام تأیید قطعی شود.`
    : `${documentLabel} در گردش کار تأیید است${step}؛ قطعی کردن آن از «${APPROVAL_INBOX_TITLE}» و با گام تأیید آن انجام می‌شود.`;
  throw new ConflictError(message, { instanceId: latest.id, status: latest.status, step: title || null }, DOCUMENT_IN_WORKFLOW);
}
