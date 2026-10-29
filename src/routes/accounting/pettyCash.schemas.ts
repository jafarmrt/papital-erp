import { z } from 'zod';
import { decimalInput } from '../../middleware/validate.js';
import { PETTY_CASH_MAX_LINES, PETTY_CASH_TEXT_MAX } from '../../lib/treasury/pettyCash.js';

// v10.1.32 (D-16، ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان — ردیف‌های هزینه، هر کدام حساب و مبلغ؛ شرح، فروشنده و شماره فاکتور اختیاری
const pettyCashLineSchema = z.object({
  accountId: z.coerce.number().int().positive('حساب هزینه هر ردیف را انتخاب کنید'),
  amount: decimalInput('مبلغ ردیف')
    .refine(v => v !== undefined, 'مبلغ ردیف الزامی است')
    .refine(v => v === undefined || Number(v) > 0, 'مبلغ هر ردیف باید بزرگ‌تر از صفر باشد'),
  description: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
  sellerName: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
  invoiceNumber: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
  // v11 tool 5: the production project the line was spent on
  projectId: z.number().int().positive().max(2147483647).nullable().optional(),
}).strict();

export const pettyCashExpenseSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تنخواه باید عددی باشد')
  }),
  body: z.object({
    date: z.string().optional(),
    description: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
    lines: z.array(pettyCashLineSchema)
      .min(1, 'دست‌کم یک ردیف هزینه وارد کنید')
      .max(PETTY_CASH_MAX_LINES, `صورت‌هزینه حداکثر ${PETTY_CASH_MAX_LINES.toLocaleString('fa-IR')} ردیف دارد`),
    attachments: z.array(z.any()).optional(),
  }).strict()
});

export const pettyCashLinesSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تراکنش باید عددی باشد')
  }),
});

// v11 (the 1405 replay, tool 4): an expense a colleague paid from their own pocket — the colleague and the lines of a petty cash statement
export const colleagueExpenseSchema = z.object({
  body: z.object({
    personnelId: z.coerce.number().int().positive('همکاری را که هزینه را پرداخته انتخاب کنید'),
    date: z.string().optional(),
    description: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
    lines: z.array(pettyCashLineSchema)
      .min(1, 'دست‌کم یک ردیف هزینه وارد کنید')
      .max(PETTY_CASH_MAX_LINES, `هزینهٔ پرداختی همکار حداکثر ${PETTY_CASH_MAX_LINES.toLocaleString('fa-IR')} ردیف دارد`),
    attachments: z.array(z.any()).optional(),
  }).strict()
});

export const colleagueExpenseVoidSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه هزینه باید عددی باشد')
  }),
  body: z.object({
    reason: z.string().trim().min(1, 'دلیل ابطال را بنویسید').max(PETTY_CASH_TEXT_MAX),
  }).strict()
});

export const colleagueExpenseListSchema = z.object({
  query: z.object({
    personnelId: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  }).strict()
});
