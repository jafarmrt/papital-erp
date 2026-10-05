import { describe, expect, it } from 'vitest';
import { lineDiscountError } from '../../lib/invoices/invoiceLine';
import { assertLineDiscountsWithinAmount } from '../../services/documents/lineDiscount';

describe('line discount within the line amount (TD-380)', () => {
  it('the invoice form refuses a discount larger than quantity × unit price', () => {
    expect(lineDiscountError(1, 1000, 3000)).not.toBeNull();
    expect(lineDiscountError(0.5, 15, 7.6)).not.toBeNull();
    expect(lineDiscountError(1, 1000, 1000)).toBeNull();
    expect(lineDiscountError(0.7, 15, 10.5)).toBeNull(); // 0.7 × 15 = 10.5 exactly, not 10.499…
    expect(lineDiscountError(2, 0, 0)).toBeNull();
  });

  it('the server applies the same rule to every line', () => {
    expect(() => assertLineDiscountsWithinAmount([{ quantity: 1, unit_price: 1000, discount: 3000 }])).toThrow(/ردیف 1/);
    expect(() => assertLineDiscountsWithinAmount([
      { quantity: 1, unitPrice: 5000, discount: 0 },
      { quantity: 2, price: 100, discount: '201' },
    ])).toThrow(/ردیف 2/);
    expect(() => assertLineDiscountsWithinAmount([{ quantity: 0.7, unitPrice: 15, discount: 10.5 }])).not.toThrow();
    expect(() => assertLineDiscountsWithinAmount(undefined)).not.toThrow();
  });
});
