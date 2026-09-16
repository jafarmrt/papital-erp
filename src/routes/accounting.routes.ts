import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { AccountingService } from '../services/accounting.service.js';
import { AccountMappingService } from '../services/accounting/accountMapping.service.js';
import { logActivity } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { BadRequestError, NotFoundError } from '../errors/customErrors.js';
import { orm } from '../db/drizzle.js';
import { sql, eq, and } from 'drizzle-orm';
import { documents, journalVouchers, productionProjects, workflowInstances, workflowHistoryLogs, workflowStates } from '../db/schema.js';

const router = Router();
router.use(authenticateToken); // Protect all accounting routes

// ==========================================
// 1. STATS & OVERVIEW
// ==========================================
const getStatsHandler = asyncHandler(async (req, res) => {
  const stats = await AccountingService.getFinancialOverviewStats();
  res.json({ stats, ...stats });
});
router.get('/accounting/stats', authorizePermission('accounting.view'), getStatsHandler);
router.get('/accounting/summary', authorizePermission('accounting.view'), getStatsHandler);

// ==========================================
// 2. CHART OF ACCOUNTS (کدینگ حساب‌ها)
// ==========================================
router.get('/accounting/accounts', authorizePermission('accounting.coa', 'accounting.vouchers', 'accounting.treasury', 'accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const data = await AccountingService.getAllAccounts();
  res.json(data);
}));

router.get('/accounting/accounts/tree', authorizePermission('accounting.coa', 'accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const tree = await AccountingService.getAccountsTree();
  res.json(tree);
}));

const seedAccountsHandler = asyncHandler(async (req, res) => {
  const result = await AccountingService.seedStandardAccounts();
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.fullName || '',
    action: 'SEED',
    entity: 'حسابداری:کدینگ_پیش‌فرض',
    description: 'استقرار و همگام‌سازی ساختار کدینگ استاندارد حساب‌ها',
    details: result,
    ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
  });
  res.json({ message: 'کدینگ استاندارد حساب‌ها با موفقیت مستقر و همگام شد', ...result });
});
router.post('/accounting/accounts/seed-default', authorize('admin'), seedAccountsHandler);
router.post('/accounting/accounts/seed-standard', authorize('admin'), seedAccountsHandler);

const createAccountSchema = z.object({
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

router.post('/accounting/accounts', authorizePermission('accounting.coa'), validate(createAccountSchema), asyncHandler(async (req, res) => {
  const account = await AccountingService.createAccount(req.body);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'account',
    entityId: String(account.id),
    description: `تعریف حساب جدید: ${account.name} (کد: ${account.code})`,
    details: { account },
    ipAddress: req.ip || '',
  });
  res.status(201).json(account);
}));

router.put('/accounting/accounts/:id', authorizePermission('accounting.coa'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await AccountingService.updateAccount(id, req.body);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'account',
    entityId: String(id),
    description: `ویرایش حساب: ${updated.name} (کد: ${updated.code})`,
    details: { changes: req.body },
    ipAddress: req.ip || '',
  });
  res.json(updated);
}));

router.delete('/accounting/accounts/:id', authorizePermission('accounting.coa'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await AccountingService.deleteAccount(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'account',
    entityId: String(id),
    description: `حذف حساب با شناسه ${id}`,
    details: { id },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

// ==========================================
// 2.1 ACCOUNT MAPPINGS (نگاشت مفهومی سرفصل‌های حسابداری)
// ==========================================
router.get('/accounting/mappings', authorizePermission('accounting.coa', 'accounting.view'), asyncHandler(async (req, res) => {
  // V1.7.0: متادیتای کامل — مپینگ‌ها + غیرفعال‌ها + وضعیت کدینگ (برای دکمه همگام‌سازی شرطی)
  const mappings = await AccountingService.getAccountMappings();
  const meta = await AccountMappingService.getMappingsWithMeta();
  res.json({
    ...mappings,
    disabled: meta.disabled,
    accountsCount: meta.accountsCount,
    chartHasAccounts: meta.chartHasAccounts,
  });
}));

router.post('/accounting/mappings', authorizePermission('accounting.coa'), asyncHandler(async (req, res) => {
  const { disabled, ...mappings } = req.body || {};
  const updated = await AccountingService.saveAccountMappings(mappings || {});
  if (Array.isArray(disabled)) {
    await AccountMappingService.setDisabledMappings(disabled);
  }
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'حسابداری:نگاشت_مفهومی_سرفصل‌ها',
    description: 'به‌روزرسانی تنظیمات نگاشت مفهومی حساب‌ها و سرفصل‌های پیش‌فرض',
    details: { changes: req.body, result: updated, disabled: disabled || [] },
    ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
  });
  res.json({ message: 'تنظیمات نگاشت سرفصل‌ها با موفقیت ذخیره شد', data: updated, disabled: disabled || [] });
}));

// ==========================================
// 3. JOURNAL VOUCHERS (اسناد حسابداری)
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

router.get('/accounting/vouchers', authorizePermission('accounting.vouchers', 'accounting.reports', 'accounting.view'), validate(vouchersQuerySchema), asyncHandler(async (req, res) => {
  const { page, limit, search, status, voucherType, startDate, endDate } = (req.query as any) || {};
  const result = await AccountingService.getJournalVouchers({
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
    search: search as string,
    status: status as string,
    voucherType: voucherType as string,
    startDate: startDate as string,
    endDate: endDate as string,
  });
  res.json(result);
}));

router.get('/accounting/vouchers/:id', authorizePermission('accounting.vouchers', 'accounting.reports', 'accounting.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const voucher = await AccountingService.getJournalVoucherById(id);
  if (!voucher) throw new NotFoundError('سند حسابداری یافت نشد');
  res.json(voucher);
}));

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

