import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { errorHandler } from '../../middleware/logger';
import { decimalInput } from '../../middleware/validate.js';
import { assertChequeDueAfterIssue, assertChequeStepAfterPrevious, lastChequeStepDay } from '../../services/accounting/treasury/chequeDateOrder.js';
import { exactTreasuryAmount } from '../../services/accounting/treasury/treasuryAmount.js';
import { stockMovementQuantity } from '../../services/documents/documentStockEngine.service.js';
import { bomAllocationItemSchema } from '../../routes/inventory.routes.js';
import { convertToOrdersSchema } from '../../routes/procurement.schemas.js';
import { decimalTextScaleIssue } from '../../lib/numericInput.js';
import { parsePriceAmount } from '../../lib/items/priceInput.js';
import { buildQuickPriceUpdates } from '../../lib/items/quickPriceImport.js';
import { readRowPrices } from '../../services/items/itemExcelRow.js';

const SALE_PRICE_LIST = 'فروش';
const SALE_PRICE_COLUMN = 'قیمت فروش';
const ABOVE_ZERO = 'بزرگ‌تر از صفر';

// v11 phase 6.1a: the pure parts of the input guards (the database cases are in regression/inputGuardsV11Tests.ts)
const read = (v: unknown) => decimalInput('مبلغ').safeParse(v);

describe('decimalInput bounds (M16, S10, S12)', () => {
  it('accepts 14 whole digits and 4 decimals, trailing zeros not counted', () => {
    expect(read('99999999999999.9999')).toMatchObject({ success: true, data: '99999999999999.9999' });
    expect(read('1.23450000')).toMatchObject({ success: true });
    expect(read('00000000000000012')).toMatchObject({ success: true });
  });

  it('refuses a 15th whole digit or a 5th decimal, as text or as a number (always below about 1.1e10)', () => {
    const bad = ['100000000000000', '1.23456', '0.00001', '100.00005', 1e14, 1e-5, 1e-7, 1.23456, 100.00005, 99.99999, 12345678.12345, 10 / 3, 1000 / 3,
      12345678901.23456, 10000000000.00005, -0.00001];
    for (const value of bad) expect(read(value).success, String(value)).toBe(false);
  });

  it('cuts the float noise of a computed number and keeps a number as its sender wrote it', () => {
    expect(read(0.1 + 0.2)).toMatchObject({ success: true, data: '0.3' });
    expect(read(1.1 * 3)).toMatchObject({ success: true, data: '3.3' });
    expect(read(0.1 + 0.2 - 0.3)).toMatchObject({ success: true, data: '0' });
    expect(read(1500000.1 + 2300000.2)).toMatchObject({ success: true, data: '3800000.3' });
    expect(read(1200)).toMatchObject({ success: true, data: '1200' });
    expect(read(123.4568)).toMatchObject({ success: true, data: '123.4568' });
    // a double cannot hold 18 digits; the number keeps the digits it has, with no binary digits written out
    expect(read(12345678901234.5678)).toMatchObject({ success: true, data: '12345678901234.568' });
  });

  it('sends an Excel formula price without its float noise, and the import holds a price to the bound', () => {
    expect(parsePriceAmount(1850000 * 1.1)).toBe('2035000');
    expect(parsePriceAmount(1500 * 1.15)).toBe('1725');
    expect(parsePriceAmount(100.00005)).toBe('100.00005');
    expect(parsePriceAmount(0.1 + 0.2 - 0.3)).toBeNull();
    const pricesOf = (value: unknown) => readRowPrices({ [SALE_PRICE_COLUMN]: value }, [SALE_PRICE_LIST], () => undefined);
    expect(pricesOf(1850000 * 1.1)?.get(SALE_PRICE_LIST)?.price).toBe('2035000');
    for (const value of [100.00005, 1e-7, '1.23456', 123456789012345]) expect(pricesOf(value), String(value)).toBeNull();
  });

  it('reports a price the column cannot hold as a bad cell of the quick price import, the other cells still saved', () => {
    const bad = [100.00005, 1e-7, '1.23456', 100 / 3];
    const rows = [{ 'کد کالا': 'A-1', [SALE_PRICE_COLUMN]: 1850000 * 1.1 }, ...bad.map((value, i) => ({ 'کد کالا': `B-${i}`, [SALE_PRICE_COLUMN]: value }))];
    const items = [{ id: 1, code: 'A-1', name: 'a' }, ...bad.map((_, i) => ({ id: 10 + i, code: `B-${i}`, name: `b${i}` }))];
    const result = buildQuickPriceUpdates(rows, items, [SALE_PRICE_LIST]);
    expect(result.updates).toEqual([{ itemId: 1, title: SALE_PRICE_LIST, price: '2035000', currency: 'IRR' }]);
    expect(result.invalidCells.map(c => c.code)).toEqual(bad.map((_, i) => `B-${i}`));
  });

  it('names the bound it breaks', () => {
    expect(decimalTextScaleIssue('-123456789012345')).toBe('size');
    expect(decimalTextScaleIssue('1.00001')).toBe('scale');
    expect(decimalTextScaleIssue('1.10000')).toBeNull();
  });
});

