import { describe, expect, it } from 'vitest';
import { fin } from '../../lib/financialDecimal';
import { allocateFeeDiscount } from '../../services/woocommerce/feeDiscount';

const shares = (amounts: number[], discount: number, scale = 0) =>
  allocateFeeDiscount(amounts.map(a => fin(a)), fin(discount), scale)?.map(s => s.toString()).join('|') ?? null;

// v8.0.42 (TD-295، تصمیم مالک محصول — گزینه الف): تخفیف کارمزدی به نسبت مبلغ سطرها
describe('WooCommerce fee discount allocation (TD-295)', () => {
  it('splits the discount by line amount', () => {
    expect(shares([1000, 3000], 400)).toBe('100|300');
    expect(shares([2000], 20)).toBe('20');
  });

  it('gives the rounding remainder to the larger lines and always sums to the discount', () => {
    expect(shares([1000, 2000], 100)).toBe('33|67');
    expect(shares([1, 1, 1], 2)).toBe('1|1|0');
    expect(shares([10, 20], 1, 2)).toBe('0.33|0.67');
  });

  it('refuses a discount larger than the lines and ignores a zero discount', () => {
    expect(shares([500], 600)).toBeNull();
    expect(shares([500, 300], 0)).toBe('0|0');
  });
});
