import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeDecimalString, normalizeGroupedDecimalString } from '../../lib/numericInput';
import { parseNumberCell } from '../../lib/items/itemExcelCells';
import { readDecimalInputText } from '../../lib/decimalInputText';
import { voucherSourceHint, voucherSourceLabel } from '../../lib/accounting/voucherSource';
import { decimalInput } from '../../middleware/validate';
import { parsePriceAmount } from '../../lib/items/priceInput';
import { parseWorkQuantity } from '../../lib/piecework/workQuantity';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate';
import { parseQuantityOrTime } from '../../utils/persianNumber';

// v11 phase 3.1 (M4): one rule for the group separator on the server and in the browser
describe('misplaced group separators (v11 M4)', () => {
  it('the reader of a saved value removes a separator only between groups of three digits', () => {
    expect(normalizeGroupedDecimalString('1٬000')).toBe('1000');
    expect(normalizeGroupedDecimalString('۱٬۲۳۴٬۵۶۷٫۸')).toBe('1234567.8');
    expect(normalizeGroupedDecimalString('-1,250,000')).toBe('-1250000');
    expect(normalizeGroupedDecimalString(' 1 000 ')).toBe('1000');
    expect(normalizeGroupedDecimalString('12,5')).toBe('12,5');
    expect(normalizeGroupedDecimalString('1٬00٬0')).toBe('1٬00٬0');
    expect(normalizeGroupedDecimalString('۱٬۰')).toBe('1٬0');
    expect(normalizeGroupedDecimalString('1,000,0')).toBe('1,000,0');
    // a first group with a leading zero is a decimal comma, not a thousands group («0,500» is not 500)
    expect(normalizeGroupedDecimalString('0,500')).toBe('0,500');
    // the lenient form of typing and display is unchanged
    expect(normalizeDecimalString('12,5')).toBe('125');
  });

  it('an Excel cell with a misplaced separator is not a number', () => {
    expect(parseNumberCell({ 'قیمت': '12,5' }, ['قیمت']).error).toBeTruthy();
    expect(parseNumberCell({ 'قیمت': '۱٬۲۵۰' }, ['قیمت']).value).toBe(1250);
  });

  it('decimalInput refuses a misplaced separator with the browser rule, and still reads groups of three', () => {
    const schema = z.object({ amount: decimalInput('مبلغ').optional() });
    expect(schema.parse({ amount: '۵۰۰٬۰۰۰' }).amount).toBe('500000');
    expect(schema.parse({ amount: '1,250,000.5' }).amount).toBe('1250000.5');
    for (const bad of ['12,5', '1٬00٬0', '۱٬۲', ',100', '100,']) {
      const res = schema.safeParse({ amount: bad });
      expect(res.success, bad).toBe(false);
      if (!res.success) expect(res.error.issues[0].message).toContain('جداکنندهٔ هزارگان');
    }
    // the browser reader refuses the same texts
    for (const bad of ['12,5', '1٬00٬0', '۱٬۲']) expect(readDecimalInputText(bad).kind, bad).toBe('invalid');
  });

  it('the price, work quantity and piecework rate readers refuse a misplaced separator, never read it as 125', () => {
    expect(parsePriceAmount('12,5')).toBeNull();
    expect(parsePriceAmount('0,500')).toBeNull();
    expect(parsePriceAmount('۱٬۲۵۰')).toBe('1250');
    expect(parseWorkQuantity('12,5').ok).toBe(false);
    expect(parseWorkQuantity('1,250')).toMatchObject({ ok: true });
    expect(parsePieceworkRate('12,5', 'rate').ok).toBe(false);
    expect(parsePieceworkRate('1٬250', 'rate')).toMatchObject({ ok: true });
    // the work log form reads such a quantity as no quantity, so its save is refused
    expect(parseQuantityOrTime('12,5')).toBe(0);
    expect(parseQuantityOrTime('1,250')).toBe(1250);
    expect(parseQuantityOrTime('2:30')).toBe(2.5);
  });
});

// v11 phase 3.1 (M2): the opening balance is changed in the treasury account's form, never voided from the voucher page
describe('voucher source hint (v11 M2)', () => {
  it('names the account form for an opening balance and the void for every other source', () => {
    expect(voucherSourceLabel('treasury_opening')).toBe('مانده اول دوره حساب خزانه');
    expect(voucherSourceHint('treasury_opening')).toContain('ویرایش همان حساب خزانه');
    expect(voucherSourceHint('cheque')).toBe('چک را ابطال کنید');
    expect(voucherSourceHint('manual')).toBeNull();
    expect(voucherSourceHint(null)).toBeNull();
  });
});
