import { describe, expect, it } from 'vitest';
import { fin } from '../../lib/financialDecimal';
import { currencyScale, exactLineSplit } from '../../services/woocommerce/exactLineTotal';

const shape = (total: string, qty: number, scale: number) =>
  exactLineSplit(fin(total), qty, scale).map(p => `${p.quantity}×${p.unitPrice.toString()}`).join('|');

// v8.0.41 (TD-297): جمع ردیف سفارش ووکامرس دقیق و فی بی‌کسرِ کوچک‌ترین واحد ارز
describe('WooCommerce exact line split (TD-297)', () => {
  it('splits a rial line that is not divisible by its quantity into n-1 units and one remainder unit', () => {
    expect(shape('1000', 3, 0)).toBe('2×333|1×334');
    expect(shape('100000', 7, 0)).toBe('6×14285|1×14290');
  });

  it('keeps a divisible line as one line', () => {
    expect(shape('1000', 4, 0)).toBe('4×250');
    expect(shape('999', 1, 0)).toBe('1×999');
  });

  it('works in cents for a foreign currency and keeps fractional quantities as they were', () => {
    expect(currencyScale('USD')).toBe(2);
    expect(shape('100', 3, 2)).toBe('2×33.33|1×33.34');
    expect(shape('10', 2.5, 0)).toBe('2.5×4');
  });

  it('always sums to the line total', () => {
    for (const [total, qty] of [['1001', 7], ['5', 3], ['123456789', 11], ['1', 2]] as const) {
      const sum = exactLineSplit(fin(total), qty, 0).reduce((s, p) => s.add(p.unitPrice.multiply(p.quantity)), fin(0));
      expect(sum.toString()).toBe(fin(total).toString());
    }
  });
});
