import { z } from 'zod';
import { decimalInput } from '../../middleware/validate.js';
import { PETTY_CASH_MAX_LINES, PETTY_CASH_TEXT_MAX } from '../../lib/treasury/pettyCash.js';

// v10.1.32 (D-16، ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان — ردیف‌های هزینه، هر کدام حساب و مبلغ؛ مالیات، شرح، فروشنده و شماره فاکتور اختیاری
const pettyCashLineSchema = z.object({
  accountId: z.coerce.number().int().positive('حساب هزینه هر ردیف را انتخاب کنید'),
  amount: decimalInput('مبلغ ردیف')
    .refine(v => v !== undefined, 'مبلغ ردیف الزامی است')
    .refine(v => v === undefined || Number(v) > 0, 'مبلغ هر ردیف باید بزرگ‌تر از صفر باشد'),
  // اختیاری: بخشی از مبلغ ردیف که به حساب مالیات بر ارزش افزوده خرید می‌رود (کمتر بودن از مبلغ را سرویس می‌سنجد)
  vatAmount: decimalInput('مالیات بر ارزش افزوده ردیف')
    .refine(v => v === undefined || Number(v) >= 0, 'مالیات بر ارزش افزوده ردیف نمی‌تواند منفی باشد')
    .optional(),
  description: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
  sellerName: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
  invoiceNumber: z.string().max(PETTY_CASH_TEXT_MAX).optional(),
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
