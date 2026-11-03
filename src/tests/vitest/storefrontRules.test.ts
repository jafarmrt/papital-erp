// @vitest-environment node
/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the storefront rules shared by the server, the ERP tab and
 * the site app: the card and IBAN checks, the addresses, the rial amounts, the stock status and the shipping quote.
 */
import { describe, expect, it } from 'vitest';
import {
  cardNumberError, ibanError, isProvince, maxOrderQuantity, normalizeIban, rialAmountText, shippingCodeError, shippingQuote,
  slugError, stockStatusOf, suggestedSlug, type ShippingMethodRule,
} from '../../lib/storefront/storefrontRules';
import { sitePrice } from '../../services/storefront/storefrontItemData';

describe('storefront payment details', () => {
  it('accepts a 16-digit card with a valid check digit, in Persian digits and with separators', () => {
    expect(cardNumberError('6037991234567893')).toBeNull();
    expect(cardNumberError('۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳')).toBeNull();
    expect(cardNumberError('')).toBeNull();
  });

  it('refuses a card of another length or a wrong check digit', () => {
    expect(cardNumberError('603799123456789')).toContain('۱۶ رقم');
    expect(cardNumberError('6037991234567894')).toContain('درست نیست');
  });

  it('checks an Iranian IBAN with or without IR and reads it upper-case', () => {
    expect(ibanError('IR050170000000123456789012')).toBeNull();
    expect(ibanError('050170000000123456789012')).toBeNull();
    expect(normalizeIban('ir05 0170 0000 0012 3456 7890 12')).toBe('IR050170000000123456789012');
    expect(ibanError('IR060170000000123456789012')).toContain('درست نیست');
    expect(ibanError('IR0501700000001234')).toContain('۲۴ رقم');
    expect(ibanError('')).toBeNull();
  });
});

describe('storefront addresses and amounts', () => {
  it('takes lower-case latin words joined by single hyphens', () => {
    expect(slugError('yalda-box-2026')).toBeNull();
    expect(slugError('')).not.toBeNull();
    expect(slugError('Yalda')).not.toBeNull();
    expect(slugError('yalda--box')).not.toBeNull();
    expect(slugError('-yalda')).not.toBeNull();
    expect(slugError('a'.repeat(121))).not.toBeNull();
    expect(shippingCodeError('snapp-box')).toBeNull();
    expect(shippingCodeError('Snapp Box')).not.toBeNull();
  });

  it('suggests an address from the item code', () => {
    expect(suggestedSlug('PG-۱۲۳ / A')).toBe('pg-123-a');
    expect(suggestedSlug('---')).toBe('');
  });

  it('reads whole rial amounts with Persian digits and separators, never a fraction or a sign', () => {
    expect(rialAmountText('۱٬۲۰۰٬۰۰۰', { allowZero: false })).toBe('1200000');
    expect(rialAmountText('1,500,000', { allowZero: false })).toBe('1500000');
    expect(rialAmountText(250000, { allowZero: false })).toBe('250000');
    expect(rialAmountText('0', { allowZero: false })).toBeNull();
    expect(rialAmountText('0', { allowZero: true })).toBe('0');
    expect(rialAmountText('12.5', { allowZero: false })).toBeNull();
    expect(rialAmountText('-5', { allowZero: true })).toBeNull();
    expect(rialAmountText('1'.repeat(15), { allowZero: false })).toBeNull();
  });

  it('offers a price only in whole rials above zero', () => {
    expect(sitePrice('1200000.0000', 'IRR')).toBe('1200000');
    expect(sitePrice('1200000', null)).toBe('1200000');
    expect(sitePrice('1200000.5000', 'IRR')).toBeNull();
    expect(sitePrice('0', 'IRR')).toBeNull();
    expect(sitePrice('100', 'USD')).toBeNull();
  });

  it('knows the 31 provinces and the empty «every other province»', () => {
    expect(isProvince('تهران')).toBe(true);
    expect(isProvince('')).toBe(true);
    expect(isProvince('Tehran')).toBe(false);
  });
});

describe('storefront stock', () => {
  it('reads out, low and in stock with the threshold of the settings', () => {
    expect(stockStatusOf(0)).toBe('out');
    expect(stockStatusOf(-2)).toBe('out');
    expect(stockStatusOf(3)).toBe('low');
    expect(stockStatusOf(4)).toBe('in_stock');
    expect(stockStatusOf(5, 5)).toBe('low');
    expect(stockStatusOf(1, 0)).toBe('in_stock');
  });

  it('lets a buyer order whole units only', () => {
    expect(maxOrderQuantity(2.75)).toBe(2);
    expect(maxOrderQuantity(-1)).toBe(0);
    expect(maxOrderQuantity(Number.NaN)).toBe(0);
  });
});

describe('shipping quote', () => {
  const table: ShippingMethodRule = {
    pricing: 'table', flatRate: '0', isFreeShippingEligible: true,
    rates: [
      { province: 'تهران', maxWeightGrams: 1000, rate: '400000' },
      { province: 'تهران', maxWeightGrams: null, rate: '700000' },
      { province: '', maxWeightGrams: 2000, rate: '900000' },
    ],
  };
  const cart = (province: string, weightGrams: number, subtotal = '1000000') => ({ province, weightGrams, subtotal });

  it('picks the lightest row of the province that holds the weight, then the row of every other province', () => {
    expect(shippingQuote(table, cart('تهران', 800), '')).toEqual({ kind: 'cost', amount: '400000', free: false });
    expect(shippingQuote(table, cart('تهران', 5000), '')).toEqual({ kind: 'cost', amount: '700000', free: false });
    expect(shippingQuote(table, cart('فارس', 1500), '')).toEqual({ kind: 'cost', amount: '900000', free: false });
    expect(shippingQuote(table, cart('فارس', 2500), '')).toEqual({ kind: 'unavailable' });
  });

  it('is free above the threshold only for an eligible method', () => {
    expect(shippingQuote(table, cart('تهران', 800, '5000000'), '5000000')).toEqual({ kind: 'cost', amount: '0', free: true });
    expect(shippingQuote(table, cart('تهران', 800, '4999999'), '5000000')).toEqual({ kind: 'cost', amount: '400000', free: false });
    const flat: ShippingMethodRule = { pricing: 'flat', flatRate: '350000', isFreeShippingEligible: false, rates: [] };
    expect(shippingQuote(flat, cart('تهران', 800, '9000000'), '5000000')).toEqual({ kind: 'cost', amount: '350000', free: false });
  });

  it('leaves Snapp and courier to the buyer and pickup free', () => {
    expect(shippingQuote({ pricing: 'on_delivery', flatRate: '0', isFreeShippingEligible: false, rates: [] }, cart('تهران', 1), '')).toEqual({ kind: 'on_delivery' });
    expect(shippingQuote({ pricing: 'free', flatRate: '0', isFreeShippingEligible: false, rates: [] }, cart('تهران', 1), '')).toEqual({ kind: 'cost', amount: '0', free: true });
  });
});
