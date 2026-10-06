import type { DbExecutor } from '../../db/drizzle.js';
import { registerWorkflowTransitionAction, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
import { ItemOpeningService } from './itemOpening.service.js';

/**
 * v9.0.2 (TD-415): تأیید نهایی گردش‌کار تعریف کالا سند افتتاحیه موجودی اولیه را در همان تراکنش انتقال صادر می‌کند؛ شکست
 * صدور تأیید را رد می‌کند (پیش‌تر شنونده workflowEventBus بیرون از تراکنش صادر می‌کرد و خطا را می‌بلعید).
 */
export async function issueApprovedItemOpening(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  if (event.toStateKey !== 'approved') return;
  const itemId = Number(event.entityId);
  if (!Number.isInteger(itemId) || itemId <= 0) return;
  await ItemOpeningService.issueItemOpeningVoucher(itemId, {
    userId: event.performedBy || undefined,
    username: event.performedByName || 'تایید خودکار گردش‌کار',
    tx,
  });
}

export function registerItemOpeningWorkflowAction(): void {
  registerWorkflowTransitionAction(['item'], { run: issueApprovedItemOpening });
}
