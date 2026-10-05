import { describe, expect, it } from 'vitest';
import { customerSaveBody, excelRowVersion } from '../../lib/customers/customerVersion';

// v8.0.122 (TD-403): فرم ویرایش طرف حساب نسخه رکورد را می‌فرستد (سرور ویرایش بی نسخه را ۴۰۰ و نسخه کهنه را ۴۰۹ می‌دهد)
// و ستون «نسخه» فایل اکسل خوانده می‌شود.
describe('customer optimistic version in the browser (TD-403)', () => {
  it('an edit carries the version the form was built from; a new customer does not', () => {
    expect(customerSaveBody({ name: 'الف' }, 12, 3)).toEqual({ name: 'الف', version: 3 });
    expect(customerSaveBody({ name: 'الف' }, null, undefined)).toEqual({ name: 'الف' });
  });

  it('reads the Excel version column', () => {
    expect(excelRowVersion('4')).toBe(4);
    expect(excelRowVersion(' 7 ')).toBe(7);
    expect(excelRowVersion('')).toBeUndefined();
    expect(excelRowVersion('abc')).toBeUndefined();
    expect(excelRowVersion('0')).toBeUndefined();
  });
});
