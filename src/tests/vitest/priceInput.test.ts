import { describe, expect, it } from 'vitest';
import { parsePriceAmount, priceCurrencyOf, priceSaveUpdates } from '../../lib/items/priceInput';
import { buildQuickPriceUpdates } from '../../lib/items/quickPriceImport';

// v9.0.176 (TD-657, price part): a price is a decimal above zero in a supported currency; removal is explicit
describe('item price input', () => {
  it('reads Persian digits and refuses zero, negative and text amounts', () => {
    expect(parsePriceAmount('۲٬۵۰۰٬۰۰۰')).toBe('2500000');
    expect(parsePriceAmount(950000)).toBe('950000');
    expect(parsePriceAmount('12.5')).toBe('12.5');
    for (const bad of [0, -500000, 'abc', '', '0', '-1', null, undefined, Number.NaN]) expect(parsePriceAmount(bad)).toBeNull();
  });

  it('accepts only the supported currencies; empty and «ریال» are IRR', () => {
    expect(priceCurrencyOf('usd')).toBe('USD');
    expect(priceCurrencyOf('')).toBe('IRR');
    expect(priceCurrencyOf('ریال')).toBe('IRR');
    expect(priceCurrencyOf(undefined)).toBe('IRR');
    expect(priceCurrencyOf('XYZ')).toBeNull();
    expect(priceCurrencyOf('تومان')).toBeNull();
  });

  it('turns an empty pricing field into an explicit removal and reports an invalid one instead of sending zero', () => {
    const r = priceSaveUpdates([
      { itemId: 1, edit: { title: 'عمده', price: '', currency: 'IRR' } },
      { itemId: 1, edit: { title: 'فروشگاه', price: '۱۲۰۰', currency: 'EUR' } },
      { itemId: 2, edit: { title: 'عمده', price: 'abc', currency: 'IRR' } },
      { itemId: 2, edit: { title: 'فروشگاه', price: '5', currency: 'XYZ' } },
    ]);
    expect(r.updates).toEqual([
      { itemId: 1, title: 'عمده', remove: true },
      { itemId: 1, title: 'فروشگاه', price: '1200', currency: 'EUR' },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('عمده');
  });

  it('quick import sends only valid prices and lists the others', () => {
    const r = buildQuickPriceUpdates(
      [{ 'کد کالا': 'A-1', 'قیمت عمده': 0, 'قیمت فروشگاه': '۳۰۰٬۰۰۰' }, { 'کد کالا': 'A-2', 'قیمت عمده': 100, 'واحد ارز': 'XYZ' }],
      [{ id: 1, code: 'A-1' }, { id: 2, code: 'A-2' }],
      ['فروشگاه', 'مصرف‌کننده', 'عمده'],
    );
    expect(r.updates).toEqual([{ itemId: 1, title: 'فروشگاه', price: '300000', currency: 'IRR' }]);
    expect(r.invalidCells.map(c => [c.code, c.title])).toEqual([['A-1', 'عمده'], ['A-2', 'عمده']]);
  });
});
