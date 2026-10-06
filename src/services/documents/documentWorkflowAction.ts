import type { DbExecutor } from '../../db/drizzle.js';
import { registerWorkflowTransitionAction, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
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

export function registerDocumentWorkflowAction(): void {
  registerWorkflowTransitionAction(['document'], { run: finalizeApprovedDocument });
}
