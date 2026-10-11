/**
 * طرح‌های Zod مسیرهای حسابداری (src/routes/accounting/*.routes.ts).
 * از src/routes/accounting.routes.ts هم دوباره صادر می‌شوند تا واردکننده‌های قبلی تغییر نکنند.
 * طرح‌های کوئری گزارش‌ها و بستن سال مالی در reports.schemas.ts هستند و از همین فایل دوباره صادر می‌شوند.
 */
import { z } from 'zod';
import { computeVoucherCurrencyBalance, type CurrencyBalanceRow } from '../../lib/accounting/voucherCurrencyBalance.js';
import { DEFAULT_ACCOUNT_MAPPINGS, type ConceptualAccountMappingConfig } from '../../services/accounting/accountMapping.service.js';
import { decimalInput, latinDigitsString, storageDateParam } from '../../middleware/validate.js';
import { TREASURY_CURRENCIES, normalizeTreasuryCurrency } from '../../lib/treasury/treasuryCurrency.js';
import { VOUCHER_DETAILED_TYPES } from '../../lib/accounting/voucherDetailedTypes.js';
import { isReservedVoucherReference, MANUAL_CLOSING_TYPE_MESSAGE, RESERVED_REFERENCE_MESSAGE } from '../../lib/accounting/manualVoucherRules.js';
import { ACCOUNT_CODE_FORMAT_MESSAGE, ACCOUNT_CODE_PATTERN } from '../../lib/accounting/accountCode.js';

/** query پس از validate: میدل‌ور validate مقدار req.query را با خروجی parse شده Zod جایگزین می‌کند. */
export type ValidatedQuery<S extends z.ZodTypeAny> = z.infer<S> extends { query?: infer Q } ? Partial<NonNullable<Q>> : never;

// ==========================================
// CHART OF ACCOUNTS (کدینگ حساب‌ها)
// ==========================================
// v9.0.201 (TD-558، B03-16): کد با رقم لاتین و فقط رقم
export const createAccountSchema = z.object({
  body: z.object({
    code: latinDigitsString.pipe(z.string().min(1, 'کد حساب الزامی است').regex(ACCOUNT_CODE_PATTERN, ACCOUNT_CODE_FORMAT_MESSAGE)),
    name: z.string().min(1, 'عنوان حساب الزامی است'),
    level: z.enum(['group', 'general', 'subsidiary', 'detailed']),
    parentId: z.number().nullable().optional(),
    accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_sales']),
    nature: z.enum(['debit', 'credit', 'both']),
    description: z.string().optional(),
  })
});

/**
 * v7.0.127 (TD-247): ویرایش حساب — فقط فیلدهایی که ChartOfAccountsService.updateAccount می‌پذیرد (همه اختیاری).
 * v9.0.201 (TD-558): `code` را فرم کدینگ می‌فرستد؛ کد دیگری جز کد خود حساب ۴۲۲ است (`ACCOUNT_CODE_IMMUTABLE`).
 */
export const updateAccountSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[1-9]\d*$/, 'شناسه حساب باید عدد صحیح مثبت باشد')
  }),
  body: z.object({
    code: latinDigitsString.optional(),
    name: z.string().trim().min(1, 'عنوان حساب الزامی است').optional(),
    level: z.enum(['group', 'general', 'subsidiary', 'detailed']).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_sales']).optional(),
    nature: z.enum(['debit', 'credit', 'both']).optional(),
    description: z.string().nullable().optional(),
    isActive: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(v => Boolean(v)).optional(),
  })
});

/**
 * v7.0.127 (TD-247): نگاشت مفهومی سرفصل‌ها — فقط کلیدهای ConceptualAccountMappingConfig (کد حساب، رشته) و فهرست
 * مفاهیم غیرفعال. کلیدهای دیگر (مانند chartHasAccounts که تب تنظیمات از پاسخ GET پس می‌فرستد) حذف می‌شوند.
 */
const accountMappingValueSchema = z.string().max(50, 'کد حساب نگاشت حداکثر ۵۰ نویسه است').optional();
const accountMappingShape = Object.fromEntries(
  (Object.keys(DEFAULT_ACCOUNT_MAPPINGS) as Array<keyof ConceptualAccountMappingConfig>).map(key => [key, accountMappingValueSchema])
) as Record<keyof ConceptualAccountMappingConfig, typeof accountMappingValueSchema>;

