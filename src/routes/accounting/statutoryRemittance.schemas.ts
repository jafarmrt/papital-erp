import { z } from 'zod';
import { decimalInput } from '../../middleware/validate.js';
import { STATUTORY_REMITTANCE_KINDS } from '../../lib/treasury/statutoryRemittance.js';

const positiveAmount = (label: string, positiveMessage: string) => decimalInput(label)
  .refine(v => v !== undefined, `${label} الزامی است`)
  .refine(v => v === undefined || Number(v) > 0, positiveMessage);

/** v10.1.36 (TD-1243، ت۳۳ الف): فهرست پرداخت یکجای بیمه یا مالیات حقوق یک ماه */
const statutoryKind = z.enum(STATUTORY_REMITTANCE_KINDS, { message: 'نوع پرداخت باید بیمه یا مالیات حقوق باشد' });
const statutoryYear = z.coerce.number().int('سال جلالی باید عدد صحیح باشد').min(1390, 'سال جلالی معتبر نیست').max(1500, 'سال جلالی معتبر نیست');
const statutoryMonth = z.coerce.number().int('ماه جلالی باید عدد صحیح باشد').min(1, 'ماه باید از ۱ تا ۱۲ باشد').max(12, 'ماه باید از ۱ تا ۱۲ باشد');

export const statutoryRemittanceOptionsSchema = z.object({
  query: z.object({ kind: statutoryKind, year: statutoryYear, month: statutoryMonth }),
});

export const statutoryRemittanceSchema = z.object({
  body: z.object({
    kind: statutoryKind,
    year: statutoryYear,
    month: statutoryMonth,
    bankAccountId: z.coerce.number().int().positive('انتخاب حساب بانکی یا صندوق الزامی است'),
    date: z.string().optional(),
    method: z.enum(['cash', 'bank_transfer', 'pos'], { message: 'روش پرداخت نامعتبر است' }).optional(),
    trackingNumber: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    lines: z.array(z.object({
      personnelId: z.coerce.number().int().positive('شناسه پرسنل نامعتبر است'),
      amount: positiveAmount('مبلغ هر نفر', 'مبلغ هر نفر باید بزرگتر از صفر باشد'),
    }).strict()).min(1, 'برای پرداخت دست‌کم یک نفر با مبلغ لازم است').max(1000),
    penalty: z.object({
      amount: positiveAmount('جریمه دیرکرد', 'جریمه دیرکرد باید بزرگتر از صفر باشد'),
      accountId: z.coerce.number().int().positive('سرفصل جریمه دیرکرد را انتخاب کنید'),
    }).strict().nullable().optional(),
  }).strict(),
});
