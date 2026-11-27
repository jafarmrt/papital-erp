import type { DbExecutor } from '../../db/drizzle.js';
import { PrivateRefusalError } from '../../errors/customErrors.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { payrollAmountText } from '../../lib/payroll/payrollCurrency.js';
import { PayrollPaymentService } from '../accounting/payrollPayment.service.js';

/**
 * v12 colleague sales part B (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.3, owner's decision 3.3): «کسر از حساب جاری
 * همکار» is at most what the colleague owes on their running account (3208, from the ledger, with the personnel row locked by
 * the caller). A draft payslip's own deduction is already credited in its draft voucher, so it adds to the ceiling.
 */
export async function assertRunningDeductionWithinDebt(
  tx: DbExecutor,
  input: { personnelId: number; fullName: string; deduction: FinancialDecimal; alreadyDeducted?: DecimalValue; statusCode: 400 | 422 },
): Promise<void> {
  if (!input.deduction.isPositive()) return;
  const ceiling = (await PayrollPaymentService.getPersonnelRunningAccountDebt(input.personnelId, tx)).add(fin(input.alreadyDeducted ?? 0));
  if (input.deduction.greaterThan(ceiling)) {
    throw new PrivateRefusalError(
      `کسر از حساب جاری همکار (${payrollAmountText(input.deduction)}) از بدهی ${input.fullName} در حساب جاری همکار (${payrollAmountText(ceiling)}) بیشتر است؛ حداکثر همان بدهی کسر می‌شود.`,
      input.statusCode, 'PAYROLL_RUNNING_ACCOUNT_DEDUCTION_EXCEEDS_DEBT',
    );
  }
}

/**
 * v8.0.29 (TD-282، تصمیم مالک محصول — گزینه الف): کسر مساعده بیش از مانده مساعده تسویه‌نشده پرسنل (از دفتر کل) رد می‌شود
 * (moved here from the payslip issue beside the running-account rule, v12 colleague sales part B)
 */
export async function assertAdvanceDeductionWithinBalance(
  tx: DbExecutor,
  input: { personnelId: number; fullName: string; deduction: FinancialDecimal },
): Promise<void> {
  if (!input.deduction.isPositive()) return;
  const { outstandingAdvance } = await PayrollPaymentService.getPersonnelAdvanceBalance(input.personnelId, tx);
  if (input.deduction.greaterThan(outstandingAdvance)) {
    throw new PrivateRefusalError(
      `کسر مساعده (${payrollAmountText(input.deduction)}) از مانده مساعده تسویه‌نشده ${input.fullName} (${payrollAmountText(outstandingAdvance)}) بیشتر است؛ حداکثر همان مانده کسر می‌شود.`,
      400, 'PAYROLL_ADVANCE_DEDUCTION_EXCEEDS_BALANCE',
    );
  }
}
