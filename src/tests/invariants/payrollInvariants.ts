import { fin } from '../../lib/financialDecimal.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import type { InvariantViolation } from './businessInvariants.js';
import { rows } from './ledgerRows.js';

/**
 * v9.0.266 (TD-804, B12P-01) — payroll invariant I10 (V8_MASTER_ROADMAP.md §4), read-only SQL over the live payslips
 * with an id above the watermark:
 * - bonuses, deductions and advance deduction are never negative;
 * - a payslip with a positive net has a live voucher (linked by `source_payroll_id`);
 * - its voucher credits «wages payable» (mapped 3201) with exactly the net, and the advance (mapped 1301) and other
 *   deductions (mapped 3205 since v9.0.286, TD-554) accounts with exactly the advance deduction and the other deductions;
 * - v10.0.210 (TD-1087): the net equals gross − employee insurance − income tax − other deductions − advance, and the
 *   voucher credits insurance payable (mapped 3204) with the employee plus the employer share, debits the employer
 *   insurance expense (mapped 7013) with the employer share and credits payroll tax payable (mapped 3206) with the tax.
 * - v10.0.222 (TD-1089): an eidi payslip's gross is its eidi amount; a regular payslip's voucher credits eidi payable
 *   (mapped 3207) with its eidi share and an eidi payslip's voucher debits it with the part taken from the accrual.
 */
export async function checkPayrollInvariants(payrollIdAfter: number | undefined): Promise<InvariantViolation[]> {
  if (payrollIdAfter === undefined) return [];
  const [payable, advance, deductions, insurance, employerExpense, tax, eidiPayable] = await Promise.all([
    AccountMappingService.getWagesPayableAccount(),
    AccountMappingService.getEmployeeAdvanceAccount(),
    AccountMappingService.getEmployeeDeductionsPayableAccount(),
    AccountMappingService.getInsurancePayableAccount(),
    AccountMappingService.getEmployerInsuranceExpenseAccount(),
    AccountMappingService.getPayrollTaxPayableAccount(),
    AccountMappingService.getEidiPayableAccount(),
  ]);
  const accountCredit = (accountId: number | undefined) => `COALESCE((SELECT SUM(i.credit - i.debit) FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_payroll_id = p.id AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = ${Number(accountId ?? 0)}
        AND i.detailed_type = 'personnel' AND i.detailed_id = p.personnel_id), 0)::text`;
  const payslips = await rows<{
    id: number; payroll_number: string; net: string; bonuses: string; deductions: string; advance: string;
    has_voucher: boolean; payable: string; advance_credit: string; deductions_credit: string;
    gross: string; employee_insurance: string; employer_insurance: string; income_tax: string;
    insurance_credit: string; employer_expense_credit: string; tax_credit: string; eidi_expected: string; eidi_credit: string;
  }>(
    `SELECT p.id, p.payroll_number, COALESCE(p.net_payable, 0)::text AS net, COALESCE(p.total_bonuses, 0)::text AS bonuses,
            COALESCE(p.total_deductions, 0)::text AS deductions, COALESCE(p.advance_deduction, 0)::text AS advance,
            EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.source_payroll_id = p.id AND v.is_deleted = 0) AS has_voucher,
            ${accountCredit(payable?.id)} AS payable,
            ${accountCredit(advance?.id)} AS advance_credit,
            ${accountCredit(deductions?.id)} AS deductions_credit,
            (COALESCE(p.total_piecework_amount, 0) + COALESCE(p.total_fixed_amount, 0) + COALESCE(p.total_bonuses, 0)
              + CASE WHEN p.is_eidi = 1 THEN p.eidi_amount ELSE 0 END)::text AS gross,
            (CASE WHEN p.is_eidi = 1 THEN -p.eidi_from_accrual ELSE p.eidi_amount END)::text AS eidi_expected,
            ${accountCredit(eidiPayable?.id)} AS eidi_credit,
            p.employee_insurance::text AS employee_insurance, p.employer_insurance::text AS employer_insurance, p.income_tax::text AS income_tax,
            ${accountCredit(insurance?.id)} AS insurance_credit,
            ${accountCredit(employerExpense?.id)} AS employer_expense_credit,
            ${accountCredit(tax?.id)} AS tax_credit
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
    if (fin(p.bonuses).isNegative() || fin(p.deductions).isNegative() || fin(p.advance).isNegative()
      || fin(p.employee_insurance).isNegative() || fin(p.employer_insurance).isNegative() || fin(p.income_tax).isNegative()) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('negative bonuses, deductions or advance deduction'),
        expected: '>= 0', actual: `${p.bonuses} / ${p.deductions} / ${p.advance}` });
      continue;
    }
    const expectedNet = fin(p.gross).subtract(p.employee_insurance).subtract(p.income_tax).subtract(p.deductions).subtract(p.advance).toString();
    if (differs(p.net, expectedNet)) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('net differs from gross less insurance, tax, deductions and advance'), expected: expectedNet, actual: p.net });
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
    const insuranceExpected = fin(p.employee_insurance).add(p.employer_insurance).toString();
    const employerExpected = fin(p.employer_insurance).negate().toString();
    if (differs(p.insurance_credit, insuranceExpected) || differs(p.employer_expense_credit, employerExpected) || differs(p.tax_credit, p.income_tax)) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('insurance or tax rows differ from the payslip'),
        expected: `${insuranceExpected} / ${employerExpected} / ${p.income_tax}`, actual: `${p.insurance_credit} / ${p.employer_expense_credit} / ${p.tax_credit}` });
    }
    if (differs(p.eidi_credit, p.eidi_expected)) {
      violations.push({ invariant: 'I10_payroll_net_equals_payable', key, message: message('eidi payable row differs from the payslip'), expected: p.eidi_expected, actual: p.eidi_credit });
    }
  }
  return violations;
}
