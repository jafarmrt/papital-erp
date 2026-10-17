import { fin, type DecimalValue } from '../financialDecimal.js';
import { formatPersianPrice } from '../../utils/persianNumber.js';

/**
 * OBS-R2-51: a payslip is rial only (its amounts, the advance account and every payment, which refuses a bank in another
 * currency), so its messages name the currency through this constant and `formatCurrencyLabel`, never a hand-written «ریال».
 */
export const PAYROLL_CURRENCY = 'IRR';

/** A payroll amount in Persian digits with its currency label, e.g. «۱۲٬۰۰۰ ریال» */
export function payrollAmountText(amount: DecimalValue, currency: string | null | undefined = PAYROLL_CURRENCY): string {
  return formatPersianPrice(fin(amount).toString(), currency || PAYROLL_CURRENCY, 4);
}

/**
 * v10.1.66: the treasury accounts a payslip may be paid from, one rule for the server's refusal and the payment window's
 * list: an account without a currency or in IRR (the stored code of a rial account), never another code, «ریال» included.
 */
export function isPayrollBankCurrency(currency: string | null | undefined): boolean {
  return !currency || currency === PAYROLL_CURRENCY;
}
