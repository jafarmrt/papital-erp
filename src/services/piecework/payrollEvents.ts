import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import type { pieceworkPayrolls } from '../../db/schema.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, type PayrollEventPayload } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { notifyPayslipApproved } from './payslipApprovedNotice.js';

type PayrollRow = typeof pieceworkPayrolls.$inferSelect;

/**
 * OBS-R2-13 (product-owner decision ت۴۰ item 11): a payslip's approval (`PayrollApproved`) and each of its payments
 * (`PayrollPaid`) reach rules and webhooks through the outbox, written with the transaction of the approval or the payment.
 * `payroll` is the row as it stands after the change.
 */
export async function recordPayrollEvent(
  tx: DbExecutor,
  kind: 'approved' | 'paid',
  payroll: PayrollRow,
  actor: { userId?: number; username?: string },
  payment?: { transactionId: number; isFullyPaid: boolean },
): Promise<void> {
  // no personnel name and no amount (payslip amounts are for payroll readers only, an event reaches every «*» webhook)
  const payload: PayrollEventPayload = {
    payrollId: payroll.id,
    payrollNumber: payroll.payrollNumber,
    personnelId: payroll.personnelId,
    startDate: payroll.startDate,
    endDate: payroll.endDate,
    status: payroll.status ?? '',
    ...(payment ? { transactionId: payment.transactionId, isFullyPaid: payment.isFullyPaid } : {}),
  };
  const payrollEventType = kind === 'approved' ? DomainEventType.PAYROLL_APPROVED : DomainEventType.PAYROLL_PAID;
  await OutboxService.saveToOutbox(tx, domainEventBus.createEvent<PayrollEventPayload>(
    payrollEventType, 'Payroll', String(payroll.id), payload, { userId: actor.userId, userName: actor.username },
  ));
}

/**
 * A draft payslip just approved: its linked user's notice (v10.1.42) and the `PayrollApproved` event, both with the
 * approval's transaction. `before` is the payslip as it was read, `after` as it is saved.
 */
export async function onPayslipApproved(
  tx: DbTransaction, before: PayrollRow, after: PayrollRow, actor: { userId?: number; username?: string },
): Promise<void> {
  await notifyPayslipApproved(tx, before);
  await recordPayrollEvent(tx, 'approved', after, actor);
}
