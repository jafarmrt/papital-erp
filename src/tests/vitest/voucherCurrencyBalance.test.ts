import { describe, expect, it } from 'vitest';
import { computeVoucherCurrencyBalance, voucherRowCurrency, voucherRowRate } from '../../lib/accounting/voucherCurrencyBalance';

// v9.0.153 (TD-551, B03-09, decision t7): the currency, rate and balance of manual voucher rows, shared by the server and the form.
describe('manual voucher currency balance (TD-551)', () => {
  it('a row takes its own currency, else the voucher currency, else IRR; empty and «ریال» are IRR', () => {
    expect(voucherRowCurrency('usd', 'EUR')).toBe('USD');
    expect(voucherRowCurrency('', 'EUR')).toBe('EUR');
    expect(voucherRowCurrency(undefined, undefined)).toBe('IRR');
    expect(voucherRowCurrency('ریال', 'USD')).toBe('IRR');
  });

  it('a rial row has rate 1; a foreign row needs a positive rate', () => {
    expect(voucherRowRate('IRR', undefined)?.toNumber()).toBe(1);
    expect(voucherRowRate('USD', undefined)).toBeNull();
    expect(voucherRowRate('USD', 0)).toBeNull();
    expect(voucherRowRate('USD', '۶۰۰۰۰۰')?.toNumber()).toBe(600000);
  });

  it('100 USD without a rate against 100 IRR is not balanced and names the row', () => {
    const b = computeVoucherCurrencyBalance([{ debit: 100, credit: 0, currency: 'USD' }, { debit: 0, credit: 100, currency: 'IRR' }]);
    expect(b.isBalanced).toBe(false);
    expect(b.rowsWithoutRate).toEqual([1]);
  });

  it('a multi-currency voucher is balanced in rials at each row rate, rounded to the rial', () => {
    const b = computeVoucherCurrencyBalance([
      { debit: 100, credit: 0, currency: 'USD', exchangeRate: 600000 },
      { debit: 0, credit: 60_000_000, currency: 'IRR' },
    ]);
    expect(b).toMatchObject({ inRial: true, currency: 'IRR', totalDebit: 60_000_000, totalCredit: 60_000_000, isBalanced: true });
    const off = computeVoucherCurrencyBalance([
      { debit: 100, credit: 0, currency: 'USD', exchangeRate: 600000 },
      { debit: 0, credit: 100, currency: 'IRR' },
    ]);
    expect(off.isBalanced).toBe(false);
    expect(off.difference).toBe(59_999_900);
  });

  it('one currency at one rate balances on its own amounts; one currency at two rates balances in rials', () => {
    const single = computeVoucherCurrencyBalance([
      { debit: 10.01, credit: 0, exchangeRate: 600000.5 },
      { debit: 0, credit: 10.01, exchangeRate: 600000.5 },
    ], 'USD');
    expect(single).toMatchObject({ inRial: false, currency: 'USD', totalDebit: 10.01, isBalanced: true });
    const twoRates = computeVoucherCurrencyBalance([
      { debit: 100, credit: 0, currency: 'USD', exchangeRate: 600000 },
      { debit: 0, credit: 100, currency: 'USD', exchangeRate: 590000 },
    ]);
    expect(twoRates.inRial).toBe(true);
    expect(twoRates.isBalanced).toBe(false);
    expect(twoRates.difference).toBe(1_000_000);
  });
});
