import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import type { InvariantViolation } from './businessInvariants.js';
import { rows } from './ledgerRows.js';

/**
 * v9.0.231 (TD-804, B12P-01) — payroll invariant I10 (V8_MASTER_ROADMAP.md §4), read-only SQL over the live payslips
 * with an id above the watermark:
 * - bonuses, deductions and advance deduction are never negative;
 * - a payslip with a positive net has a live voucher (linked by `source_payroll_id`);
 * - its voucher credits «wages payable» (mapped 3201) with exactly the net, and the advance (mapped 1301) and other
 *   deductions (mapped 3202) accounts with exactly the advance deduction and the other deductions.
 */
export async function checkPayrollInvariants(payrollIdAfter: number | undefined): Promise<InvariantViolation[]> {
  if (payrollIdAfter === undefined) return [];
  const [payable, advance, deductions] = await Promise.all([
    AccountMappingService.getWagesPayableAccount(),
    AccountMappingService.getEmployeeAdvanceAccount(),
    AccountMappingService.getEmployeeDeductionsPayableAccount(),
  ]);
  const accountCredit = (accountId: number | undefined) => `COALESCE((SELECT SUM(i.credit - i.debit) FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_payroll_id = p.id AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = ${Number(accountId ?? 0)}
        AND i.detailed_type = 'personnel' AND i.detailed_id = p.personnel_id), 0)::text`;
  const payslips = await rows<{
    id: number; payroll_number: string; net: string; bonuses: string; deductions: string; advance: string;
    has_voucher: boolean; payable: string; advance_credit: string; deductions_credit: string;
  }>(
    `SELECT p.id, p.payroll_number, COALESCE(p.net_payable, 0)::text AS net, COALESCE(p.total_bonuses, 0)::text AS bonuses,
            COALESCE(p.total_deductions, 0)::text AS deductions, COALESCE(p.advance_deduction, 0)::text AS advance,
            EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.source_payroll_id = p.id AND v.is_deleted = 0) AS has_voucher,
            ${accountCredit(payable?.id)} AS payable,
            ${accountCredit(advance?.id)} AS advance_credit,
            ${accountCredit(deductions?.id)} AS deductions_credit
       FROM piecework_payrolls p
      WHERE p.is_deleted = 0 AND p.id > $1
      ORDER BY p.id`,
    [payrollIdAfter]
  );
  const violations: InvariantViolation[] = [];
  const differs = (a: string, b: string) => fin(a).subtract(fin(b)).abs().greaterThan(VOUCHER_BALANCE_TOLERANCE);
  for (const p of payslips) {
    const key = `payroll:${p.id}`;
    const message = (what: string) => `Payslip ${p.payroll_number}: ${what}`;
    if (fin(p.bonuses).isNegative() || fin(p.deductions).isNegative() || fin(p.advance).isNegative()) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('negative bonuses, deductions or advance deduction'),
        expected: '>= 0', actual: `${p.bonuses} / ${p.deductions} / ${p.advance}` });
      continue;
    }
    if (!p.has_voucher) {
      if (fin(p.net).isPositive()) {
        violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('positive net without a live voucher'), expected: p.net, actual: '0' });
      }
      continue;
    }
    if (differs(p.payable, p.net)) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('wages payable credit differs from the net'), expected: p.net, actual: p.payable });
    }
    if (differs(p.advance_credit, p.advance) || differs(p.deductions_credit, p.deductions)) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('advance or deductions credit differs from the payslip'),
        expected: `${p.advance} / ${p.deductions}`, actual: `${p.advance_credit} / ${p.deductions_credit}` });
    }
  }
  return violations;
}
