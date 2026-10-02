import { describe, expect, it } from 'vitest';
import { computeVoucherBalance, VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance';

describe('computeVoucherBalance (voucher forms)', () => {
  it('treats 0.1 + 0.2 debit against 0.3 credit as balanced (no floating-point drift)', () => {
    // JS: 0.1 + 0.2 = 0.30000000000000004; the new-voucher form compared the difference with === 0
    const b = computeVoucherBalance([
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
      { debit: 0, credit: 0.3 },
    ]);
    expect(b.totalDebit).toBe(0.3);
    expect(b.difference).toBe(0);
    expect(b.isBalanced).toBe(true);
  });

  it('uses the server tolerance of 0.01', () => {
    expect(VOUCHER_BALANCE_TOLERANCE).toBe(0.01);
    expect(computeVoucherBalance([{ debit: 100.005, credit: 0 }, { debit: 0, credit: 100 }]).isBalanced).toBe(true);
    expect(computeVoucherBalance([{ debit: 100.01, credit: 0 }, { debit: 0, credit: 100 }]).isBalanced).toBe(false);
  });

  it('reports the exact surplus used by the balancing row', () => {
    const b = computeVoucherBalance([{ debit: 1000.3, credit: 0 }, { debit: 0, credit: 400.1 }]);
    expect(b.debitSurplus).toBe(600.2);
    expect(b.difference).toBe(600.2);
    expect(b.isBalanced).toBe(false);
    expect(computeVoucherBalance([{ debit: 0, credit: 50 }]).debitSurplus).toBe(-50);
  });

  it('accepts form strings with Persian digits and treats empty rows as zero', () => {
    const b = computeVoucherBalance([{ debit: '۱,۰۰۰', credit: '' }, { debit: undefined, credit: '1000' }]);
    expect(b.totalDebit).toBe(1000);
    expect(b.isBalanced).toBe(true);
  });

  it('never calls an empty or all-zero voucher balanced', () => {
    expect(computeVoucherBalance([]).isBalanced).toBe(false);
    expect(computeVoucherBalance(null).isBalanced).toBe(false);
    expect(computeVoucherBalance([{ debit: 0, credit: 0 }]).isBalanced).toBe(false);
  });
});
