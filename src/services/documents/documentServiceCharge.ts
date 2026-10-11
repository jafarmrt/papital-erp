import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';
import { VAT_DOC_TYPES } from './documentVat.js';

/**
 * v7.0.103 (TD-191): هزینه ارسال و خدمات فقط روی فاکتور فروش و نامنفی است.
 * v10.0.250 (TD-1136): یک قاعده برای ثبت و ویرایش؛ فرم فاکتور دستی هم آن را می‌فرستد. در ویرایش، مقدار نفرستاده همان
 * مقدار ذخیره‌شده می‌ماند.
 */
export function resolveServiceCharge(
  docType: string,
  input: DecimalValue,
  existing: DecimalValue = 0,
): FinancialDecimal {
  const amount = fin(input ?? existing ?? 0);
  if (amount.isZero()) return amount;
  if (!VAT_DOC_TYPES.has(docType)) {
    throw new ValidationError('هزینه ارسال و خدمات فقط روی فاکتور فروش ثبت می‌شود.', undefined, 'SERVICE_CHARGE_NOT_ALLOWED');
  }
  if (amount.isNegative()) {
    throw new ValidationError(`هزینه ارسال و خدمات نمی‌تواند منفی باشد (مقدار دریافتی: ${amount.toString()}).`, undefined, 'SERVICE_CHARGE_NEGATIVE');
  }
  return amount;
}
