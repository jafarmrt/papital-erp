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
