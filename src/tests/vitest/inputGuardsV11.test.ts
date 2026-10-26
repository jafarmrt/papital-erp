import { describe, expect, it } from 'vitest';
import { decimalInput, decimalTextScaleIssue } from '../../middleware/validate.js';
import { assertChequeDueAfterIssue, assertChequeStepAfterPrevious, lastChequeStepDay } from '../../services/accounting/treasury/chequeDateOrder.js';
import { exactTreasuryAmount } from '../../services/accounting/treasury/treasuryAmount.js';

// v11 phase 6.1a: the pure parts of the input guards (the database cases are in regression/inputGuardsV11Tests.ts)
const read = (v: unknown) => decimalInput('مبلغ').safeParse(v);

describe('decimalInput bounds (M16, S10, S12)', () => {
  it('accepts 14 whole digits and 4 decimals, trailing zeros not counted', () => {
    expect(read('99999999999999.9999')).toMatchObject({ success: true, data: '99999999999999.9999' });
    expect(read('1.23450000')).toMatchObject({ success: true });
    expect(read('00000000000000012')).toMatchObject({ success: true });
  });

  it('refuses a 15th whole digit or a 5th decimal, as text or as a number', () => {
    for (const bad of ['100000000000000', '1.23456', '0.00001', 1e14, 1e-5, 1.23456]) expect(read(bad).success).toBe(false);
  });

  it('cuts the float noise of a computed number at 4 decimals', () => {
    expect(read(0.1 + 0.2)).toMatchObject({ success: true, data: '0.3' });
    expect(read(1200)).toMatchObject({ success: true, data: '1200' });
  });

  it('names the bound it breaks', () => {
    expect(decimalTextScaleIssue('-123456789012345')).toBe('size');
    expect(decimalTextScaleIssue('1.00001')).toBe('scale');
    expect(decimalTextScaleIssue('1.10000')).toBeNull();
  });
});

describe('cheque date order (M12)', () => {
  it('refuses a due day before the issue day', () => {
    expect(() => assertChequeDueAfterIssue('2026-10-20', '2026-10-19')).toThrow();
    expect(() => assertChequeDueAfterIssue('2026-10-20', '2026-10-20')).not.toThrow();
  });

  it('takes the latest ISO day of the issue and the history, skipping legacy entries', () => {
    const history = [{ date: '2026-10-21' }, { date: '1405/07/30' }, { date: '2026-10-22T10:00:00Z' }];
    expect(lastChequeStepDay('2026-10-20', history)).toBe('2026-10-22');
    expect(() => assertChequeStepAfterPrevious('2026-10-21', '2026-10-20', history)).toThrow();
    expect(() => assertChequeStepAfterPrevious('2026-10-22', '2026-10-20', history)).not.toThrow();
  });
});

describe('exact treasury amount (M16)', () => {
  it('refuses an amount a JS number changes, keeps the rest', () => {
    expect(() => exactTreasuryAmount('12345678901234.5678', 'مبلغ')).toThrow();
    expect(exactTreasuryAmount('1234567890.12', 'مبلغ')).toBe(1234567890.12);
    expect(exactTreasuryAmount('', 'مبلغ')).toBe(0);
  });
});
