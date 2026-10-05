import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fin } from '../../lib/financialDecimal';
import { decimalInput, latinDigitsString } from '../../middleware/validate';
import { createChequeSchema } from '../../routes/accounting/accounting.schemas';

// v8.0.108 (TD-385): مبلغ و شماره با ارقام فارسی یا عربی صفر یا رد نمی‌شود
describe('Persian and Arabic digits in amounts and numbers (TD-385)', () => {
  it('fin() reads Persian and Arabic digits instead of silently returning 0', () => {
    expect(fin('۵۰۰۰۰۰').toNumber()).toBe(500000);
    expect(fin('۵۰۰٬۰۰۰').toNumber()).toBe(500000);
    expect(fin('١٢٫٥').toNumber()).toBe(12.5);
    expect(fin('1,250,000').toNumber()).toBe(1250000);
  });

  it('decimalInput normalizes digits and refuses text instead of turning it into 0', () => {
    const schema = z.object({ bonuses: decimalInput('پاداش').optional() });
    expect(schema.parse({ bonuses: '۵۰۰٬۰۰۰' }).bonuses).toBe('500000');
    expect(schema.parse({ bonuses: 1250.5 }).bonuses).toBe('1250.5');
    expect(schema.parse({ bonuses: '' }).bonuses).toBeUndefined();
    expect(schema.safeParse({ bonuses: 'پانصد' }).success).toBe(false);
    expect(schema.safeParse({ bonuses: Number.NaN }).success).toBe(false);
  });

  it('cheque and Sayad numbers typed in Persian are stored in Latin digits', () => {
    expect(latinDigitsString.parse(' ۱۲۳۴۵۶ ')).toBe('123456');
    const parsed = createChequeSchema.parse({
      body: {
        type: 'received', chequeNumber: '۱۲۳۴۵۶', sayadNumber: '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶', bankName: 'ملت',
        issueDate: '1405/07/13', dueDate: '1405/08/13', amount: 1000, partyName: 'مشتری',
      },
    });
    expect(parsed.body.chequeNumber).toBe('123456');
    expect(parsed.body.sayadNumber).toBe('1234567890123456');
    expect(createChequeSchema.safeParse({
      body: { type: 'received', chequeNumber: '۱', sayadNumber: '۱۲۳', bankName: 'ملت', issueDate: 'x', dueDate: 'x', amount: 1, partyName: 'م' },
    }).success).toBe(false);
  });
});
