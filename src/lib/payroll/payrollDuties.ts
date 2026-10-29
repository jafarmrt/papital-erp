/**
 * v10.0.193 (TD-1083 / TD-1084, OBS-R2-48, payroll duties plan decisions t1 to t3 «الف»): a payslip is issued as a draft
 * and approved separately with `piecework.payroll_approve`; the user who issued a payslip does not approve it. The system
 * admin is exempt, and the audit row names who acted. One rule for the server (`src/services/piecework/payrollDuties.ts`)
 * and the payroll screens, which show the button disabled with the reason.
 *
 * v11 (owner's decision 7 Aban 1405, for the 1405 replay and after: the accountant issues, the manager approves): once
 * another user has approved the payslip, its issuer may pay it and void its payment. The payslip keeps who approved it
 * (`approvedById`, migration 0012); a payslip with no approver (approved before v11, or issued already approved before
 * v10.0.193) or approved by its issuer as system admin is not paid by its issuer.
 */

export const PAYROLL_ISSUER_CANNOT_APPROVE = 'PAYROLL_ISSUER_CANNOT_APPROVE';
export const PAYROLL_ISSUER_CANNOT_PAY = 'PAYROLL_ISSUER_CANNOT_PAY';

export type PayrollDuty = 'approve' | 'pay';

export interface PayrollDutyViewer {
  id: number;
  isAdmin: boolean;
}

/** The reason the issuer may not do this duty on their own payslip, or null when the rule does not apply */
export function payrollIssuerDutyRefusal(
  payroll: { createdById?: number | null; approvedById?: number | null; status?: string | null },
  viewer: PayrollDutyViewer | null,
  duty: PayrollDuty,
): string | null {
  if (!viewer || viewer.isAdmin) return null;
  const issuerId = payroll.createdById ?? null;
  if (issuerId === null || issuerId !== viewer.id) return null;
  const approverId = payroll.approvedById ?? null;
  if (duty === 'pay' && payroll.status && payroll.status !== 'draft' && approverId !== null && approverId !== issuerId) return null;
  if (duty === 'approve') return 'این فیش را خودتان صادر کرده‌اید؛ تأیید آن با کاربر دیگری است.';
  if (payroll.status && payroll.status !== 'draft') {
    return approverId === issuerId
      ? 'این فیش را خودتان صادر و تأیید کرده‌اید؛ پرداخت آن با کاربر دیگری است.'
      : 'تأییدکنندهٔ این فیش ثبت نشده است (پیش از این نسخه تأیید شده)؛ پرداخت آن با کاربر دیگری است، یا کاربر دیگری آن را به پیش‌نویس برگرداند و دوباره تأیید کند.';
  }
  return 'این فیش را خودتان صادر کرده‌اید؛ پس از تأیید کاربر دیگری می‌توانید آن را بپردازید.';
}
