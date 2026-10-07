import { describe, expect, it } from 'vitest';
import { formatPersianNumber, formatPersianPrice, parseCleanNumber, toPersianDigits } from '../../utils';

describe('TD-687 displayed numbers use the Persian separators (vibefarsi numbers rule)', () => {
  it('thousands separator is U+066C and the decimal separator is U+066B', () => {
    expect(formatPersianPrice(25000000)).toBe('۲۵٬۰۰۰٬۰۰۰');
    expect(formatPersianPrice(12.5, 'USD')).toBe('۱۲٫۵ دلار');
    expect(formatPersianNumber(1250000.75)).toBe('۱٬۲۵۰٬۰۰۰٫۷۵');
    expect(toPersianDigits(12.5)).toBe('۱۲٫۵');
  });

  it('no Latin comma or point is left in a formatted amount', () => {
    for (const shown of [formatPersianPrice(1234567.25, 'EUR'), formatPersianNumber('9876543.5', 2), formatPersianNumber(0.125, 3)]) {
      expect(shown).not.toMatch(/[,.]/);
    }
  });

  it('an amount copied from the screen is read back exactly', () => {
    expect(parseCleanNumber(formatPersianNumber(1250000.75))).toBe(1250000.75);
    expect(parseCleanNumber(formatPersianPrice(25000000))).toBe(25000000);
  });

  it('codes with leading zeros and dates keep their text', () => {
    expect(toPersianDigits('0912')).toBe('۰۹۱۲');
    expect(formatPersianNumber('1404/07/15')).toBe('۱۴۰۴/۰۷/۱۵');
  });
});
