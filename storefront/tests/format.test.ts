import { describe, expect, it } from 'vitest';
import { faDigits, formatPrice, tomanDigits, priceUnit } from '../app/lib/format';
import { whatsappLink } from '../app/lib/whatsapp';
import { parsePage, parseSort } from '../app/lib/catalog';

describe('storefront price display', () => {
  it('shows a rial price in toman with Persian digits and the Persian thousands separator', () => {
    expect(formatPrice('14500000')).toBe('۱٬۴۵۰٬۰۰۰ تومان');
    expect(tomanDigits('14500000')).toBe('۱٬۴۵۰٬۰۰۰');
    expect(priceUnit('14500000')).toBe('تومان');
  });

  it('keeps a price that is not whole toman in rial, and never rounds a large amount through a JS number', () => {
    expect(formatPrice('14500005')).toBe('۱۴٬۵۰۰٬۰۰۵ ریال');
    expect(formatPrice('90071992547409930')).toBe('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ تومان');
  });

  it('shows nothing for a value that is not a rial amount', () => {
    expect(formatPrice('')).toBe('');
    expect(formatPrice('12.5')).toBe('');
  });

  it('turns every Latin digit Persian', () => {
    expect(faDigits('30 × 20')).toBe('۳۰ × ۲۰');
  });
});

describe('storefront links and query values', () => {
  it('builds a wa.me link from the stored number and keeps the text encoded', () => {
    expect(whatsappLink('989121234567', 'سلام')).toBe(`https://wa.me/989121234567?text=${encodeURIComponent('سلام')}`);
  });

  it('falls back to the first page and the default order for anything unexpected', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('-1')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parseSort('price_asc')).toBe('price_asc');
    expect(parseSort('cost')).toBe('default');
  });
});
