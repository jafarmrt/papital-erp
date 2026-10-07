/**
 * طرح‌های Zod کوئری گزارش‌های مالی و بستن سال مالی (src/routes/accounting/reports.routes.ts و fiscal.routes.ts).
 * از accounting.schemas.ts (و در نتیجه src/routes/accounting.routes.ts) دوباره صادر می‌شوند.
 */
import { z } from 'zod';
import { storageDateParam } from '../../middleware/validate.js';

// ==========================================
// REPORTS & FINANCIAL STATEMENTS
// ==========================================
// V1.6.0: گزارش جریان نقدی خزانه
export const dateRangeQuerySchema = z.object({
  query: z.object({
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().optional()
  }).optional()
});

// v9.0.120 (TD-545، ت۳ الف): «همراه اسناد اختتامیه»؛ بی آن اسناد بستن سالِ روز پایان گزارش شمرده نمی‌شوند
const includeClosingFlag = z.enum(['true', 'false']).optional();

export const trialBalanceQuerySchema = z.object({
  query: z.object({
    // v7.0.138 (TD-249): «all» (درخت ۴ سطحی، پیش‌فرض صفحه صورت‌ها و گزارش‌های مالی) و «tree» را سرویس پشتیبانی می‌کند
    level: z.enum(['all', 'tree', 'group', 'general', 'subsidiary', 'detailed']).optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().optional(),
    includeClosing: includeClosingFlag,
  }).optional()
});

export const accountCardQuerySchema = z.object({
  query: z.object({
    accountId: z.coerce.number().int().positive().optional(),
    detailedType: z.enum(['none', 'customer', 'personnel', 'project', 'bank_account', 'other', 'supplier']).optional(),
    detailedId: z.coerce.number().int().positive().optional(),
    detailedName: z.string().optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().optional(),
  }).optional()
});

export const partyLedgerQuerySchema = z.object({
  query: z.object({
    partyId: z.coerce.number().int().positive().optional(),
    partyType: z.string().optional(),
    partyName: z.string().optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().optional(),
    includeDrafts: z.string().optional(),
  }).optional()
});

// v7.0.127 (TD-247): فهرست طرف‌های حساب (getPartiesList)
export const partiesQuerySchema = z.object({
  query: z.object({
    search: z.string().max(200).optional(),
    type: z.preprocess(
      v => (v === '' ? undefined : v),
      z.enum(['all', 'customer', 'supplier', 'personnel'], { message: 'نوع طرف حساب باید all، customer، supplier یا personnel باشد' }).optional()
    ),
  }).optional()
});

export const journalBookQuerySchema = z.object({
  query: z.object({
    startDate: storageDateParam,
    endDate: storageDateParam,
    search: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const financialRatiosQuerySchema = z.object({
  query: z.object({
    asOfDate: storageDateParam,
    currency: z.string().optional(),
    includeClosing: includeClosingFlag,
  }).optional()
});

export const incomeStatementQuerySchema = z.object({
  query: z.object({
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().optional(),
    includeClosing: includeClosingFlag,
  }).optional()
});

export const balanceSheetQuerySchema = z.object({
  query: z.object({
    date: storageDateParam,
    asOfDate: storageDateParam,
    currency: z.string().optional(),
    includeClosing: includeClosingFlag,
  }).optional()
});

export const projectDetailQuerySchema = z.object({
  query: z.object({
    projectId: z.coerce.number().int().positive('شناسه پروژه الزامی است و باید عدد مثبت باشد')
  })
});

export const docSignaturesQuerySchema = z.object({
  query: z.object({
    entityId: z.string().min(1, 'شناسه سند الزامی است')
  })
});

// ==========================================
// FISCAL YEAR CLOSING
// ==========================================
export const fiscalClosingPreviewQuerySchema = z.object({
  query: z.object({
    year: z.string().min(1, 'سال مالی الزامی است'),
    // v8.0.47 (TD-310): تاریخ‌ها از خود سال ساخته می‌شوند؛ اگر فرستاده شوند باید آخرین روز سال و ۱ فروردین بعد باشند
    closingDate: z.string().optional(),
    openingDateNewYear: z.string().optional(),
  })
});

export const fiscalClosingExecuteSchema = z.object({
  body: z.object({
    year: z.string().min(1, 'سال مالی الزامی است'),
    closingDate: z.string().optional(),
    openingDateNewYear: z.string().optional(),
    createOpeningVoucher: z.boolean().optional(),
  })
});

/** v9.0.122 (TD-543): بازگشایی آخرین سال مالی بسته با دلیل الزامی */
export const fiscalYearReopenSchema = z.object({
  body: z.object({
    year: z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().min(1, 'سال مالی الزامی است')),
    reason: z.string().trim().min(1, 'دلیل بازگشایی سال مالی را بنویسید.').max(500, 'دلیل بازگشایی حداکثر ۵۰۰ نویسه است.'),
  })
});
