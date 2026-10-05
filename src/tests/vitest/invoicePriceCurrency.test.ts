import { describe, expect, it } from 'vitest';
import { currencyChangeError, pricesForCurrency } from '../../lib/invoices/invoiceLine';

// v8.0.107 (TD-384): قیمت فهرست قیمتِ ارز دیگر قیمت فاکتور نمی‌شود و ارز فاکتور دارای ردیف عوض نمی‌شود
const prices = [
  { id: 1, title: 'عمده', price: 1_500_000, currency: 'IRR' },
  { id: 2, title: 'صادراتی', price: 50, currency: 'USD' },
  { id: 3, title: 'قدیمی', price: 900_000, currency: null },
  { id: 4, title: 'بی‌قیمت', price: 0, currency: 'IRR' },
];

describe('price list prices by invoice currency (TD-384)', () => {
  it('offers only positive prices of the invoice currency (missing currency = IRR)', () => {
    expect(pricesForCurrency(prices, 'IRR').map(p => p.id)).toEqual([1, 3]);
    expect(pricesForCurrency(prices, 'usd').map(p => p.id)).toEqual([2]);
    expect(pricesForCurrency(prices, 'EUR')).toEqual([]);
    expect(pricesForCurrency(undefined, 'IRR')).toEqual([]);
  });

  it('refuses to change the currency of an invoice that has lines', () => {
    expect(currencyChangeError(2, 'IRR', 'USD')).not.toBeNull();
    expect(currencyChangeError(0, 'IRR', 'USD')).toBeNull();
    expect(currencyChangeError(2, 'USD', 'USD')).toBeNull();
  });
});
