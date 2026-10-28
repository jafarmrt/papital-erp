import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { registerWorkflowTransitionAction, workflowEntityNumericId, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
import { ItemOpeningService } from './itemOpening.service.js';
import { withdrawUnapprovedOpening } from './itemOpeningWithdraw.js';

/** The steps that end an item definition without approval (`workflowEndOutcome`: rejected, canceled) */
const WITHDRAWING_STATE_KEYS: ReadonlySet<string> = new Set(['rejected', 'canceled']);

/**
 * v9.0.2 (TD-415): تأیید نهایی گردش‌کار تعریف کالا سند افتتاحیه موجودی اولیه را در همان تراکنش انتقال صادر می‌کند؛ شکست
 * صدور تأیید را رد می‌کند (پیش‌تر شنونده workflowEventBus بیرون از تراکنش صادر می‌کرد و خطا را می‌بلعید).
 */
export async function issueApprovedItemOpening(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  const itemId = Number(event.entityId);
  if (!Number.isInteger(itemId) || itemId <= 0) return;
  // v11 phase 6.1j (S13): a rejected or canceled definition takes back the opening stock that never got a voucher
  if (WITHDRAWING_STATE_KEYS.has(event.toStateKey)) {
    await withdrawUnapprovedOpening(tx, itemId, event.performedBy || undefined);
    return;
  }
  if (event.toStateKey !== 'approved') return;
  await ItemOpeningService.issueItemOpeningVoucher(itemId, {
    userId: event.performedBy || undefined,
    username: event.performedByName || 'تایید خودکار گردش‌کار',
    tx,
  });
}

/** v9.0.33 (TD-443): کالا هست و حذف نشده است */
async function itemExists(tx: DbExecutor, entityId: string): Promise<boolean> {
  const id = workflowEntityNumericId(entityId);
  if (id === undefined) return false;
  const [row] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, id), eq(items.isDeleted, 0)));
  return !!row;
}

export function registerItemOpeningWorkflowAction(): void {
  registerWorkflowTransitionAction(['item'], {
    run: issueApprovedItemOpening,
    entityExists: itemExists,
    // v9.0.35 (TD-445، ت۳): سند افتتاحیه کالا همان مجوز ساخت کالا (`POST /items`) را می‌خواهد
    requiredPermissions: (t) => (t.toStateKey === 'approved' ? ['products.create'] : []),
  });
}