export const saveAccountMappingsSchema = z.object({
  body: z.object({
    ...accountMappingShape,
    disabled: z.array(z.string().max(100)).max(200).optional(),
  })
});

// ==========================================
// JOURNAL VOUCHERS (اسناد حسابداری)
// ==========================================
export const vouchersQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    search: z.string().optional(),
    status: z.enum(['draft', 'approved', 'permanent', 'all']).optional(),
    voucherType: z.enum(['general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment', 'settlement', 'all']).optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    referenceModule: z.enum(['manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory', 'all']).optional(),
    referenceId: z.coerce.number().int().positive().optional(),
  }).optional()
});

/**
 * v9.0.191 (TD-564، B03-22، تصمیم ت۷): ارز سند و ردیف سند دستی فقط از فهرست ارزهای خزانه (کد کوچک بزرگ می‌شود، «ریال» ← IRR).
 * خالی یعنی «ارز بالادست» (ردیف ← ارز سند). «تومان» پذیرفته نیست: مبلغ تومانی را به ریال وارد کنید.
 */
const manualVoucherCurrency = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : normalizeTreasuryCurrency(value)),
  z.enum(TREASURY_CURRENCIES, { message: 'ارز سند پشتیبانی نمی‌شود؛ یکی از ریال، دلار، یورو، درهم یا پوند را انتخاب کنید (مبلغ تومانی را به ریال وارد کنید)' }).optional(),
);

const voucherRowAmount = (label: string) => decimalInput(label).optional()
  .transform(v => v ?? '0')
  .refine(v => Number(v) >= 0, `${label} نمی‌تواند منفی باشد`);

export const voucherItemSchema = z.object({
  accountId: z.coerce.number().int().positive('شناسه حساب الزامی و باید عدد مثبت باشد'),
  // v9.0.193 (TD-569): فهرست نوع‌ها مشترک با فرم‌های سند (`voucherDetailedTypes.ts`)
  detailedType: z.enum(VOUCHER_DETAILED_TYPES).optional().default('none'),
  detailedId: z.coerce.number().int().positive().nullable().optional(),
  detailedName: z.string().optional(),
  // v9.0.192 (TD-557، B03-15): مبلغ و نرخ ردیف با `decimalInput` (رقم فارسی و جداکننده هزارگان پذیرفته؛ «0x10» و «1e3» رد)،
  // نه `z.coerce.number` که «0x10» را ۱۶ و «1e3» را ۱٬۰۰۰ می‌خواند و «۱۰۰۰» را با پیام انگلیسی NaN رد می‌کرد
  debit: voucherRowAmount('مبلغ بدهکار'),
  credit: voucherRowAmount('مبلغ بستانکار'),
  currency: manualVoucherCurrency,
  exchangeRate: decimalInput('نرخ تبدیل ردیف').optional()
    .refine(v => v === undefined || Number(v) > 0, 'نرخ تبدیل ردیف باید بزرگتر از صفر باشد'),
  description: z.string().optional(),
}).refine(it => (Number(it.debit) > 0 || Number(it.credit) > 0), {
  message: 'هر ردیف سند باید حداقل دارای مبلغ بدهکار یا بستانکار بزرگتر از صفر باشد'
});

/**
 * v7.0.127 (TD-247): تراز سند در طرح Zod با جمع اعشاری و همان آستانه سرویس (VOUCHER_BALANCE_TOLERANCE).
 * v9.0.190 (TD-551، ت۷): با قاعده ارز سند دستی (computeVoucherCurrencyBalance): سند چندارزی یا چندنرخی به ریال.
 * ردیف ارزی بی نرخ به سرویس سپرده می‌شود تا ۴۲۲ روشن بدهد؛ در ویرایش و اصلاح ارز سند ذخیره‌شده است و در بدنه نیست،
 * پس ردیف بی ارز (جز سند ساده بی ارز و نرخ) هم به سرویس سپرده می‌شود.
 */
