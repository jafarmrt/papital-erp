import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeDecimalString } from '../../lib/numericInput';
import { readDecimalInputText } from '../../lib/decimalInputText';
import { voucherSourceHint, voucherSourceLabel } from '../../lib/accounting/voucherSource';
import { decimalInput } from '../../middleware/validate';

// v11 phase 3.1 (M4): one rule for the group separator on the server and in the browser
describe('misplaced group separators (v11 M4)', () => {
  it('normalizeDecimalString removes a separator only between groups of three digits', () => {
    expect(normalizeDecimalString('1٬000')).toBe('1000');
    expect(normalizeDecimalString('۱٬۲۳۴٬۵۶۷٫۸')).toBe('1234567.8');
    expect(normalizeDecimalString('-1,250,000')).toBe('-1250000');
    expect(normalizeDecimalString(' 1 000 ')).toBe('1000');
    expect(normalizeDecimalString('12,5')).toBe('12,5');
    expect(normalizeDecimalString('1٬00٬0')).toBe('1٬00٬0');
    expect(normalizeDecimalString('۱٬۰')).toBe('1٬0');
    expect(normalizeDecimalString('1,000,0')).toBe('1,000,0');
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
