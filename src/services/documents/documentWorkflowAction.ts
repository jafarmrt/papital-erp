import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { registerWorkflowTransitionAction, workflowEntityNumericId, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
import { DocumentLifecycleService } from './documentLifecycle.service.js';

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
  await DocumentLifecycleService.finalizeDocument(documentId, event.performedByName || 'تایید خودکار گردش‌کار', tx, { allowBackdate: event.allowBackdate });
}

/** v9.0.33 (TD-443): سند هست و حذف نشده است */
async function documentExists(tx: DbExecutor, entityId: string): Promise<boolean> {
  const id = workflowEntityNumericId(entityId);
  if (id === undefined) return false;
  const [row] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
  return !!row;
}

export function registerDocumentWorkflowAction(): void {
  registerWorkflowTransitionAction(['document'], {
    run: finalizeApprovedDocument,
    entityExists: documentExists,
    // v9.0.35 (TD-445، ت۳): قطعی‌سازی از گردش‌کار همان مجوزهای `PUT /documents/:id/finalize` را می‌خواهد
    requiredPermissions: (t) => (t.toStateKey === 'approved' || t.autoActionKey === 'POST_INVOICE' ? ['documents.edit', 'warehouse.in', 'warehouse.out'] : []),
  });
}
