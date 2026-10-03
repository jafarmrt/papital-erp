/**
 * طرح‌های Zod مسیرهای حسابداری (src/routes/accounting/*.routes.ts).
 * از src/routes/accounting.routes.ts هم دوباره صادر می‌شوند تا واردکننده‌های قبلی تغییر نکنند.
 */
import { z } from 'zod';

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
    startDate: z.string().optional(),
    endDate: z.string().optional(),
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
  }).refine((data) => {
    const totalDebit = data.items.reduce((s, it) => s + (it.debit || 0), 0);
    const totalCredit = data.items.reduce((s, it) => s + (it.credit || 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  }, {
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
  }).refine((data) => {
    if (!data.items) return true;
    const totalDebit = data.items.reduce((s, it) => s + (it.debit || 0), 0);
    const totalCredit = data.items.reduce((s, it) => s + (it.credit || 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  }, {
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
  }).refine((data) => {
    const totalDebit = data.newItems.reduce((s, it) => s + (it.debit || 0), 0);
    const totalCredit = data.newItems.reduce((s, it) => s + (it.credit || 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  }, {
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

// Treasury Transactions (دریافت و پرداخت)
export const treasuryQuerySchema = z.object({
  query: z.object({
    type: z.enum(['receipt', 'payment', 'all']).optional(),
    bankAccountId: z.coerce.number().int().positive().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
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
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  }).optional()
});

export const createChequeSchema = z.object({
  body: z.object({
    type: z.enum(['received', 'paid'], { message: 'نوع چک باید دریافتی یا پرداختی باشد' }),
    chequeNumber: z.string().min(1, 'شماره چک الزامی است'),
    sayadNumber: z.string().regex(/^\d{16}$/, 'شناسه صیادی چک باید دقیقاً ۱۶ رقم عددی باشد').optional().or(z.literal('')),
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

// ==========================================
// REPORTS & FINANCIAL STATEMENTS
// ==========================================
// V1.6.0: گزارش جریان نقدی خزانه
export const dateRangeQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional()
  }).optional()
});

export const trialBalanceQuerySchema = z.object({
  query: z.object({
    level: z.enum(['group', 'general', 'subsidiary', 'detailed']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const accountCardQuerySchema = z.object({
  query: z.object({
    accountId: z.coerce.number().int().positive().optional(),
    detailedType: z.enum(['none', 'customer', 'personnel', 'project', 'bank_account', 'other', 'supplier']).optional(),
    detailedId: z.coerce.number().int().positive().optional(),
    detailedName: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const partyLedgerQuerySchema = z.object({
  query: z.object({
    partyId: z.coerce.number().int().positive().optional(),
    partyType: z.string().optional(),
    partyName: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
    includeDrafts: z.string().optional(),
  }).optional()
});

export const journalBookQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    search: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const financialRatiosQuerySchema = z.object({
  query: z.object({
    asOfDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const incomeStatementQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

export const balanceSheetQuerySchema = z.object({
  query: z.object({
    date: z.string().optional(),
    asOfDate: z.string().optional(),
    currency: z.string().optional(),
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
    closingDate: z.string().min(1, 'تاریخ سند اختتامیه الزامی است'),
    openingDateNewYear: z.string().optional(),
  })
});

export const fiscalClosingExecuteSchema = z.object({
  body: z.object({
    year: z.string().min(1, 'سال مالی الزامی است'),
    closingDate: z.string().min(1, 'تاریخ سند بستن سال الزامی است'),
    openingDateNewYear: z.string().optional(),
    createOpeningVoucher: z.boolean().optional(),
  })
});