const isVoucherBalanced = (rows: readonly CurrencyBalanceRow[], voucherCurrency?: string, headerKnown = true): boolean => {
  const filled = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';
  const allHaveCurrency = rows.every(row => filled(row.currency));
  const plainRows = rows.every(row => !filled(row.currency) && !filled(row.exchangeRate));
  if (!headerKnown && !allHaveCurrency && !plainRows) return true;
  const balance = computeVoucherCurrencyBalance(rows, voucherCurrency);
  return balance.rowsWithoutRate.length > 0 || balance.isBalanced;
};

/**
 * v9.0.160 (TD-559، B03-17): نوع سند دستی؛ «اختتامیه» را فقط بستن سال مالی صادر می‌کند (مانده‌های اول دوره «افتتاحیه» است)
 */
const manualVoucherType = z.enum(['general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment', 'settlement'])
  .refine(type => type !== 'closing', MANUAL_CLOSING_TYPE_MESSAGE);

export const createVoucherSchema = z.object({
  body: z.object({
    date: z.string().min(1, 'تاریخ سند الزامی است'),
    voucherType: manualVoucherType.optional().default('general'),
    status: z.enum(['draft', 'approved']).optional(),
    manualVoucherNumber: z.string().optional(),
    description: z.string().min(1, 'شرح کلی سند الزامی است'),
    referenceModule: z.enum(['manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory']).optional().default('manual'),
    referenceId: z.coerce.number().int().positive().nullable().optional(),
    referenceNumber: z.string().optional().refine(ref => !isReservedVoucherReference(ref), RESERVED_REFERENCE_MESSAGE),
    currency: manualVoucherCurrency,
    attachments: z.array(z.any()).optional(),
    items: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند حسابداری الزامی است')
  }).refine((data) => isVoucherBalanced(data.items, data.currency), {
    message: 'سند حسابداری تراز نیست؛ مجموع مبالغ بدهکار و بستانکار باید برابر و بزرگتر از صفر باشند',
    path: ['items']
  })
});

export const updateVoucherSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه سند باید عددی باشد')
  }),
  body: z.object({
    date: z.string().min(1, 'تاریخ سند الزامی است').optional(),
    description: z.string().min(1, 'شرح کلی سند الزامی است').optional(),
    manualVoucherNumber: z.string().optional(),
    voucherType: manualVoucherType.optional(),
    currency: manualVoucherCurrency,
    attachments: z.array(z.any()).optional(),
    items: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند حسابداری الزامی است').optional(),
    // v9.0.295 (TD-555، B03-13): نسخه‌ای که ویرایشگر خوانده است؛ نسخه کهنه ۴۰۹ OCC_CONFLICT. پیش‌تر ذخیره دوم دو حسابدار
    // ذخیره اول را بی‌صدا پاک می‌کرد
    version: z.coerce.number({ message: 'نسخه سند حسابداری ارسال نشده است؛ صفحه را بازخوانی کنید و دوباره ویرایش کنید.' })
      .int('نسخه سند باید عدد صحیح باشد').positive('نسخه سند باید مثبت باشد'),
  }).refine((data) => !data.items || isVoucherBalanced(data.items, undefined, false), {
    message: 'سند حسابداری تراز نیست؛ مجموع مبالغ بدهکار و بستانکار باید برابر و بزرگتر از صفر باشند',
    path: ['items']
  })
});

// Reversal Voucher Route (صدور سند معکوس / برگشت)
export const reverseVoucherSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه سند باید عددی باشد')
  }),
  body: z.object({
    date: z.string().min(1, 'تاریخ سند برگشت الزامی است').optional(),
    reason: z.string().min(1, 'علت صدور سند برگشت الزامی است').optional()
  }).optional()
});

// Correction Voucher Route (صدور سند اصلاحی)
export const correctVoucherSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه سند باید عددی باشد')
  }),
  body: z.object({
    date: z.string().min(1, 'تاریخ سند اصلاحی الزامی است').optional(),
    reason: z.string().min(1, 'علت اصلاح سند الزامی است'),
    newDescription: z.string().optional(),
    newItems: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند اصلاحی الزامی است')
  }).refine((data) => isVoucherBalanced(data.newItems, undefined, false), {
    message: 'سند اصلاحی تراز نیست؛ مجموع مبالغ بدهکار و بستانکار باید برابر و بزرگتر از صفر باشند',
    path: ['newItems']
  })
});

