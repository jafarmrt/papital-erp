import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import type { pieceworkPayrolls } from '../../db/schema.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, type PayrollEventPayload } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { notifyPayslipApproved } from './payslipApprovedNotice.js';

type PayrollRow = typeof pieceworkPayrolls.$inferSelect;

type PayrollEventKind = 'approved' | 'paid' | 'payment_voided' | 'deleted';

/**
 * The `TreasuryTransactionApproved` payload of a payslip payment or its void: the treasury row, its bank and the payslip,
 * never the amount, the remaining balance, the employee's name or the free text (description, reason) that holds them,
 * since the event reaches every «*» webhook and the event screens while a salary is for payroll readers only (v10.1.66).
 */
export function payrollTreasuryEventPayload(fields: {
  transactionId: number;
  type: 'deposit' | 'withdrawal';
  currency: string;
  bank: { id: number; title: string | null };
  payroll: { id: number; payrollNumber: string };
  isFullyPaid?: boolean;
  voided?: { transactionId: number; transactionNumber: string | null };
}): Record<string, unknown> {
  return {
    transactionId: fields.transactionId,
    type: fields.type,
    currency: fields.currency,
    accountId: fields.bank.id,
    accountName: fields.bank.title ?? '',
    payrollId: fields.payroll.id,
    payrollNumber: fields.payroll.payrollNumber,
    ...(fields.isFullyPaid !== undefined ? { isFullyPaid: fields.isFullyPaid } : {}),
    ...(fields.voided ? {
      isReversal: true, voidedTransactionId: fields.voided.transactionId, voidedTransactionNumber: fields.voided.transactionNumber,
    } : {}),
  };
}

/**
 * OBS-R2-13 (product-owner decision ت۴۰ item 11): a payslip's approval (`PayrollApproved`) and each of its payments
 * (`PayrollPaid`) reach rules and webhooks through the outbox, written with the transaction of the approval or the payment;
 * since v10.1.66 so do a payment's void (`PayrollPaymentVoided`) and the payslip's delete (`PayrollDeleted`).
 * `payroll` is the row as it stands after the change.
 */
export async function recordPayrollEvent(
  tx: DbExecutor,
  kind: PayrollEventKind,
  payroll: PayrollRow,
  actor: { userId?: number; username?: string },
  payment?: { transactionId: number; isFullyPaid?: boolean; voidedTransactionId?: number },
): Promise<void> {
  // no personnel name and no amount (payslip amounts are for payroll readers only, an event reaches every «*» webhook)
  const payload: PayrollEventPayload = {
    payrollId: payroll.id,
    payrollNumber: payroll.payrollNumber,
    personnelId: payroll.personnelId,
    startDate: payroll.startDate,
    endDate: payroll.endDate,
    status: payroll.status ?? '',
    ...(payment ? { transactionId: payment.transactionId } : {}),
    ...(payment?.isFullyPaid !== undefined ? { isFullyPaid: payment.isFullyPaid } : {}),
    ...(payment?.voidedTransactionId !== undefined ? { voidedTransactionId: payment.voidedTransactionId } : {}),
  };
  const payrollEventType = kind === 'approved' ? DomainEventType.PAYROLL_APPROVED
    : kind === 'paid' ? DomainEventType.PAYROLL_PAID
      : kind === 'payment_voided' ? DomainEventType.PAYROLL_PAYMENT_VOIDED : DomainEventType.PAYROLL_DELETED;
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

/** A deleted payslip (`before` as read, `after` as saved): `PayrollDeleted` when it was past draft, so it had an event */
export async function onPayslipDeleted(
  tx: DbExecutor, before: PayrollRow, after: PayrollRow, actor: { userId?: number; username?: string },
): Promise<void> {
  if (before.status === 'draft') return;
  await recordPayrollEvent(tx, 'deleted', after, actor);
}
