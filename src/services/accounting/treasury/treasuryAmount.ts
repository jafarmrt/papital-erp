import { ValidationError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';

/**
 * v11 phase 6.1a (M16): the treasury and cheque services still carry an amount as a JS number. An amount whose digits a
 * number cannot hold exactly (more than about 15 significant digits, «12345678901234.5678») is refused with a 422 instead
 * of being stored changed (it was saved as «…234.5680»). An empty or invalid amount is 0, as before, so the callers'
 * «greater than zero» message still answers it.
 */
export function exactTreasuryAmount(value: DecimalValue, label: string): number {
  const amount = Number(value) || 0;
  if (amount !== 0 && !fin(amount).equals(fin(value))) {
    throw new ValidationError(`${label} بیش از دقتی است که ثبت می‌شود؛ رقم‌های اعشار را کم کنید.`, { field: label, value: String(value) }, 'AMOUNT_PRECISION_EXCEEDED');
  }
  return amount;
}
