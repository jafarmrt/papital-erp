import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPayrollBankCurrency } from '../../lib/payroll/payrollCurrency';

// review of #294: the payment window offered a bank stored as «ریال» (isRialCurrency) that the server then refused, since
// the server took only an empty currency or IRR; both now read one rule
const RIAL_WORD = 'ریال';

describe('payroll_bank_currency_rule_v10_1_66', () => {
  it('takes only an empty currency or IRR', () => {
    expect(isPayrollBankCurrency('IRR')).toBe(true);
    expect(isPayrollBankCurrency('')).toBe(true);
    expect(isPayrollBankCurrency(null)).toBe(true);
    for (const other of [RIAL_WORD, 'USD', 'irr']) expect(isPayrollBankCurrency(other)).toBe(false);
  });

  it('is the rule of the server refusal and of the payment window', () => {
    expect(readFileSync('src/services/accounting/payrollPayment.service.ts', 'utf8')).toContain('!isPayrollBankCurrency(bank.currency)');
    const modal = readFileSync('src/components/piecework/PayrollPaymentModal.tsx', 'utf8');
    expect(modal).toContain('isPayrollBankCurrency(b.currency)');
    expect(modal).not.toContain('isRialCurrency');
  });
});