// Batch Finalize Vouchers
export const batchFinalizeVouchersSchema = z.object({
  body: z.object({
    ids: z.array(z.coerce.number().int().positive('شناسه سند نامعتبر است')).min(1, 'حداقل یک سند باید انتخاب شود')
  })
});

// Batch Approve Vouchers (تایید گروهی اسناد پیش‌نویس توسط حسابدار/مدیر مالی)
export const batchApproveVouchersSchema = z.object({
  body: z.object({
    ids: z.array(z.coerce.number().int().positive('شناسه سند نامعتبر است')).min(1, 'حداقل یک سند باید انتخاب شود')
  })
});

// Status change route (تغییر وضعیت سند حسابداری: پیش‌نویس، تایید شده، دائم و قطعی)
export const setVoucherStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه سند باید عددی باشد')
  }),
  body: z.object({
    status: z.enum(['draft', 'approved', 'permanent'], {
      message: 'وضعیت سند باید یکی از مقادیر draft، approved یا permanent باشد'
    }),
    reason: z.string().optional()
  })
});

// ==========================================
// BANK ACCOUNTS & TREASURY
// ==========================================
/**
 * v9.0.101 (TD-514، B04-18): مبلغ، مانده اول دوره و نرخ تسعیر خزانه و چک با `decimalInput` (رقم فارسی، «٫» و جداکننده
 * هزارگان پذیرفته؛ متن ← پیام فارسی)، نه `z.coerce.number()` که «۲۵۰۰۰۰۰» و «2,500,000» را با پیام انگلیسی NaN رد می‌کرد.
 * ارز از فهرست `TREASURY_CURRENCIES` (کد کوچک بزرگ می‌شود؛ خالی و «ریال» ← IRR).
 */
const positiveTreasuryAmount = (label: string, positiveMessage: string) => decimalInput(label)
  .refine(v => v !== undefined, `${label} الزامی است`)
  .refine(v => v === undefined || Number(v) > 0, positiveMessage);
const optionalPositiveRate = decimalInput('نرخ تسعیر').optional()
  .refine(v => v === undefined || Number(v) > 0, 'نرخ تسعیر باید بزرگتر از صفر باشد');
const treasuryCurrency = z.preprocess(
  normalizeTreasuryCurrency,
  z.enum(TREASURY_CURRENCIES, { message: 'ارز پشتیبانی نمی‌شود؛ یکی از ریال، دلار، یورو، درهم یا پوند را انتخاب کنید' }),
);

export const createBankAccountSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    title: z.string().min(1, 'عنوان حساب بانکی/صندوق الزامی است'),
    type: z.enum(['bank', 'cash', 'pos', 'petty_cash'], {
      message: 'نوع حساب باید bank، cash، pos یا petty_cash باشد'
    }).optional().default('bank'),
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    shabaNumber: z.string().optional(),
    shebaNumber: z.string().optional(),
    cardNumber: z.string().optional(),
    branch: z.string().optional(),
    currency: treasuryCurrency.optional().default('IRR'),
    initialBalance: decimalInput('موجودی اولیه').optional().transform(v => v ?? '0'),
    accountId: z.coerce.number().nullable().optional(),
    accountCode: z.string().optional(),
    accountName: z.string().optional(),
    notes: z.string().optional(),
  })
});

export const updateBankAccountSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه حساب باید عددی باشد')
  }),
  body: z.object({
    code: z.string().optional(),
    title: z.string().min(1, 'عنوان حساب الزامی است').optional(),
    type: z.enum(['bank', 'cash', 'pos', 'petty_cash']).optional(),
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    shabaNumber: z.string().optional(),
    shebaNumber: z.string().optional(),
    cardNumber: z.string().optional(),
    branch: z.string().optional(),
    currency: treasuryCurrency.optional(),
    initialBalance: decimalInput('موجودی اولیه').optional(),
    accountId: z.coerce.number().nullable().optional(),
    accountCode: z.string().optional(),
    accountName: z.string().optional(),
    notes: z.string().optional(),
  })
});

