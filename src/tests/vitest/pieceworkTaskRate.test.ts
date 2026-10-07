import { describe, expect, it } from 'vitest';
import { parsePieceworkRate } from '../../lib/piecework/pieceworkRate';
import { parsePieceworkTaskRows } from '../../components/piecework/pieceworkExcelUtils';

// v9.0.235 (TD-813): a piecework base rate is a non-negative number; the Excel preview uses the server's rule
describe('piecework task base rate (TD-813)', () => {
  it('reads Persian digits and separators and refuses text or negative rates', () => {
    expect(parsePieceworkRate('۲۵۰٬۰۰۰', 'نرخ پایه')).toEqual({ ok: true, value: '250000' });
    expect(parsePieceworkRate(35000, 'نرخ پایه')).toEqual({ ok: true, value: '35000' });
    expect(parsePieceworkRate('', 'نرخ پایه')).toEqual({ ok: true, value: undefined });
    expect(parsePieceworkRate('-0', 'نرخ پایه')).toEqual({ ok: true, value: '0' });
    expect(parsePieceworkRate('-1000', 'نرخ پایه')).toEqual({ ok: false, message: 'نرخ پایه نمی‌تواند منفی باشد' });
    expect(parsePieceworkRate('abc', 'نرخ پایه').ok).toBe(false);
  });

  it('marks an Excel row with a text or negative rate invalid instead of turning it into zero', () => {
    const rows = parsePieceworkTaskRows([
      { 'عنوان کار': 'منفی', 'نرخ پایه': '-1000' },
      { 'عنوان کار': 'متن', 'نرخ پایه': 'abc' },
      { 'عنوان کار': 'درست', 'نرخ پایه': '۳۵٬۰۰۰' },
      { 'عنوان کار': 'بی نرخ' },
    ]);
    expect(rows.map(r => r.isValid)).toEqual([false, false, true, true]);
    expect(rows[0].warnings[0]).toContain('نمی‌تواند منفی باشد');
    expect(rows.map(r => r.defaultRate)).toEqual([0, 0, 35000, 0]);
  });
});