router.post('/accounting/vouchers', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(createVoucherSchema), asyncHandler(async (req, res) => {
  const voucher = await AccountingService.createJournalVoucher({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'journal_voucher',
    entityId: String(voucher.id),
    description: `صدور سند حسابداری شماره ${voucher.voucherNumber} (مبلغ: ${voucher.totalDebit.toLocaleString('fa-IR')})`,
    details: { voucherNumber: voucher.voucherNumber, totalDebit: voucher.totalDebit },
    ipAddress: req.ip || '',
  });
  res.status(201).json(voucher);
}));

router.put('/accounting/vouchers/:id', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(updateVoucherSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const voucher = await AccountingService.updateJournalVoucher(id, req.body);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `ویرایش سند حسابداری شماره ${voucher.voucherNumber}`,
    details: { changes: req.body },
    ipAddress: req.ip || '',
  });
  res.json(voucher);
}));

router.delete('/accounting/vouchers/:id', authorizePermission('accounting.vouchers'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await AccountingService.deleteJournalVoucher(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `حذف سند حسابداری با شناسه ${id}`,
    details: { id },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

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

router.post('/accounting/vouchers/:id/reverse', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(reverseVoucherSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { date, reason } = req.body;
  const reversalVoucher = await AccountingService.reverseVoucher({
    voucherId: id,
    date,
    reason,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'journal_voucher',
    entityId: String(reversalVoucher.id),
    description: `صدور سند معکوس شماره #${reversalVoucher.voucherNumber} برای سند شماره #${id}${reason ? ` (علت: ${reason})` : ''}`,
    details: { originalVoucherId: id, reversalVoucherId: reversalVoucher.id, reason },
    ipAddress: req.ip || '',
  });

  res.status(201).json({
    message: `سند معکوس شماره #${reversalVoucher.voucherNumber} با موفقیت صادر گردید.`,
    voucher: reversalVoucher
  });
}));

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

router.post('/accounting/vouchers/:id/correct', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(correctVoucherSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { date, reason, newItems, newDescription } = req.body;
  const result = await AccountingService.correctVoucher({
    voucherId: id,
    date,
    reason,
    newItems,
    newDescription,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `اصلاح سند شماره #${id} با صدور سند عکس #${result.reversalVoucher.voucherNumber} و سند جدید #${result.correctedVoucher.voucherNumber} (علت: ${reason})`,
    details: {
      originalVoucherId: id,
      reversalVoucherId: result.reversalVoucher.id,
      correctedVoucherId: result.correctedVoucher.id,
      reason
    },
    ipAddress: req.ip || '',
  });

  res.status(201).json(result);
}));

// Repost Voucher Route (سند ابطال و بازثبت / Repost)
export const repostVoucherSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه سند باید عددی باشد')
  }),
  body: z.object({
    date: z.string().min(1, 'تاریخ سند الزامی است').optional(),
    reason: z.string().min(1, 'علت ابطال و بازثبت سند الزامی است'),
    newDescription: z.string().optional(),
    newManualVoucherNumber: z.string().optional(),
    newItems: z.array(voucherItemSchema).min(2, 'حداقل دو ردیف برای سند جدید الزامی است')
  }).refine((data) => {
    const totalDebit = data.newItems.reduce((s, it) => s + (it.debit || 0), 0);
    const totalCredit = data.newItems.reduce((s, it) => s + (it.credit || 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  }, {
    message: 'سند جدید تراز نیست؛ مجموع مبالغ بدهکار و بستانکار باید برابر و بزرگتر از صفر باشند',
    path: ['newItems']
  })
});

router.post('/accounting/vouchers/:id/repost', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(repostVoucherSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { date, reason, newItems, newDescription, newManualVoucherNumber } = req.body;
  const result = await AccountingService.repostVoucher({
    voucherId: id,
    date,
    reason,
    newItems,
    newDescription,
    newManualVoucherNumber,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `ابطال و بازثبت سند شماره #${id} با صدور سند ابطال #${result.voidVoucher.voucherNumber} و سند جدید #${result.repostedVoucher.voucherNumber} (علت: ${reason})`,
    details: {
      originalVoucherId: id,
      voidVoucherId: result.voidVoucher.id,
      repostedVoucherId: result.repostedVoucher.id,
      reason
    },
    ipAddress: req.ip || '',
  });

  res.status(201).json(result);
}));

// Finalize Voucher Route (قطعی‌سازی و تبدیل به دائم)
router.post('/accounting/vouchers/:id/finalize', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const finalized = await AccountingService.finalizeJournalVoucher(
    id,
    req.user?.id,
    req.user?.fullName || req.user?.username
  );

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `قطعی‌سازی و تبدیل سند شماره #${finalized.voucherNumber} به سند دائم`,
    details: { id, status: 'permanent' },
    ipAddress: req.ip || '',
  });

  res.json({ message: `سند شماره #${finalized.voucherNumber} با موفقیت قطعی و دائم شد.`, voucher: finalized });
}));

// Batch Finalize Vouchers
export const batchFinalizeVouchersSchema = z.object({
  body: z.object({
    ids: z.array(z.coerce.number().int().positive('شناسه سند نامعتبر است')).min(1, 'حداقل یک سند باید انتخاب شود')
  })
});