// v7.0.127 (TD-247): نوع حساب خزانه برای پیشنهاد کد (خالی = bank، مانند پیش)
export const nextBankCodeQuerySchema = z.object({
  query: z.object({
    type: z.preprocess(
      v => (v === '' ? undefined : v),
      z.enum(['bank', 'cash', 'pos', 'petty_cash'], { message: 'نوع حساب باید bank، cash، pos یا petty_cash باشد' }).optional()
    ),
  }).optional()
});

// Treasury Transactions (دریافت و پرداخت)
export const treasuryQuerySchema = z.object({
  query: z.object({
    type: z.enum(['receipt', 'payment', 'all']).optional(),
    bankAccountId: z.coerce.number().int().positive().optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    // v9.0.102 (TD-509): فیلترهای جدول صفحه خزانه در سرور؛ با page یا limit پاسخ یک صفحه است
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque', 'all']).optional(),
    q: z.string().max(200).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  }).optional()
});

export const createTreasuryTxSchema = z.object({
  body: z.object({
    type: z.enum(['receipt', 'payment'], { message: 'نوع عملیات باید دریافت یا پرداخت باشد' }),
    // TD-105: تاریخ اختیاری است — مقدار خالی با businessTodayIsoDate سرور پر می‌شود و بازه در سرویس اعتبارسنجی می‌شود
    date: z.string().optional(),
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque'], { message: 'روش پرداخت نامعتبر است' }),
    amount: positiveTreasuryAmount('مبلغ تراکنش', 'مبلغ تراکنش باید بزرگتر از صفر باشد'),
    currency: treasuryCurrency.optional().default('IRR'),
    exchangeRate: optionalPositiveRate,
    bankAccountId: z.coerce.number().int().positive('انتخاب حساب بانکی یا صندوق الزامی است'),
    partyType: z.enum(['customer', 'personnel', 'supplier', 'other']).optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().min(1, 'نام طرف حساب الزامی است'),
    trackingNumber: z.string().optional(),
    documentId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().optional(),
    createVoucher: z.boolean().optional(),
    attachments: z.array(z.any()).optional(),
    purpose: z.enum(['settlement', 'advance', 'other']).optional(),
    // v9.0.82 (TD-507): سرفصل طرف مقابل «متفرقه» و «سایر» پرسنل
    contraAccountId: z.coerce.number().int().positive().nullable().optional(),
  })
});

export const previewTreasurySchema = z.object({
  body: z.object({
    type: z.enum(['receipt', 'payment']),
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque']).optional(),
    amount: positiveTreasuryAmount('مبلغ تراکنش', 'مبلغ تراکنش باید مثبت باشد'),
    currency: treasuryCurrency.optional().default('IRR'),
    bankAccountId: z.coerce.number().int().positive('شناسه حساب بانکی الزامی است'),
    partyType: z.string().optional(),
    purpose: z.string().optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().optional(),
    contraAccountId: z.coerce.number().int().positive().nullable().optional(),
  })
});

export const transferSchema = z.object({
  body: z.object({
    // TD-105: تاریخ اختیاری است — مقدار خالی با businessTodayIsoDate سرور پر می‌شود و بازه در سرویس اعتبارسنجی می‌شود
    date: z.string().optional(),
    amount: positiveTreasuryAmount('مبلغ انتقال', 'مبلغ انتقال باید بزرگتر از صفر باشد'),
    currency: treasuryCurrency.optional().default('IRR'),
    exchangeRate: optionalPositiveRate,
    fromBankAccountId: z.coerce.number().int().positive('حساب مبدا الزامی است'),
    toBankAccountId: z.coerce.number().int().positive('حساب مقصد الزامی است'),
    trackingNumber: z.string().optional(),
    description: z.string().optional(),
    createVoucher: z.boolean().optional(),
  }).refine(data => data.fromBankAccountId !== data.toBankAccountId, {
    message: 'حساب مبدا و مقصد انتقال وجه نمی‌توانند یکسان باشند',
    path: ['toBankAccountId']
  })
});

