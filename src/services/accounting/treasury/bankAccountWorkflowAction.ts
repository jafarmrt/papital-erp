import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts } from '../../../db/schema.js';
import { registerWorkflowTransitionAction, workflowEntityNumericId, type WorkflowTransitionEvent } from '../../workflow/workflowTransitionActions.js';
import { BankAccountService } from './bankAccount.service.js';

/**
 * v9.0.2 (TD-415): تأیید نهایی گردش‌کار حساب خزانه سند افتتاحیه موجودی اولیه را در همان تراکنش انتقال صادر می‌کند؛ شکست
 * صدور (مثلاً حساب بی سرفصل معین) تأیید را رد می‌کند (پیش‌تر شنونده workflowEventBus بیرون از تراکنش و با خطای بلعیده).
 */
export async function issueApprovedTreasuryOpening(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  if (event.toStateKey !== 'approved') return;
  const bankId = Number(event.entityId);
  if (!Number.isInteger(bankId) || bankId <= 0) return;
  await BankAccountService.issueTreasuryOpeningVoucher(bankId, {
    userId: event.performedBy || undefined,
    username: event.performedByName || 'تایید خودکار گردش‌کار',
    tx,
  });
}

/** v9.0.33 (TD-443): حساب خزانه هست و حذف نشده است */
async function bankAccountExists(tx: DbExecutor, entityId: string): Promise<boolean> {
  const id = workflowEntityNumericId(entityId);
  if (id === undefined) return false;
  const [row] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.isDeleted, 0)));
  return !!row;
}

export function registerBankAccountWorkflowAction(): void {
  registerWorkflowTransitionAction(['bank_account'], { run: issueApprovedTreasuryOpening, entityExists: bankAccountExists });
}
