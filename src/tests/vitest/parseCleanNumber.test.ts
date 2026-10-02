import { describe, expect, it } from 'vitest';
import { parseCleanNumber } from '../../utils/persianNumber';

describe('parseCleanNumber', () => {
  it('reads Persian and Arabic digits with thousand separators', () => {
    expect(parseCleanNumber('۱,۲۳۴,۵۶۷')).toBe(1234567);
    expect(parseCleanNumber('١٢٣٤')).toBe(1234);
    expect(parseCleanNumber(' 12,500.75 ')).toBe(12500.75);
  });

  it('keeps the sign and decimal part', () => {
    expect(parseCleanNumber('-۲۵۰.۵')).toBe(-250.5);
    expect(parseCleanNumber('0.1')).toBe(0.1);
  });

  it('falls back to the default for empty, invalid and non-finite input', () => {
    expect(parseCleanNumber('', 7)).toBe(7);
    expect(parseCleanNumber('-', 7)).toBe(7);
    expect(parseCleanNumber('abc', 7)).toBe(7);
    expect(parseCleanNumber(null, 7)).toBe(7);
    expect(parseCleanNumber(undefined)).toBe(0);
    expect(parseCleanNumber({ value: 1 }, 7)).toBe(7);
    expect(parseCleanNumber(Number.NaN, 7)).toBe(7);
    expect(parseCleanNumber(Number.POSITIVE_INFINITY, 7)).toBe(7);
  });
});
