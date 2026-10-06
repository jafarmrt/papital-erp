import type { DbExecutor } from '../../db/drizzle.js';
import { registerWorkflowTransitionAction, type WorkflowTransitionEvent } from '../workflow/workflowTransitionActions.js';
import { VoucherService } from './voucher.service.js';

const VOUCHER_STATUS_OF_STEP = new Map<string, 'draft' | 'approved' | 'permanent'>([
  ['draft', 'draft'],
  ['approved', 'approved'],
  ['permanent', 'permanent'],
]);

/**
 * v9.0.2 (TD-415): گام گردش‌کار سند حسابداری («draft»، «approved»، «permanent») وضعیت سند را در همان تراکنش انتقال عوض
 * می‌کند؛ تغییرِ ناممکن (سند دائم، سال مالی بسته، سند نامتراز) انتقال را رد می‌کند. پیش‌تر شنونده workflowEventBus بیرون از
 * تراکنش و با خطای بلعیده.
 */
export async function applyVoucherWorkflowStep(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  const status = VOUCHER_STATUS_OF_STEP.get(event.toStateKey);
  if (!status) return;
  const voucherId = Number(event.entityId);
  if (!Number.isInteger(voucherId) || voucherId <= 0) return;
  await VoucherService.applyVoucherStatus(tx, voucherId, status, event.performedBy);
}

export function registerVoucherWorkflowAction(): void {
  registerWorkflowTransitionAction(['journal_voucher', 'voucher'], { run: applyVoucherWorkflowStep });
}