router.post('/accounting/vouchers/batch-finalize', authorizePermission('accounting.vouchers'), validate(batchFinalizeVouchersSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const result = await AccountingService.finalizeJournalVouchers(
    ids,
    req.user?.id,
    req.user?.fullName || req.user?.username
  );

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: ids.join(','),
    description: `قطعی‌سازی گروهی ${result.finalizedCount} سند حسابداری`,
    details: { ids, count: result.finalizedCount },
    ipAddress: req.ip || '',
  });

  res.json({ message: `${result.finalizedCount} سند با موفقیت قطعی و دائم شدند.`, ...result });
}));

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

router.put('/accounting/vouchers/:id/status', authorizePermission('accounting.vouchers'), validate(setVoucherStatusSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, reason } = req.body;

  const existing = await AccountingService.getJournalVoucherById(id);
  if (!existing) throw new NotFoundError('سند حسابداری یافت نشد');

  const updated = await AccountingService.setVoucherStatus(id, status, req.user?.id);

  const statusLabels: Record<string, string> = {
    draft: 'پیش‌نویس (یادداشت اولیه)',
    approved: 'تایید شده (حسابرسی‌شده)',
    permanent: 'دائم و قطعی (قفل دفاتر)'
  };

  const prevText = statusLabels[existing.status] || existing.status;
  const newText = statusLabels[status] || status;
  const reasonText = reason?.trim() ? ` (علت: ${reason.trim()})` : '';

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `تغییر وضعیت سند حسابداری شماره #${updated.voucherNumber} از «${prevText}» به «${newText}»${reasonText}`,
    details: { id, previousStatus: existing.status, newStatus: status, reason },
    ipAddress: req.ip || '',
  });

  res.json(updated);
}));


// Auto-voucher manual triggers
router.post('/accounting/vouchers/auto/invoice/:id', authorizePermission('accounting.vouchers'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const v = await AccountingService.autoCreateVoucherForInvoice(docId, req.user?.id, req.user?.fullName || req.user?.username, undefined, { strict: true });
  if (!v) {
    throw new BadRequestError('امکان صدور خودکار سند برای این فاکتور وجود ندارد (یا قبلاً صادر شده یا نهایی نیست)');
  }
  res.json({ message: `سند شماره ${v.voucherNumber} با موفقیت صادر شد`, voucher: v });
}));

router.post('/accounting/vouchers/auto/payroll/:id', authorizePermission('accounting.vouchers'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const payrollId = Number(req.params.id);
  const v = await AccountingService.autoCreateVoucherForPayroll(payrollId, req.user?.id, req.user?.fullName || req.user?.username, undefined, { strict: true });
  if (!v) {
    throw new BadRequestError('امکان صدور سند خودکار برای این فیش حقوقی وجود ندارد');
  }
  res.json({ message: `سند حقوق شماره ${v.voucherNumber} با موفقیت صادر شد`, voucher: v });
}));

// ==========================================
// 4. BANK ACCOUNTS & TREASURY
// ==========================================
const getBanksHandler = asyncHandler(async (req, res) => {
  const list = await AccountingService.getBankAccounts();
  res.json(list);
});
router.get('/accounting/banks', authorizePermission('accounting.treasury', 'accounting.cheques', 'accounting.vouchers', 'accounting.reports', 'accounting.view', 'warehouse.in', 'warehouse.out', 'documents.view', 'documents.create'), getBanksHandler);
router.get('/accounting/bank-accounts', authorizePermission('accounting.treasury', 'accounting.cheques', 'accounting.vouchers', 'accounting.reports', 'accounting.view', 'warehouse.in', 'warehouse.out', 'documents.view', 'documents.create'), getBanksHandler);

// Dynamic Bank & Ledger Synchronization and Reconciliation
const syncBanksHandler = asyncHandler(async (req, res) => {
  const report = await AccountingService.recalculateAndSyncBankBalances();
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'bank_reconciliation',
    entityId: 'sync',
    description: `همگام‌سازی و تطبیق مانده حساب‌های بانکی با دفاتر اسناد دوبل (${report.syncedCount} حساب همگام، ${report.discrepantCount} مغایرت)`,
    details: { report },
    ipAddress: req.ip || '',
  });
  res.json({ message: 'عملیات تطبیق و همگام‌سازی با دفاتر اسناد دوبل با موفقیت انجام شد', report });
});
router.post('/accounting/banks/sync-reconcile', authorizePermission('accounting.treasury'), syncBanksHandler);
router.post('/accounting/bank-accounts/sync-reconcile', authorizePermission('accounting.treasury'), syncBanksHandler);

const reportBanksHandler = asyncHandler(async (req, res) => {
  const banks = await AccountingService.getBankAccounts();
  let syncedCount = 0;
  let discrepantCount = 0;
  let unlinkedCount = 0;
  let totalCashAndBankLedger = 0;
  let totalCashAndBankTreasury = 0;
  let totalDiscrepancy = 0;

  for (const bank of banks) {
    totalCashAndBankLedger += (bank.ledgerBalance || 0);
    totalCashAndBankTreasury += (bank.treasuryBalance || 0);
    totalDiscrepancy += (bank.discrepancy || 0);

    if (bank.syncStatus === 'synced') syncedCount++;
    else if (bank.syncStatus === 'discrepant') discrepantCount++;
    else unlinkedCount++;
  }

  res.json({
    report: {
      syncedCount,
      discrepantCount,
      unlinkedCount,
      totalCashAndBankLedger,
      totalCashAndBankTreasury,
      totalDiscrepancy,
      accounts: banks.map(b => ({
        id: b.id,
        code: b.code,
        title: b.title,
        type: b.type,
        accountCode: b.accountCode,
        accountName: b.accountName,
        initialBalance: b.initialBalance || 0,
        ledgerBalance: b.ledgerBalance || 0,
        treasuryBalance: b.treasuryBalance || 0,
        currentBalance: b.currentBalance || 0,
        totalDebit: b.totalDebit || 0,
        totalCredit: b.totalCredit || 0,
        discrepancy: b.discrepancy || 0,
        syncStatus: b.syncStatus || 'synced',
        notes: b.notes,
      }))
    }
  });
});
router.get('/accounting/banks/reconciliation-report', authorizePermission('accounting.treasury'), reportBanksHandler);
router.get('/accounting/bank-accounts/reconciliation-report', authorizePermission('accounting.treasury'), reportBanksHandler);

