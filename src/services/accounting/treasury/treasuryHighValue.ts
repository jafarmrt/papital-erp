import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { appSettings } from '../../../db/schema.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { TREASURY_HIGH_VALUE_THRESHOLD_KEY, resolveTreasuryHighValueThreshold } from '../../../lib/settings/settingValues.js';

/**
 * 10.2 package 8 (TD-1297, review M-3): the treasury event carries no amount, only `isHighValue`: the row's rial value
 * (its amount, times its own exchange rate when it is not in rials) at or above «آستانه تراکنش کلان خزانه»
 * (`treasury_high_value_threshold`, default 500,000,000 rials), read with the write's own `tx`. A foreign row without a
 * positive rate is not high value. A payslip payment and its void carry no such flag (their events carry nothing derived
 * from the amount, TD-1243 rule).
 */
export async function treasuryHighValueThreshold(tx: DbExecutor): Promise<number> {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, TREASURY_HIGH_VALUE_THRESHOLD_KEY));
  return resolveTreasuryHighValueThreshold(row?.value);
}

export function isHighValueAmount(
  amount: FinancialDecimal | number | string,
  currency: string | null | undefined,
  exchangeRate: FinancialDecimal | number | string | null | undefined,
  threshold: number,
): boolean {
  const code = String(currency ?? '').trim().toUpperCase();
  const isRial = code === '' || code === 'IRR';
  const rate = isRial ? fin(1) : fin(exchangeRate ?? 0);
  if (!rate.isPositive()) return false;
  return fin(amount).multiply(rate).greaterThanOrEqual(threshold);
}

export async function treasuryRowIsHighValue(
  tx: DbExecutor,
  row: { amount: FinancialDecimal | number | string; currency: string | null; exchangeRate: FinancialDecimal | number | string | null },
): Promise<boolean> {
  return isHighValueAmount(row.amount, row.currency, row.exchangeRate, await treasuryHighValueThreshold(tx));
}
