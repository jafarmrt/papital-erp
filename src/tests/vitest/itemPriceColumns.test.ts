import { describe, expect, it } from 'vitest';
import { extractRowPriceColumns, ITEM_WAC_COLUMN } from '../../lib/items/excelPriceColumns';
import { buildQuickPriceUpdates } from '../../lib/items/quickPriceImport';

const STRATEGIES = ['فروشگاه', 'مصرف‌کننده', 'عمده'];

// v9.0.114 (TD-647): only configured price lists are prices; the cost and stock columns of an export never become prices
describe('Excel price columns', () => {
  it('reads configured price lists only and reports other «قیمت …» columns', () => {
    const r = extractRowPriceColumns({
      'کد کالا': '1404-N-101-01', 'موجودی کل': 12, [ITEM_WAC_COLUMN]: 700000, 'قیمت میانگین خرید (WAC)': 700000,
      'قیمت عمده': 950000, 'قیمت - فروشگاه': 1200000, 'قیمت ویژه': 5, 'واحد ارز': 'USD',
    }, STRATEGIES);
    expect(r.prices.map(p => [p.title, p.value, p.currency])).toEqual([['عمده', 950000, 'USD'], ['فروشگاه', 1200000, 'USD']]);
    expect(r.unknownColumns).toEqual(['قیمت ویژه']);
  });

  it('builds quick-import updates only for price lists of the pricing page export', () => {
    const r = buildQuickPriceUpdates(
      [{ 'کد کالا': 'A-101', 'نام کالا': 'x', 'موجودی کل': 12, 'میانگین بهای خرید': 700000, 'قیمت عمده': 950000 }, { 'کد کالا': 'ZZ' }],
      [{ id: 7, code: 'A-101', name: 'x' }],
      STRATEGIES,
    );
    expect(r.updates).toEqual([{ itemId: 7, title: 'عمده', price: 950000, currency: 'IRR' }]);
    expect(r.unmatchedRows).toBe(1);
  });
});
