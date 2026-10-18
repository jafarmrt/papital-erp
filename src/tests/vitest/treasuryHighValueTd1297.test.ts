/**
 * 10.2 package 8 (TD-1297, review M-3): the treasury event carries `isHighValue` instead of its amount. The threshold
 * «آستانه تراکنش کلان خزانه» is a whole rial amount above zero (Persian digits and separators read), 500,000,000 by
 * default; a foreign row counts at its own rate, and one without a rate is never high value.
 */
import { describe, expect, it } from 'vitest';
import {
  TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT, readTreasuryHighValueThreshold, resolveTreasuryHighValueThreshold, treasuryHighValueThresholdError,
} from '../../lib/settings/settingValues';
import { isHighValueAmount } from '../../services/accounting/treasury/treasuryHighValue';

describe('treasury_high_value_td_1297', () => {
  it('reads the threshold as a whole rial amount above zero', () => {
    expect(readTreasuryHighValueThreshold('۵۰۰٬۰۰۰٬۰۰۰')).toBe(500_000_000);
    expect(readTreasuryHighValueThreshold('1000')).toBe(1000);
    for (const bad of ['0', '-5', '12.5', 'abc', '']) expect(readTreasuryHighValueThreshold(bad)).toBeNull();
    expect(treasuryHighValueThresholdError('0')).toContain('آستانه تراکنش کلان خزانه');
    expect(resolveTreasuryHighValueThreshold(undefined)).toBe(TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT);
    expect(resolveTreasuryHighValueThreshold('bad')).toBe(500_000_000);
  });

  it('flags a row by its rial value', () => {
    expect(isHighValueAmount(500_000_000, 'IRR', 1, 500_000_000)).toBe(true);
    expect(isHighValueAmount(499_999_999, 'IRR', 1, 500_000_000)).toBe(false);
    expect(isHighValueAmount(1000, 'USD', 600_000, 500_000_000)).toBe(true);
    expect(isHighValueAmount(1000, 'USD', 0, 500_000_000)).toBe(false);
    expect(isHighValueAmount(600_000_000, '', null, 500_000_000)).toBe(true);
  });
});
