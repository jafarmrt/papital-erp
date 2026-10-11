import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import {
  PAYROLL_ISSUER_CANNOT_APPROVE,
  PAYROLL_ISSUER_CANNOT_PAY,
  payrollIssuerDutyRefusal,
  type PayrollDuty,
} from '../../lib/payroll/payrollDuties.js';

/**
 * v10.0.193 (TD-1084, payroll duties plan decisions t2 / t3 «الف»): the issuer of a payslip (`created_by_id`) neither
 * approves it nor pays it nor voids its payment; the system admin is exempt. Read inside the caller's transaction, after
 * the payslip row lock.
 */
export async function assertPayrollDutyNotByIssuer(
  tx: DbExecutor,
  payroll: { id: number; createdById: number | null },
  actorId: number | undefined | null,
  duty: PayrollDuty,
): Promise<void> {
  if (!actorId || payroll.createdById === null || payroll.createdById !== actorId) return;
  const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId));
  const refusal = payrollIssuerDutyRefusal(payroll, { id: actorId, isAdmin: actor?.role === SYSTEM_ADMIN_ROLE }, duty);
  if (!refusal) return;
  throw new ForbiddenError(
    refusal,
    { payrollId: payroll.id },
    duty === 'approve' ? PAYROLL_ISSUER_CANNOT_APPROVE : PAYROLL_ISSUER_CANNOT_PAY,
  );
}