// V1.6.0: ثبت گروهی وضعیت آشتی‌سنجی بانکی
export const reconcileSchema = z.object({
  body: z.object({
    bankAccountId: z.coerce.number().int().positive('شناسه حساب بانکی الزامی است'),
    txIds: z.array(z.coerce.number().int().positive('شناسه تراکنش نامعتبر است')).min(1, 'حداقل یک تراکنش باید انتخاب شود').max(2000),
    batch: z.string().optional().default(''),
    reconciled: z.boolean({ message: 'وضعیت آشتی‌سنجی باید بولی باشد' }),
  })
});

// V1.4.0: ابطال تراکنش خزانه با سند معکوس (DB-009)
/** v9.0.272 (TD-779): سند دریافت یا پرداخت خزانه؛ null یعنی «علی‌الحساب» */
/** v10.0.123 (TD-1122): سندهایی که ردیف خزانه به آن‌ها منتقل می‌شود */
export const treasuryRelinkOptionsSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تراکنش باید عددی باشد')
  }),
});

export const relinkTreasuryDocumentSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تراکنش باید عددی باشد')
  }),
  body: z.object({
    documentId: z.union([z.number().int().positive(), z.null()]),
  })
});

export const voidTreasuryTxSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تراکنش باید عددی باشد')
  }),
  body: z.object({
    reason: z.string().min(3, 'دلیل ابطال الزامی است و باید حداقل ۳ کاراکتر باشد'),
  })
});

// ==========================================
// CHEQUES (دفتر چک صیادی)
// ==========================================
export const chequesQuerySchema = z.object({
  query: z.object({
    type: z.enum(['received', 'paid', 'all']).optional(),
    status: z.enum(['pending', 'passed', 'cashed', 'returned', 'voided', 'bounced', 'all']).optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  }).optional()
});

export const createChequeSchema = z.object({
  body: z.object({
    type: z.enum(['received', 'paid'], { message: 'نوع چک باید دریافتی یا پرداختی باشد' }),
    // v8.0.108 (TD-385): ارقام فارسی و عربی شماره چک و شناسه صیادی لاتین می‌شوند (پیش‌تر صیادی فارسی رد و شماره فارسی ذخیره می‌شد)
    chequeNumber: latinDigitsString.pipe(z.string().min(1, 'شماره چک الزامی است')),
    sayadNumber: latinDigitsString.pipe(z.string().regex(/^\d{16}$/, 'شناسه صیادی چک باید دقیقاً ۱۶ رقم عددی باشد').or(z.literal(''))).optional(),
    bankName: z.string().min(1, 'نام بانک صادرکننده الزامی است'),
    branch: z.string().optional(),
    issueDate: z.string().min(1, 'تاریخ صدور الزامی است'),
    dueDate: z.string().min(1, 'تاریخ سررسید الزامی است'),
    amount: positiveTreasuryAmount('مبلغ چک', 'مبلغ چک باید بزرگتر از صفر باشد'),
    currency: treasuryCurrency.optional().default('IRR'),
    partyType: z.enum(['customer', 'personnel', 'supplier', 'other']).optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().min(1, 'نام طرف حساب الزامی است'),
    drawerName: z.string().optional(),
    payeeName: z.string().optional(),
    bankAccountId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().optional(),
    createVoucher: z.boolean().optional(),
    attachments: z.array(z.any()).optional(),
    // v9.0.84 (TD-497): هدف چک پرسنل و سرفصل طرف مقابل «متفرقه» و «سایر»
    purpose: z.enum(['settlement', 'advance', 'other']).optional(),
    contraAccountId: z.coerce.number().int().positive().nullable().optional(),
  })
});

export const updateChequeStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه چک باید عددی باشد')
  }),
  body: z.object({
    status: z.enum([
      'received',
      'in_treasury',
      'in_collection',
      'passed',
      'bounced',
      'returned',
      'spent',
      'in_safe',
      'pending',
      'cashed',
      'voided'
    ], {
      message: 'وضعیت چک نامعتبر است'
    }),
    actionDate: z.string().optional(),
    bankAccountId: z.coerce.number().int().positive().optional(),
    transfereePartyId: z.coerce.number().int().positive().optional(),
    notes: z.string().optional(),
    description: z.string().optional()
  })
});

export * from './reports.schemas.js';
