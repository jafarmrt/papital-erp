import { describe, expect, it } from 'vitest';
import { discountAmountOf, normalizeDiscountCode, spreadDiscount } from '../../lib/storefront/storefrontDiscountRules';

/** v11 phase 8.2c: the rules of a site discount code (no database) */
describe('storefront discount rules', () => {
  it('normalizes a typed code: Persian digits, spaces and lower case', () => {
    expect(normalizeDiscountCode(' yalda ۱۴۰۵ ')).toBe('YALDA1405');
    expect(normalizeDiscountCode('ab')).toBe('');
    expect(normalizeDiscountCode('-ABC')).toBe('');
    expect(normalizeDiscountCode('یلدا')).toBe('');
    expect(normalizeDiscountCode(null)).toBe('');
  });

  it('takes a percent in whole tomans, held to its cap, and an amount as it is', () => {
    const percent = { kind: 'percent' as const, percent: 10, amount: '0', maxDiscount: '0' };
    expect(discountAmountOf(percent, '12345678')).toBe(1234560n);
    expect(discountAmountOf({ ...percent, maxDiscount: '500000' }, '12345678')).toBe(500000n);
    expect(discountAmountOf({ kind: 'amount', percent: 0, amount: '2000000', maxDiscount: '0' }, '25000000')).toBe(2000000n);
  });

  it('never makes an order free', () => {
    expect(discountAmountOf({ kind: 'amount', percent: 0, amount: '9000000', maxDiscount: '0' }, '5000000')).toBe(4999999n);
    expect(discountAmountOf({ kind: 'percent', percent: 90, amount: '0', maxDiscount: '0' }, '0')).toBe(0n);
  });

  it('spreads a discount over the lines in proportion, adding up exactly', () => {
    const shares = spreadDiscount([1000n, 2000n, 3001n], 1001n);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1001n);
    expect(shares).toEqual([166n, 334n, 501n]);
    expect(spreadDiscount([500n], 499n)).toEqual([499n]);
    expect(spreadDiscount([1n, 1n, 1n], 2n)).toEqual([1n, 1n, 0n]);
    expect(spreadDiscount([100n, 200n], 0n)).toEqual([0n, 0n]);
  });
});
