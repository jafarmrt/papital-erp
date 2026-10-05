/**
 * طرح‌های Zod مسیرهای حسابداری (src/routes/accounting/*.routes.ts).
 * از src/routes/accounting.routes.ts هم دوباره صادر می‌شوند تا واردکننده‌های قبلی تغییر نکنند.
 * طرح‌های کوئری گزارش‌ها و بستن سال مالی در reports.schemas.ts هستند و از همین فایل دوباره صادر می‌شوند.
 */
import { z } from 'zod';
import { computeVoucherBalance, VOUCHER_BALANCE_TOLERANCE, type VoucherBalanceRow } from '../../lib/voucherBalance.js';
import { DEFAULT_ACCOUNT_MAPPINGS, type ConceptualAccountMappingConfig } from '../../services/accounting/accountMapping.service.js';
import { latinDigitsString, storageDateParam } from '../../middleware/validate.js';

/** query پس از validate: میدل‌ور validate مقدار req.query را با خروجی parse شده Zod جایگزین می‌کند. */
export type ValidatedQuery<S extends z.ZodTypeAny> = z.infer<S> extends { query?: infer Q } ? Partial<NonNullable<Q>> : never;

// ==========================================
// CHART OF ACCOUNTS (کدینگ حساب‌ها)
// ==========================================
export const createAccountSchema = z.object({
  body: z.object({
    code: z.string().min(1, 'کد حساب الزامی است'),
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
 * `code` را فرم کدینگ هم می‌فرستد ولی سرویس آن را تغییر نمی‌دهد؛ مانند پیش پذیرفته و نادیده گرفته می‌شود.
 */
export const updateAccountSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[1-9]\d*$/, 'شناسه حساب باید عدد صحیح مثبت باشد')
  }),
  body: z.object({
    code: z.string().optional(),
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

export const voucherItemSchema = z.object({
  accountId: z.coerce.number().int().positive('شناسه حساب الزامی و باید عدد مثبت باشد'),
  detailedType: z.enum(['none', 'customer', 'personnel', 'project', 'bank_account', 'other', 'supplier']).optional().default('none'),
  detailedId: z.coerce.number().int().positive().nullable().optional(),
  detailedName: z.string().optional(),
  debit: z.coerce.number().min(0, 'مبلغ بدهکار نمی‌تواند منفی باشد').default(0),
  credit: z.coerce.number().min(0, 'مبلغ بستانکار نمی‌تواند منفی باشد').default(0),
  currency: z.string().optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  description: z.string().optional(),
}).refine(it => (it.debit > 0 || it.credit > 0), {
  message: 'هر ردیف سند باید حداقل دارای مبلغ بدهکار یا بستانکار بزرگتر از صفر باشد'
});

/**
 * v7.0.127 (TD-247): تراز سند در طرح Zod با جمع اعشاری (computeVoucherBalance) و همان آستانه سرویس
 * (VOUCHER_BALANCE_TOLERANCE؛ VoucherService اختلاف بیشتر از آن را رد می‌کند).
 */
const isVoucherBalanced = (rows: readonly VoucherBalanceRow[]): boolean => {
  const balance = computeVoucherBalance(rows);
  return balance.totalDebit > 0 && balance.difference <= VOUCHER_BALANCE_TOLERANCE;
};

export const createVoucherSchema = z.object({
  body: z.object({
    date: z.string().min(1, 'تاریخ سند الزامی است'),
    voucherType: z.enum(['general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment', 'settlement']).optional().default('general'),
    status: z.enum(['draft', 'approved']).optional(),
    manualVoucherNumber: z.string().optional(),
    description: z.string().min(1, 'شرح کلی سند الزامی است'),
    referenceModule: z.enum(['manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory']).optional().default('manual'),
    referenceId: z.coerce.number().int().positive().nullable().optional(),
    referenceNumber: z.string().optional(),
    currency: z.string().optional(),
    attachments: z.array(z.any()).optional(),
    items: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند دوبل الزامی است')
  }).refine((data) => isVoucherBalanced(data.items), {
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
    voucherType: z.enum(['general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment', 'settlement']).optional(),
    currency: z.string().optional(),
    attachments: z.array(z.any()).optional(),
    items: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند دوبل الزامی است').optional(),
  }).refine((data) => !data.items || isVoucherBalanced(data.items), {
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
  }).refine((data) => isVoucherBalanced(data.newItems), {
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
    currency: z.string().optional().default('IRR'),
    initialBalance: z.coerce.number().default(0),
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
    currency: z.string().optional(),
    initialBalance: z.coerce.number().optional(),
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
    amount: z.coerce.number().positive('مبلغ تراکنش باید بزرگتر از صفر باشد'),
    currency: z.string().optional().default('IRR'),
    exchangeRate: z.coerce.number().positive().optional(),
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
  })
});

export const previewTreasurySchema = z.object({
  body: z.object({
    type: z.enum(['receipt', 'payment']),
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque']).optional(),
    amount: z.coerce.number().positive('مبلغ تراکنش باید مثبت باشد'),
    currency: z.string().optional().default('IRR'),
    bankAccountId: z.coerce.number().int().positive('شناسه حساب بانکی الزامی است'),
    partyType: z.string().optional(),
    purpose: z.string().optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().optional(),
  })
});

export const transferSchema = z.object({
  body: z.object({
    // TD-105: تاریخ اختیاری است — مقدار خالی با businessTodayIsoDate سرور پر می‌شود و بازه در سرویس اعتبارسنجی می‌شود
    date: z.string().optional(),
    amount: z.coerce.number().positive('مبلغ انتقال باید بزرگتر از صفر باشد'),
    currency: z.string().optional().default('IRR'),
    exchangeRate: z.coerce.number().positive().optional(),
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
    amount: z.coerce.number().positive('مبلغ چک باید بزرگتر از صفر باشد'),
    currency: z.string().optional().default('IRR'),
    partyType: z.enum(['customer', 'personnel', 'supplier', 'other']).optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().min(1, 'نام طرف حساب الزامی است'),
    drawerName: z.string().optional(),
    payeeName: z.string().optional(),
    bankAccountId: z.coerce.number().int().positive().nullable().optional(),
    description: z.string().optional(),
    createVoucher: z.boolean().optional(),
    attachments: z.array(z.any()).optional(),
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
    transfereePartyName: z.string().optional(),
    notes: z.string().optional(),
    description: z.string().optional()
  })
});

export * from './reports.schemas.js';