export const createBankAccountSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان حساب بانکی/صندوق الزامی است'),
    type: z.enum(['bank', 'cash', 'petty_cash'], {
      message: 'نوع حساب باید bank، cash یا petty_cash باشد'
    }).optional().default('bank'),
    accountNumber: z.string().optional(),
    shabaNumber: z.string().optional(),
    cardNumber: z.string().optional(),
    branch: z.string().optional(),
    currency: z.string().optional().default('IRR'),
    initialBalance: z.coerce.number().default(0),
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
    title: z.string().min(1, 'عنوان حساب الزامی است').optional(),
    type: z.enum(['bank', 'cash', 'petty_cash']).optional(),
    accountNumber: z.string().optional(),
    shabaNumber: z.string().optional(),
    cardNumber: z.string().optional(),
    branch: z.string().optional(),
    currency: z.string().optional(),
    initialBalance: z.coerce.number().optional(),
    accountCode: z.string().optional(),
    accountName: z.string().optional(),
    notes: z.string().optional(),
  })
});

const createBankHandler = asyncHandler(async (req, res) => {
  const bank = await AccountingService.createBankAccount({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'bank_account',
    entityId: String(bank.id),
    description: `تعریف حساب بانکی/صندوق جدید: ${bank.title}`,
    details: { bank },
    ipAddress: req.ip || '',
  });
  res.status(201).json(bank);
});
router.post('/accounting/banks', authorizePermission('accounting.treasury'), validate(createBankAccountSchema), createBankHandler);
router.post('/accounting/bank-accounts', authorizePermission('accounting.treasury'), validate(createBankAccountSchema), createBankHandler);

const updateBankHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  // V1.4.0: snapshot قبل برای audit
  const before = (await AccountingService.getBankAccounts()).find(b => b.id === id) || null;
  const updated = await AccountingService.updateBankAccount(id, {
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'bank_account',
    entityId: String(id),
    description: `ویرایش حساب بانکی/صندوق: ${updated.title}`,
    details: { before, after: updated },
    ipAddress: req.ip || '',
  });
  res.json(updated);
});
router.put('/accounting/banks/:id', authorizePermission('accounting.treasury'), validate(updateBankAccountSchema), updateBankHandler);
router.put('/accounting/bank-accounts/:id', authorizePermission('accounting.treasury'), validate(updateBankAccountSchema), updateBankHandler);

const deleteBankHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = (await AccountingService.getBankAccounts()).find(b => b.id === id) || null;
  const result = await AccountingService.deleteBankAccount(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'bank_account',
    entityId: String(id),
    description: `حذف حساب بانکی/صندوق: ${before?.title || id}`,
    details: { before },
    ipAddress: req.ip || '',
  });
  res.json(result);
});
router.delete('/accounting/banks/:id', authorizePermission('accounting.treasury'), validate(paramsIdSchema), deleteBankHandler);
router.delete('/accounting/bank-accounts/:id', authorizePermission('accounting.treasury'), validate(paramsIdSchema), deleteBankHandler);

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

router.get('/accounting/treasury', authorizePermission('accounting.treasury', 'accounting.reports', 'accounting.view'), validate(treasuryQuerySchema), asyncHandler(async (req, res) => {
  const { type, bankAccountId, startDate, endDate } = (req.query as any) || {};
  const list = await AccountingService.getTreasuryTransactions({
    type: type as any,
    bankAccountId: bankAccountId ? Number(bankAccountId) : undefined,
    startDate: startDate as string,
    endDate: endDate as string,
  });
  res.json(list);
}));

