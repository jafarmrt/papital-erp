import { describe, expect, it } from 'vitest';
import { currencySettingError, movementDaysError, resolveMovementDays } from '../../lib/settings/settingValues';

// Package 16 (TD-672 / B16-08, decision t4): movement days are integers 1..3650 with fast < slow < dead, the currency
// setting is only IRR or TOMAN, and the dashboard falls back to the defaults on a stored invalid value.
describe('TD-672 settings values (decision t4)', () => {
  it('currency is only IRR or TOMAN', () => {
    expect(currencySettingError('IRR')).toBeNull();
    expect(currencySettingError('TOMAN')).toBeNull();
    expect(currencySettingError('USD')).not.toBeNull();
    expect(currencySettingError('ریال؟')).not.toBeNull();
  });

  it('movement days are integers 1..3650 with fast < slow < dead', () => {
    const ok = { fast_moving_days: '30', slow_moving_days: '۹۰', dead_stock_days: 180 };
    expect(movementDaysError(ok)).toBeNull();
    for (const fast of ['', 'abc', '-30', '0', '12.5', '3651']) {
      expect(movementDaysError({ ...ok, fast_moving_days: fast })).toContain('تند گردش');
    }
    expect(movementDaysError({ ...ok, fast_moving_days: '90' })).toContain('ترتیب');
  });

  it('the dashboard falls back to the defaults when a stored value is invalid', () => {
    expect(resolveMovementDays({ fast_moving_days: 'abc', slow_moving_days: '90', dead_stock_days: '180' }))
      .toEqual({ fastDays: 30, slowDays: 90, deadDays: 180, usedDefaults: true });
    expect(resolveMovementDays({ fast_moving_days: '15', slow_moving_days: '60', dead_stock_days: '120' }))
      .toEqual({ fastDays: 15, slowDays: 60, deadDays: 120, usedDefaults: false });
  });
});
