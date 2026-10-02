import { customType } from 'drizzle-orm/pg-core';
import { Money, moneyToDriver } from '../../lib/money.js';

/**
 * v7.0.67 (P2-6 / TD-210): ستون مبلغ numeric(18,4) که مقدارش در سرور Money (Decimal) است، نه double.
 * نوع پایگاه‌داده تغییر نمی‌کند (مهاجرت لازم نیست)؛ فقط نگاشت درایور عوض می‌شود.
 */
export const moneyNumeric = customType<{ data: Money; driverData: string; config: { precision?: number; scale?: number } }>({
  dataType(config) {
    return `numeric(${config?.precision ?? 18}, ${config?.scale ?? 4})`;
  },
  fromDriver(value: string): Money {
    return new Money(value);
  },
  toDriver(value: Money): string {
    return moneyToDriver(value);
  },
});
