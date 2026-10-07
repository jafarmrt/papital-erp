import { describe, expect, it } from 'vitest';
import { formatPersianNumber, formatPersianPrice, formatQuantityOrTime, toEnglishDigits } from '../../utils';

/** ارقام لاتین و جداکننده‌های لاتین، تا آزمون به نویسه جداکننده (TD-687) وابسته نباشد */
const latin = (s: string) => toEnglishDigits(s).replace(/٫/g, '.').replace(/٬/g, ',');

describe('TD-678 number formatting keeps the requested decimals below 1,000', () => {
  it('formatPersianNumber keeps four decimals for small numbers as it does for large ones', () => {
    expect(latin(formatPersianNumber(12.3456, 4))).toBe('12.3456');
    expect(latin(formatPersianNumber(1234.3456, 4))).toBe('1,234.3456');
    expect(latin(formatPersianNumber('0.125', 3))).toBe('0.125');
  });

  it('quantities and hours with four decimals are not rounded to two', () => {
    expect(latin(formatQuantityOrTime(0.125))).toBe('0.125');
    expect(latin(formatQuantityOrTime(2.0005))).toBe('2.0005');
  });

  it('a price with requested decimals keeps them below 1,000', () => {
    expect(latin(formatPersianPrice(12.345, undefined, 3))).toBe('12.345');
  });
});
