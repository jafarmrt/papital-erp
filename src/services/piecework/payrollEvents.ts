import { eq } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { personnel, pieceworkPayrolls } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
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
  payment?: { amount: number; transactionId: number; isFullyPaid: boolean },
): Promise<void> {
  const [pers] = await tx.select({ fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, payroll.personnelId));
  const netPayable = fin(payroll.netPayable ?? 0);
  const paidAmount = fin(payroll.paidAmount ?? 0);
  const payload: PayrollEventPayload = {
    payrollId: payroll.id,
    payrollNumber: payroll.payrollNumber,
    personnelId: payroll.personnelId,
    personnelName: pers?.fullName ?? '',
    startDate: payroll.startDate,
    endDate: payroll.endDate,
    netPayable: netPayable.toNumber(),
    paidAmount: paidAmount.toNumber(),
    remainingAmount: netPayable.subtract(paidAmount).toNumber(),
    status: payroll.status ?? '',
    currency: 'IRR',
    ...(payment ? { paymentAmount: payment.amount, transactionId: payment.transactionId, isFullyPaid: payment.isFullyPaid } : {}),
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
