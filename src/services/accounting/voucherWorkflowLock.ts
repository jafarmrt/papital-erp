import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.1.10 (TD-1263, D-06 part B, decision ت۶ «خودکار»): a manual voucher enters the active journal voucher workflow in
 * its create transaction, and while that workflow runs the voucher's status moves only through its steps (the voucher's
 * «گردش کار» window or the inbox). Approving, finalizing or putting it back to draft from the voucher page is 409
 * `VOUCHER_IN_WORKFLOW`; a batch leaves it out with that reason. The workflow's own steps change the status through
 * `applyVoucherStatus`, which this rule does not touch. Read only: the workflow tables are written by the engine alone.
 */
export const VOUCHER_IN_WORKFLOW = 'VOUCHER_IN_WORKFLOW';

const OPEN_STATUS = 'IN_PROGRESS';
const VOUCHER_ENTITY_TYPES = ['journal_voucher', 'voucher'];

/** Ids of the given vouchers whose workflow is running */
export async function vouchersInOpenWorkflow(db: DbExecutor, voucherIds: number[]): Promise<Set<number>> {
  if (voucherIds.length === 0) return new Set();
  const rows = await db.select({ entityId: workflowInstances.entityId }).from(workflowInstances)
    .where(and(
      inArray(workflowInstances.entityType, VOUCHER_ENTITY_TYPES),
      inArray(workflowInstances.entityId, voucherIds.map(String)),
      eq(workflowInstances.status, OPEN_STATUS),
    ));
  return new Set(rows.map(r => Number(r.entityId)));
}

export function voucherInWorkflowMessage(voucherNumber: string | number | null | undefined): string {
  const number = voucherNumber === null || voucherNumber === undefined ? '' : ` شماره ${toPersianDigits(String(voucherNumber))}`;
  return `سند${number} در گردش کار تأیید است؛ تأیید، قطعی کردن یا بازگشت آن به پیش‌نویس را از «گردش کار» همین سند یا کارتابل انجام دهید.`;
}

/** Refuses a direct status change of a voucher whose workflow is running (the caller holds the voucher row lock) */
export async function assertVoucherNotInWorkflow(db: DbExecutor, voucher: { id: number; voucherNumber?: string | number | null }): Promise<void> {
  if ((await vouchersInOpenWorkflow(db, [voucher.id])).has(voucher.id)) {
    throw new ConflictError(voucherInWorkflowMessage(voucher.voucherNumber), { voucherId: voucher.id }, VOUCHER_IN_WORKFLOW);
  }
}