describe('cheque date order (M12)', () => {
  it('refuses a paid cheque due before its issue day, and records a received cheque that is already due', () => {
    expect(() => assertChequeDueAfterIssue('paid', '2026-10-20', '2026-10-19')).toThrow();
    expect(() => assertChequeDueAfterIssue('paid', '2026-10-20', '2026-10-20')).not.toThrow();
    expect(() => assertChequeDueAfterIssue('received', '2026-10-20', '2026-10-17')).not.toThrow();
  });

  it('takes the latest ISO day of the issue and the history, skipping legacy entries', () => {
    const history = [{ date: '2026-10-21' }, { date: '1405/07/30' }, { date: '2026-10-22T10:00:00Z' }];
    expect(lastChequeStepDay('2026-10-20', history)).toBe('2026-10-22');
    expect(() => assertChequeStepAfterPrevious('2026-10-21', '2026-10-20', history)).toThrow();
    expect(() => assertChequeStepAfterPrevious('2026-10-22', '2026-10-20', history)).not.toThrow();
  });

  it('skips a legacy issue day after today, so the cheque\'s steps are not blocked until then', () => {
    expect(lastChequeStepDay('2026-11-30', [], '2026-10-26')).toBe('');
    expect(() => assertChequeStepAfterPrevious('2026-10-26', '2026-11-30', [], '2026-10-26')).not.toThrow();
  });
});

describe('exact treasury amount (M16)', () => {
  it('refuses an amount a JS number changes, keeps the rest', () => {
    expect(() => exactTreasuryAmount('12345678901234.5678', 'مبلغ')).toThrow();
    expect(exactTreasuryAmount('1234567890.12', 'مبلغ')).toBe(1234567890.12);
    expect(exactTreasuryAmount('', 'مبلغ')).toBe(0);
  });
});

describe('numeric overflow answer (M16, S12)', () => {
  it('answers 422 NUMERIC_OUT_OF_RANGE without the SQL text, values or stack', () => {
    const pgError = Object.assign(new Error('numeric field overflow'), { severity: 'ERROR', code: '22003' });
    const err = new DrizzleQueryError('insert into "transactions" ("total_price") values ($1)', ['1e20'], pgError);
    const out = { status: 0, body: {} as Record<string, unknown> };
    const res = {
      headersSent: false,
      status(code: number) { out.status = code; return res; },
      json(body: Record<string, unknown>) { out.body = body; return res; },
    };
    errorHandler(err, { method: 'POST', originalUrl: '/api/documents', headers: {} }, res, () => undefined);
    expect(out.status).toBe(422);
    expect(out.body.code).toBe('NUMERIC_OUT_OF_RANGE');
    expect(out.body.stack).toBeUndefined();
    expect(JSON.stringify(out.body)).not.toContain('transactions');
  });
});

describe('stock movement quantity (S10)', () => {
  it('rounds once to 4 decimals, so a quantity below the scale is zero and refused as zero', () => {
    expect(stockMovementQuantity(1.23456)).toBe(1.2346);
    expect(stockMovementQuantity('2.00005')).toBe(2.0001);
    expect(stockMovementQuantity(0.00004)).toBe(0);
    expect(Number.isNaN(stockMovementQuantity('abc'))).toBe(true);
  });
});

describe('number fields that stay numbers take the same bound (M16)', () => {
  it('refuses a fifth decimal or a 15th whole digit on a BOM allocation and a purchase order line', () => {
    const allocation = (quantity: number) => bomAllocationItemSchema.safeParse({ itemId: 1, quantity }).success;
    expect(allocation(1.2345)).toBe(true);
    expect(allocation(1.23456)).toBe(false);
    expect(allocation(1e14)).toBe(false);
    // a number that reads as 0 is refused, since the number itself goes on past `.positive()`
    expect(allocation(1e-17)).toBe(false);
    expect(allocation(1.1 * 3)).toBe(true);
    const order = (quantity: number, unitPrice: number) => convertToOrdersSchema.safeParse({
      params: { id: '1' },
      body: { orderGroups: [{ items: [{ itemId: 1, quantity, unitPrice }] }] },
    }).success;
    expect(order(2, 1000.5)).toBe(true);
    expect(order(1.23456, 1000)).toBe(false);
    expect(order(2, 100000000000000)).toBe(false);
    expect(order(1e-17, 1000)).toBe(false);
    expect(order(2, 0)).toBe(true);
    // a price that may be zero takes the noise of a computed zero as 0, like `decimalInput` (review 4 of #403)
    expect(order(2, 0.1 + 0.2 - 0.3)).toBe(true);
  });

  it('says a quantity that reads as 0 must be above zero, not that it has too many decimals', () => {
    const issue = bomAllocationItemSchema.safeParse({ itemId: 1, quantity: 1e-17 }).error?.issues[0]?.message ?? '';
    expect(issue).toContain(ABOVE_ZERO);
  });
});