export const createTreasuryTxSchema = z.object({
  body: z.object({
    type: z.enum(['receipt', 'payment'], { message: 'نوع عملیات باید دریافت یا پرداخت باشد' }),
    date: z.string().min(1, 'تاریخ تراکنش الزامی است'),
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

// V1.4.0: Idempotency — retry همین درخواست هرگز دوبار وجه ثبت نمی‌کند
router.post('/accounting/treasury', authorizePermission('accounting.treasury'), idempotency({ scope: 'treasury' }), validate(createTreasuryTxSchema), asyncHandler(async (req, res) => {
  const tx = await AccountingService.createTreasuryTransaction({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'treasury_transaction',
    entityId: String(tx.id),
    description: `ثبت ${tx.type === 'receipt' ? 'دریافت' : 'پرداخت'} شماره ${tx.transactionNumber} به مبلغ ${tx.amount.toLocaleString('fa-IR')}`,
    details: { tx },
    ipAddress: req.ip || '',
  });
  res.status(201).json(tx);
}));

export const previewTreasurySchema = z.object({
  body: z.object({
    type: z.enum(['receipt', 'payment']),
    amount: z.coerce.number().positive('مبلغ تراکنش باید مثبت باشد'),
    currency: z.string().optional().default('IRR'),
    bankAccountId: z.coerce.number().int().positive('شناسه حساب بانکی الزامی است'),
    partyType: z.string().optional(),
    purpose: z.string().optional(),
    partyId: z.coerce.number().int().positive().nullable().optional(),
    partyName: z.string().optional(),
  })
});

router.post('/accounting/treasury/preview-voucher', authorizePermission('accounting.treasury'), validate(previewTreasurySchema), asyncHandler(async (req, res) => {
  const preview = await AccountingService.previewTreasuryVoucher(req.body);
  res.json(preview);
}));

export const transferSchema = z.object({
  body: z.object({
    date: z.string().min(1, 'تاریخ انتقال وجه الزامی است'),
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

router.post('/accounting/treasury/transfer', authorizePermission('accounting.treasury'), idempotency({ scope: 'treasury' }), validate(transferSchema), asyncHandler(async (req, res) => {
  const result = await AccountingService.createTreasuryTransfer({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'treasury_transfer',
    entityId: `${result.payment.id}/${result.receipt.id}`,
    description: `انتقال وجه ${req.body.amount.toLocaleString('fa-IR')} بین حساب‌ها (سند ${result.voucherId || 'بدون سند'})`,
    details: { paymentId: result.payment.id, receiptId: result.receipt.id, voucherId: result.voucherId },
    ipAddress: req.ip || '',
  });
  res.status(201).json(result);
}));

// V1.6.0: گزارش جریان نقدی خزانه
export const dateRangeQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional()
  }).optional()
});

router.get('/accounting/reports/cash-flow', authorizePermission('accounting.reports', 'accounting.treasury', 'accounting.view'), validate(dateRangeQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate } = (req.query as any) || {};
  const report = await AccountingService.getCashFlowReport({
    startDate: startDate as string,
    endDate: endDate as string,
  });
  res.json(report);
}));

// V1.6.0: آشتی‌سنجی دفتر چک صیادی با دفاتر دوبل
router.get('/accounting/reports/cheque-reconciliation', authorizePermission('accounting.reports', 'accounting.treasury', 'accounting.cheques', 'accounting.view'), asyncHandler(async (req, res) => {
  const rows = await AccountingService.getChequeReconciliationReport();
  res.json(rows);
}));

// V1.6.0: ثبت گروهی وضعیت آشتی‌سنجی بانکی
export const reconcileSchema = z.object({
  body: z.object({
    bankAccountId: z.coerce.number().int().positive('شناسه حساب بانکی الزامی است'),
    txIds: z.array(z.coerce.number().int().positive('شناسه تراکنش نامعتبر است')).min(1, 'حداقل یک تراکنش باید انتخاب شود').max(2000),
    batch: z.string().optional().default(''),
    reconciled: z.boolean({ message: 'وضعیت آشتی‌سنجی باید بولی باشد' }),
  })
});

router.post('/accounting/treasury/reconcile', authorizePermission('accounting.treasury'), validate(reconcileSchema), asyncHandler(async (req, res) => {
  const { bankAccountId, txIds, batch, reconciled } = req.body;
  const result = await AccountingService.reconcileTransactions({
    bankAccountId,
    txIds,
    batch: batch || `stmt-${Date.now()}`,
    reconciled,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: reconciled ? 'UPDATE' : 'UPDATE',
    entity: 'treasury_reconciliation',
    entityId: String(bankAccountId),
    description: `${reconciled ? 'آشتی‌سنجی' : 'لغو آشتی‌سنجی'} ${txIds.length} تراکنش حساب بانکی شناسه ${bankAccountId}`,
    details: { bankAccountId, txIds, batch, reconciled },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

// V1.4.0: ابطال تراکنش خزانه با سند معکوس (DB-009)
export const voidTreasuryTxSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه تراکنش باید عددی باشد')
  }),
  body: z.object({
    reason: z.string().min(3, 'دلیل ابطال الزامی است و باید حداقل ۳ کاراکتر باشد'),
  })
});

router.post('/accounting/treasury/:id/void', authorizePermission('accounting.treasury'), validate(voidTreasuryTxSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const reversal = await AccountingService.voidTreasuryTransaction(id, {
    reason: req.body.reason,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'treasury_transaction',
    entityId: String(id),
    description: `ابطال تراکنش شناسه ${id} با سند معکوس ${reversal.transactionNumber} — دلیل: ${req.body.reason}`,
    details: { voidedTxId: id, reversalTxId: reversal.id, reason: req.body.reason },
    ipAddress: req.ip || '',
  });
  res.json(reversal);
}));

// ==========================================
// 5. CHEQUES (دفتر چک صیادی)
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

router.get('/accounting/cheques', authorizePermission('accounting.cheques', 'accounting.treasury', 'accounting.reports', 'accounting.view'), validate(chequesQuerySchema), asyncHandler(async (req, res) => {
  const { type, status, startDate, endDate, search } = (req.query as any) || {};
  const list = await AccountingService.getCheques({
    type: type as any,
    status: status as string,
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
  });
  res.json(list);
}));

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

router.post('/accounting/cheques', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(createChequeSchema), asyncHandler(async (req, res) => {
  const chq = await AccountingService.createCheque({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'cheque',
    entityId: String(chq.id),
    description: `ثبت چک ${chq.type === 'received' ? 'دریافتی' : 'پرداختی'} شماره ${chq.chequeNumber} (مبلغ: ${chq.amount.toLocaleString('fa-IR')})`,
    details: { chq },
    ipAddress: req.ip || '',
  });
  res.status(201).json(chq);
}));

export const updateChequeStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه چک باید عددی باشد')
  }),
  body: z.object({
    status: z.enum(['pending', 'passed', 'cashed', 'returned', 'voided', 'bounced'], {
      message: 'وضعیت چک نامعتبر است'
    }),
    actionDate: z.string().optional(),
    bankAccountId: z.coerce.number().int().positive().optional(),
    notes: z.string().optional()
  })
});

const updateChequeStatusHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const chq = await AccountingService.updateChequeStatus(id, {
    status: req.body.status,
    actionDate: req.body.actionDate,
    bankAccountId: req.body.bankAccountId,
    notes: req.body.notes,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'cheque',
    entityId: String(id),
    description: `تغییر وضعیت چک شماره ${chq.chequeNumber} به ${chq.status}`,
    details: { status: chq.status },
    ipAddress: req.ip || '',
  });
  res.json(chq);
});
router.put('/accounting/cheques/:id/status', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(updateChequeStatusSchema), updateChequeStatusHandler);
router.patch('/accounting/cheques/:id/status', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(updateChequeStatusSchema), updateChequeStatusHandler);

router.delete('/accounting/cheques/:id', authorizePermission('accounting.cheques'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await AccountingService.deleteCheque(id, {
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'cheque',
    entityId: String(id),
    description: `حذف چک شناسه ${id}`,
    details: { chequeId: id },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

// ==========================================
// 6. REPORTS & FINANCIAL STATEMENTS
// ==========================================
export const trialBalanceQuerySchema = z.object({
  query: z.object({
    level: z.enum(['group', 'general', 'subsidiary', 'detailed']).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

router.get('/accounting/reports/trial-balance', authorizePermission('accounting.reports', 'accounting.view'), validate(trialBalanceQuerySchema), asyncHandler(async (req, res) => {
  const { level, startDate, endDate, currency } = (req.query as any) || {};
  const data = await AccountingService.getTrialBalance({
    level: level as any,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

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

const accountCardReportHandler = asyncHandler(async (req, res) => {
  const { accountId, detailedType, detailedId, detailedName, startDate, endDate, currency } = (req.query as any) || {};
  const data = await AccountingService.getDetailedAccountCard({
    accountId: accountId ? Number(accountId) : undefined,
    detailedType: detailedType as any,
    detailedId: detailedId ? Number(detailedId) : undefined,
    detailedName: detailedName as string,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
});
router.get('/accounting/reports/account-card', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(accountCardQuerySchema), accountCardReportHandler);
router.get('/accounting/reports/ledger', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(accountCardQuerySchema), accountCardReportHandler);

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

router.get('/accounting/reports/party-ledger', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), validate(partyLedgerQuerySchema), asyncHandler(async (req, res) => {
  const { partyId, partyType, partyName, startDate, endDate, currency, includeDrafts } = (req.query as any) || {};
  const data = await AccountingService.getDetailedPartyLedger({
    partyId: partyId ? Number(partyId) : undefined,
    partyType: partyType as string,
    partyName: partyName as string,
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
    includeDrafts: includeDrafts === 'true',
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/parties', authorizePermission('accounting.reports', 'accounting.view', 'customers.view', 'customers.manage', 'sales.view', 'documents.view'), asyncHandler(async (req, res) => {
  const { search, type } = (req.query as any) || {};
  const data = await AccountingService.getPartiesList({
    search: search as string,
    type: type as string,
  });
  res.json({ data });
}));

export const journalBookQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    search: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

router.get('/accounting/reports/journal-book', authorizePermission('accounting.reports', 'accounting.view'), validate(journalBookQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate, search, currency } = (req.query as any) || {};
  const data = await AccountingService.getJournalBook({
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

export const financialRatiosQuerySchema = z.object({
  query: z.object({
    asOfDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

router.get('/accounting/reports/financial-ratios', authorizePermission('accounting.reports', 'accounting.view'), validate(financialRatiosQuerySchema), asyncHandler(async (req, res) => {
  const { asOfDate, currency } = (req.query as any) || {};
  const data = await AccountingService.getFinancialRatios({
    asOfDate: asOfDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

export const incomeStatementQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

router.get('/accounting/reports/income-statement', authorizePermission('accounting.reports', 'accounting.view'), validate(incomeStatementQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate, currency } = (req.query as any) || {};
  const data = await AccountingService.getIncomeStatement({
    startDate: startDate as string,
    endDate: endDate as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

export const balanceSheetQuerySchema = z.object({
  query: z.object({
    date: z.string().optional(),
    asOfDate: z.string().optional(),
    currency: z.string().optional(),
  }).optional()
});

router.get('/accounting/reports/balance-sheet', authorizePermission('accounting.reports', 'accounting.view'), validate(balanceSheetQuerySchema), asyncHandler(async (req, res) => {
  const { date, asOfDate, currency } = (req.query as any) || {};
  const data = await AccountingService.getBalanceSheet({
    date: (date || asOfDate) as string,
    currency: currency as string,
  });
  res.json({ report: data, ...data });
}));

router.get('/accounting/reports/multi-currency-summary', authorizePermission('accounting.reports', 'accounting.view'), validate(dateRangeQuerySchema), asyncHandler(async (req, res) => {
  const { startDate, endDate } = (req.query as any) || {};
  const data = await AccountingService.getMultiCurrencySummary({
    startDate: startDate as string,
    endDate: endDate as string,
  });
  res.json({ report: data, ...data });
}));

// V3 PHASE 5: بازرس هوشمند سلامت مالی و ممیزی دفاتر (Financial Health Inspector)
router.get('/accounting/reports/health-check', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const report = await AccountingService.runFinancialHealthCheck();
  res.json(report);
}));

// اقدام سریع: صدور دسته جمعی اسناد دوبل برای فاکتورها و اسناد نهایی فاقد سند
router.post('/accounting/quick-fix/sync-all-vouchers', authorizePermission('accounting.vouchers'), asyncHandler(async (req, res) => {
  const syncedCount = await AccountingService.syncAllInvoiceVouchers();
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'journal_voucher',
    entityId: 'QUICK_FIX_SYNC_ALL',
    description: `اجرای اقدام سریع صدور مکانیزه اسناد دوبل برای ${syncedCount} سند تجاری`,
    details: { syncedCount },
    ipAddress: req.ip || '',
  });
  res.json({ success: true, message: `${syncedCount} سند تجاری با موفقیت بررسی و سند دوبل آن‌ها صادر/به‌روزرسانی شد`, syncedCount });
}));

// ==========================================
// 6.3 V10-PHASE6: AUTOMATION STATUS & PROJECT REPORT & DOC SIGNATURES
// ==========================================

// V10-6.1: وضعیت اتوماسیون صدور سند دوبل per docType — پوشش واقعی با join اسناد نهایی به voucherها
const AUTO_VOUCHER_TYPES = ['invoice', 'receipt', 'production_receipt', 'purchase', 'remittance', 'waste', 'return'];
const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'فاکتور فروش',
  receipt: 'رسید خرید',
  production_receipt: 'رسید تولید',
  purchase: 'فاکتور خرید',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات',
  return: 'مرجوعی فروش',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال بین‌انباری',
  proforma: 'پیش‌فاکتور'
};

router.get('/accounting/automation-status', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const result = await orm.execute(sql`
    SELECT d.type AS doc_type,
           COUNT(DISTINCT d.id)::int AS total_docs,
           COUNT(DISTINCT CASE WHEN v.id IS NOT NULL THEN d.id END)::int AS with_voucher
    FROM documents d
    LEFT JOIN journal_vouchers v
      ON v.reference_module = 'invoice' AND v.reference_id = d.id AND v.is_deleted = 0
    WHERE d.is_deleted = 0 AND d.status IN ('final', 'proforma')
    GROUP BY d.type
  `);

  const rows = (result.rows || []) as Array<{ doc_type: string; total_docs: number; with_voucher: number }>;
  const byType = new Map(rows.map(r => [r.doc_type, r]));

  const report = [...AUTO_VOUCHER_TYPES, 'audit', 'transfer', 'proforma'].map(t => {
    const stat = byType.get(t) || { doc_type: t, total_docs: 0, with_voucher: 0 };
    const total = Number(stat.total_docs) || 0;
    const withVoucher = Number(stat.with_voucher) || 0;
    return {
      docType: t,
      label: DOC_TYPE_LABELS[t] || t,
      autoSupported: AUTO_VOUCHER_TYPES.includes(t),
      totalDocs: total,
      withVoucher,
      missingVoucher: Math.max(0, total - withVoucher)
    };
  });

  const grandTotal = report.reduce((a, r) => a + r.totalDocs, 0);
  const grandCovered = report.reduce((a, r) => a + r.withVoucher, 0);

  res.json({
    report,
    summary: {
      totalDocs: grandTotal,
      coveredDocs: grandCovered,
      coveragePercent: grandTotal > 0 ? Math.round((grandCovered / grandTotal) * 100) : 100,
      gapTypes: report.filter(r => !r.autoSupported && r.totalDocs > 0).map(r => r.label)
    }
  });
}));

// V10-6.1: گزارش حسابداری per-project — خلاصه گردش بدهکار/بستانکار به تفکیک پروژه
router.get('/accounting/reports/project-summary', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const result = await orm.execute(sql`
    SELECT jvi.detailed_id AS project_id,
           MAX(pp.project_code) AS project_code,
           MAX(pp.title) AS project_title,
           COUNT(jvi.id)::int AS entries_count,
           COALESCE(SUM(jvi.debit), 0) AS total_debit,
           COALESCE(SUM(jvi.credit), 0) AS total_credit
    FROM journal_voucher_items jvi
    INNER JOIN journal_vouchers jv ON jv.id = jvi.voucher_id AND jv.is_deleted = 0
    LEFT JOIN production_projects pp ON pp.id = jvi.detailed_id
    WHERE jvi.detailed_type = 'project'
    GROUP BY jvi.detailed_id
    ORDER BY MAX(pp.created_at) DESC NULLS LAST
  `);

  const rows = (result.rows || []) as Array<any>;
  res.json(rows.map(r => ({
    projectId: r.project_id,
    projectCode: r.project_code || '',
    projectTitle: r.project_title || 'پروژه نامشخص / حذف‌شده',
    entriesCount: Number(r.entries_count) || 0,
    totalDebit: Number(r.total_debit) || 0,
    totalCredit: Number(r.total_credit) || 0,
    balance: (Number(r.total_debit) || 0) - (Number(r.total_credit) || 0)
  })));
}));

export const projectDetailQuerySchema = z.object({
  query: z.object({
    projectId: z.coerce.number().int().positive('شناسه پروژه الزامی است و باید عدد مثبت باشد')
  })
});

// V10-6.1: ریز گردش یک پروژه با تراز جاری (read-model ساده، بدون سطح ۵)
router.get('/accounting/reports/project-detail', authorizePermission('accounting.reports', 'accounting.view'), validate(projectDetailQuerySchema), asyncHandler(async (req, res) => {
  const projectId = Number(req.query.projectId);

  const result = await orm.execute(sql`
    SELECT jvi.id AS line_id,
           jv.voucher_number AS voucher_number,
           jv.date AS voucher_date,
           jv.description AS voucher_description,
           COALESCE(a.code, '') AS account_code,
           COALESCE(a.name, '') AS account_name,
           jvi.description AS line_description,
           jvi.debit, jvi.credit
    FROM journal_voucher_items jvi
    INNER JOIN journal_vouchers jv ON jv.id = jvi.voucher_id AND jv.is_deleted = 0
    LEFT JOIN accounts a ON a.id = jvi.account_id
    WHERE jvi.detailed_type = 'project' AND jvi.detailed_id = ${projectId}
    ORDER BY jv.date ASC, jv.id ASC, jvi.id ASC
  `);

  const rows = (result.rows || []) as Array<any>;
  let running = 0;
  const detail = rows.map(r => {
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    running += debit - credit;
    return {
      voucherNumber: r.voucher_number || '-',
      voucherDate: r.voucher_date,
      voucherDescription: r.voucher_description || '',
      accountCode: r.account_code,
      accountName: r.account_name,
      lineDescription: r.line_description || '',
      debit,
      credit,
      runningBalance: running
    };
  });

  res.json({ projectId, detail });
}));

export const docSignaturesQuerySchema = z.object({
  query: z.object({
    entityId: z.string().min(1, 'شناسه سند الزامی است')
  })
});

// V10-6.2: تاییدکنندگان سند از تاریخچه ورکفلو — برای بخش امضای چاپ
router.get('/accounting/doc-signatures', authorizePermission('accounting.reports', 'accounting.view', 'documents.view'), validate(docSignaturesQuerySchema), asyncHandler(async (req, res) => {
  const entityId = String(req.query.entityId || '').trim();

  const instances = await orm
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'document'), eq(workflowInstances.entityId, entityId)));

  if (instances.length === 0) {
    return res.json({ signatures: [] });
  }

  const instanceIds = instances.map(i => i.id);
  const logs = await orm
    .select({
      name: workflowHistoryLogs.performedByName,
      actionKey: workflowHistoryLogs.actionKey,
      actionTitle: workflowHistoryLogs.actionTitle,
      createdAt: workflowHistoryLogs.createdAt,
      stateTitle: workflowStates.title
    })
    .from(workflowHistoryLogs)
    .leftJoin(workflowStates, eq(workflowHistoryLogs.toStateId, workflowStates.id))
    .where(and(
      eq(workflowHistoryLogs.instanceId, instanceIds[0]),
      eq(workflowHistoryLogs.actionKey, 'approve')
    ))
    .orderBy(workflowHistoryLogs.createdAt);

  const signatures = logs
    .filter(l => (l.name || '').trim() !== '')
    .map(l => ({
      name: l.name,
      roleTitle: l.stateTitle || l.actionTitle || 'تایید کننده',
      date: l.createdAt
    }))
    .slice(0, 3);

  res.json({ signatures });
}));

// ==========================================
// 7. FISCAL YEAR CLOSING & INVOICE VOUCHER SYNC
// ==========================================
export const fiscalClosingPreviewQuerySchema = z.object({
  query: z.object({
    year: z.string().min(1, 'سال مالی الزامی است'),
    closingDate: z.string().min(1, 'تاریخ سند اختتامیه الزامی است'),
    openingDateNewYear: z.string().optional(),
  })
});

router.get('/accounting/fiscal-closing/preview', authorizePermission('accounting.vouchers'), validate(fiscalClosingPreviewQuerySchema), asyncHandler(async (req, res) => {
  const { year, closingDate, openingDateNewYear } = (req.query as any) || {};
  const data = await AccountingService.getFiscalYearClosingPreview({
    year: year as string,
    closingDate: closingDate as string,
    openingDateNewYear: openingDateNewYear as string,
  });
  res.json(data);
}));

export const fiscalClosingExecuteSchema = z.object({
  body: z.object({
    year: z.string().min(1, 'سال مالی الزامی است'),
    closingDate: z.string().min(1, 'تاریخ سند بستن سال الزامی است'),
    openingDateNewYear: z.string().optional(),
    createOpeningVoucher: z.boolean().optional(),
  })
});

router.post('/accounting/fiscal-closing/execute', authorize('admin'), validate(fiscalClosingExecuteSchema), asyncHandler(async (req, res) => {
  const { year, closingDate, openingDateNewYear, createOpeningVoucher } = req.body;

  const result = await AccountingService.executeFiscalYearClosing({
    year,
    closingDate,
    openingDateNewYear,
    createOpeningVoucher,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'journal_voucher',
    entityId: `FISCAL_CLOSE_${year}`,
    description: `اجرای عملیات بستن سال مالی ${year} و صدور اسناد اختتامیه/افتتاحیه`,
    details: { year, netProfit: result.netProfit, vouchersCount: result.closingVouchers.length },
    ipAddress: req.ip || '',
  });

  res.json(result);
}));

export const invoiceSyncVoucherSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه فاکتور باید عددی باشد')
  }),
  body: z.object({
    vatPercent: z.coerce.number().min(0).max(100).optional(),
    vatAmount: z.coerce.number().min(0).optional(),
  }).optional()
});

router.post('/accounting/invoices/:id/sync-voucher', authorizePermission('accounting.vouchers'), validate(invoiceSyncVoucherSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const { vatPercent, vatAmount } = req.body || {};
  const voucher = await AccountingService.syncSalesInvoiceVoucher(docId, {
    vatPercent,
    vatAmount,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
  });
  if (!voucher) {
    throw new BadRequestError('فاکتور یافت نشد یا در وضعیت تایید نهایی نیست');
  }
  res.json({ message: 'سند دوبل فاکتور فروش با موفقیت صادر و همگام شد', voucher });
}));

export default router;

