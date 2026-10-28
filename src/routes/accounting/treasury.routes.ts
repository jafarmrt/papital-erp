/**
 * مسیرهای خزانه: حساب‌های بانکی و صندوق‌ها، تطبیق مانده، دریافت و پرداخت، انتقال وجه، آشتی‌سنجی و دفتر چک صیادی
 * (TreasuryService، AGENTS.md §11). authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import type { z } from 'zod';
import { authorizePermission, can, userHasRoleOrPermission } from '../../middleware/authorize.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import { READ_PERMISSIONS, RECORD_READ_PERMISSIONS } from '../../lib/recordReadPermissions.js';
import { AccountingService } from '../../services/accounting.service.js';
import { NO_VOUCHER_TREASURY_PERMISSION } from '../../services/accounting/treasury/noVoucherTreasury.js';
import { getBankAccountOptions } from '../../services/accounting/treasury/bankAccountOptions.js';
import { relinkTreasuryDocument } from '../../services/accounting/treasury/treasuryDocumentRelink.js';
import { listTreasuryRelinkOptions } from '../../services/accounting/treasury/treasuryRelinkOptions.js';
import { readSourceAllocations, replaceSourceAllocations } from '../../services/accounting/treasury/settlementAllocationWrite.js';
import { choosableContraAccounts } from '../../services/accounting/treasury/partyContraAccount.js';
import { listReconcilableCheques } from '../../services/accounting/treasury/bankReconciliation.js';
import { createPettyCashExpense, listPettyCashExpenseLines, pettyCashExpenseAccounts } from '../../services/accounting/treasury/pettyCashExpense.service.js';
import { createStatutoryRemittance } from '../../services/accounting/treasury/statutoryRemittance.js';
import { statutoryRemittanceOptions } from '../../services/accounting/treasury/statutoryRemittanceOptions.js';
import { STATUTORY_REMITTANCE_PERMISSION } from '../../lib/treasury/statutoryRemittance.js';
import { validate, paramsIdSchema } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
  type ValidatedQuery,
  createBankAccountSchema,
  updateBankAccountSchema,
  treasuryQuerySchema,
  createTreasuryTxSchema,
  previewTreasurySchema,
  transferSchema,
  reconcileSchema,
  reconcileChequesQuerySchema,
  voidTreasuryTxSchema,
  relinkTreasuryDocumentSchema,
  treasuryRelinkOptionsSchema,
  sourceAllocationsSchema,
  replaceSourceAllocationsSchema,
  chequesQuerySchema,
  createChequeSchema,
  updateChequeStatusSchema,
  nextBankCodeQuerySchema,
} from './accounting.schemas.js';
import { pettyCashExpenseSchema, pettyCashLinesSchema } from './pettyCash.schemas.js';
import { statutoryRemittanceOptionsSchema, statutoryRemittanceSchema } from './statutoryRemittance.schemas.js';

const router = Router();

/**
 * v11 phase 6.1t (review of M11): putting a receipt or cheque on invoices reads and settles documents, so it needs the
 * documents section as well, as the list of open documents does. Before, a holder of the cheque book alone settled any
 * invoice by its id and read its number, buyer and remaining amount from the errors.
 */
async function assertSettlementDocumentsReadable(user: { role?: string } | undefined): Promise<void> {
  if (await can(user, ...READ_PERMISSIONS.documentRecord)) return;
  throw new ForbiddenError('نشاندن دریافت و چک روی فاکتورها مجوز بخش اسناد را هم می‌خواهد.', undefined, 'SETTLEMENT_DOCUMENTS_NOT_READABLE');
}

const sendsAllocations = (body: { allocations?: unknown } | undefined) => Array.isArray(body?.allocations) && body.allocations.length > 0;
// v11 phase 7.2 (finding F6 of the v11 full test): a direct link to one document asks the same document read as parts do
const linksDocument = (body: { documentId?: unknown } | undefined) => body?.documentId !== undefined && body?.documentId !== null;

// ==========================================
// 4. BANK ACCOUNTS & TREASURY
// ==========================================
const getBanksHandler = asyncHandler(async (req, res) => {
  const list = await AccountingService.getBankAccounts();
  res.json(list);
});
router.get('/accounting/banks', authorizePermission(...READ_PERMISSIONS.bankAccounts), getBanksHandler);
router.get('/accounting/bank-accounts', authorizePermission(...READ_PERMISSIONS.bankAccounts), getBanksHandler);
// v9.0.97 (TD-505، ت۷): فهرست انتخاب کمینه برای فرم‌ها؛ فهرست کامل با شماره‌ها و مانده‌ها فقط برای خوانندگان خزانه
router.get('/accounting/bank-accounts/options', authorizePermission(...READ_PERMISSIONS.bankAccountOptions), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getBankAccountOptions() });
}));

// Dynamic Bank & Ledger Synchronization and Reconciliation
const syncBanksHandler = asyncHandler(async (req, res) => {
  // v10.0.262 (TD-934): ممیزی درون تراکنش هر ثبت خزانه نوشته می‌شود
  const report = await AccountingService.recalculateAndSyncBankBalances({ req, userFullName: req.user?.fullName });
  res.json({ message: 'مانده حساب‌های بانکی از تراکنش‌ها ساخته شد؛ اختلاف با دفتر کل در گزارش آمده است', report });
});
router.post('/accounting/banks/sync-reconcile', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), syncBanksHandler);
router.post('/accounting/bank-accounts/sync-reconcile', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), syncBanksHandler);

// v7.0.127 (TD-247): جمع کل‌ها در TreasuryService با Decimal (AGENTS.md §1.8)؛ همان شکل پاسخ پیشین
const reportBanksHandler = asyncHandler(async (req, res) => {
  const report = await AccountingService.getBankReconciliationReport();
  res.json({ report });
});
router.get('/accounting/banks/reconciliation-report', authorizePermission('accounting.treasury'), reportBanksHandler);
router.get('/accounting/bank-accounts/reconciliation-report', authorizePermission('accounting.treasury'), reportBanksHandler);

// V4.0.37: تولید کد خودکار حساب خزانه بر اساس نوع
const getNextBankCodeHandler = asyncHandler(async (req, res) => {
  const { type } = (req.query as ValidatedQuery<typeof nextBankCodeQuerySchema>) || {};
  const nextCode = await AccountingService.generateNextAccountCode(type || 'bank');
  res.json({ code: nextCode });
});
router.get('/accounting/banks/next-code', authorizePermission('accounting.treasury'), validate(nextBankCodeQuerySchema), getNextBankCodeHandler);
router.get('/accounting/bank-accounts/next-code', authorizePermission('accounting.treasury'), validate(nextBankCodeQuerySchema), getNextBankCodeHandler);

const createBankHandler = asyncHandler(async (req, res) => {
  const bank = await AccountingService.createBankAccount({
    ...req.body,
    shebaNumber: req.body.shebaNumber || req.body.shabaNumber,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(bank);
});
router.post('/accounting/banks', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(createBankAccountSchema), createBankHandler);
router.post('/accounting/bank-accounts', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(createBankAccountSchema), createBankHandler);

const updateBankHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await AccountingService.updateBankAccount(id, {
    ...req.body,
    ...(req.body.shebaNumber || req.body.shabaNumber ? { shebaNumber: req.body.shebaNumber || req.body.shabaNumber } : {}),
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.json(updated);
});
router.put('/accounting/banks/:id', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(updateBankAccountSchema), updateBankHandler);
router.put('/accounting/bank-accounts/:id', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(updateBankAccountSchema), updateBankHandler);

const deleteBankHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await AccountingService.deleteBankAccount(id, {
    userId: req.user?.id, username: req.user?.fullName || req.user?.username, audit: { req, userFullName: req.user?.fullName },
  });
  res.json(result);
});
router.delete('/accounting/banks/:id', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(paramsIdSchema), deleteBankHandler);
router.delete('/accounting/bank-accounts/:id', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(paramsIdSchema), deleteBankHandler);

// Treasury Transactions (دریافت و پرداخت)

router.get('/accounting/treasury', authorizePermission(...RECORD_READ_PERMISSIONS.treasury_transaction), validate(treasuryQuerySchema), asyncHandler(async (req, res) => {
  const { type, bankAccountId, startDate, endDate, method, q, page, limit } = (req.query as ValidatedQuery<typeof treasuryQuerySchema>) || {};
  const filters = {
    type,
    bankAccountId: bankAccountId ? Number(bankAccountId) : undefined,
    startDate: startDate as string,
    endDate: endDate as string,
    method,
    q,
  };
  // v9.0.102 (TD-509، B04-13): با page یا limit فقط همان صفحه و شمار کل برمی‌گردد (`{ data, total, page, limit }`)
  if (page !== undefined || limit !== undefined) {
    res.json(await AccountingService.getTreasuryTransactionPage(filters, page ?? 1, limit ?? 20));
    return;
  }
  res.json(await AccountingService.getTreasuryTransactions(filters));
}));

// V1.4.0: Idempotency — retry همین درخواست هرگز دوبار وجه ثبت نمی‌کند
router.post('/accounting/treasury', authorizePermission('accounting.treasury'), idempotency({ scope: 'treasury' }), validate(createTreasuryTxSchema), asyncHandler(async (req, res) => {
  if (sendsAllocations(req.body) || linksDocument(req.body)) await assertSettlementDocumentsReadable(req.user);
  const tx = await AccountingService.createTreasuryTransaction({
    ...req.body,
    // v8.0.118 (TD-409): «بدون سند حسابداری» فقط با مجوز جدا؛ از جلسه کاربر سنجیده می‌شود، نه بدنه درخواست
    allowNoVoucher: await userHasRoleOrPermission(req.user, NO_VOUCHER_TREASURY_PERMISSION),
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(tx);
}));

// v9.0.82 (TD-507، ت۴ الف): سرفصل‌هایی که فرم خزانه و دفتر چک برای «متفرقه» و «سایر» پرسنل پیشنهاد می‌دهند
router.get('/accounting/treasury/contra-accounts', authorizePermission('accounting.treasury', 'accounting.cheques'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await choosableContraAccounts() });
}));

router.post('/accounting/treasury/preview-voucher', authorizePermission('accounting.treasury'), validate(previewTreasurySchema), asyncHandler(async (req, res) => {
  const preview = await AccountingService.previewTreasuryVoucher(req.body);
  res.json(preview);
}));

router.post('/accounting/treasury/transfer', authorizePermission('accounting.treasury'), idempotency({ scope: 'treasury' }), validate(transferSchema), asyncHandler(async (req, res) => {
  const result = await AccountingService.createTreasuryTransfer({
    ...req.body,
    // v8.0.118 (TD-409): «بدون سند حسابداری» فقط با مجوز جدا؛ از جلسه کاربر سنجیده می‌شود، نه بدنه درخواست
    allowNoVoucher: await userHasRoleOrPermission(req.user, NO_VOUCHER_TREASURY_PERMISSION),
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(result);
}));

// v10.1.32 (D-16، ت۳۰ «متغیر»): صورت‌هزینه تنخواه‌گردان؛ شارژ و برگشت وجه همان انتقال وجه است
router.get('/accounting/treasury/petty-cash/expense-accounts', authorizePermission('accounting.treasury'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await pettyCashExpenseAccounts() });
}));

router.post('/accounting/treasury/petty-cash/:id/expenses', authorizePermission('accounting.treasury'), idempotency({ scope: 'treasury' }), validate(pettyCashExpenseSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof pettyCashExpenseSchema>['body'];
  const result = await createPettyCashExpense({
    fundId: Number(req.params.id),
    date: body.date,
    description: body.description,
    lines: body.lines.map(line => ({ ...line, amount: line.amount ?? '' })),
    attachments: body.attachments,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(result);
}));

router.get('/accounting/treasury/:id/petty-cash-lines', authorizePermission(...RECORD_READ_PERMISSIONS.treasury_transaction), validate(pettyCashLinesSchema), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listPettyCashExpenseLines(Number(req.params.id)) });
}));

// v10.1.36 (TD-1243، ت۳۳ الف): پرداخت یکجای بیمه یا مالیات حقوق یک ماه با ردیف هر نفر روی ۳۲۰۴ / ۳۲۰۶
router.get('/accounting/treasury/statutory-remittance/options', authorizePermission(STATUTORY_REMITTANCE_PERMISSION), validate(statutoryRemittanceOptionsSchema), asyncHandler(async (req, res) => {
  // validate() نوع، سال و ماه را الزامی کرده است
  const { kind, year, month } = req.query as unknown as Required<ValidatedQuery<typeof statutoryRemittanceOptionsSchema>>;
  res.json(await statutoryRemittanceOptions(kind, year, month));
}));

router.post('/accounting/treasury/statutory-remittance', authorizePermission(STATUTORY_REMITTANCE_PERMISSION), idempotency({ scope: 'treasury' }), validate(statutoryRemittanceSchema), asyncHandler(async (req, res) => {
  const { kind, year, month, ...rest } = req.body as z.infer<typeof statutoryRemittanceSchema>['body'];
  const result = await createStatutoryRemittance({
    ...rest,
    kind,
    jalaliYear: year,
    jalaliMonth: month,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(result);
}));

// v10.0.254 (TD-971): چک‌های وصول‌شده حساب، نامزد تطبیق صورت‌حساب در کنار تراکنش‌های خزانه
router.get('/accounting/treasury/reconcile-cheques', authorizePermission('accounting.treasury'), validate(reconcileChequesQuerySchema), asyncHandler(async (req, res) => {
  res.json(await listReconcilableCheques(Number(req.query.bankAccountId)));
}));

router.post('/accounting/treasury/reconcile', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(reconcileSchema), asyncHandler(async (req, res) => {
  const { bankAccountId, txIds, chequeIds, batch, reconciled } = req.body;
  // v9.0.103 (TD-511): ممیزی فقط ردیف‌های تغییرکرده، درون همان تراکنش
  const result = await AccountingService.reconcileTransactions({
    bankAccountId,
    txIds,
    chequeIds,
    batch: batch || `stmt-${Date.now()}`,
    reconciled,
    req,
    userFullName: req.user?.fullName,
  });
  res.json(result);
}));

router.post('/accounting/treasury/:id/void', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(voidTreasuryTxSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const reversal = await AccountingService.voidTreasuryTransaction(id, {
    reason: req.body.reason,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.json(reversal);
}));

// v10.0.123 (TD-1122): سندهای هم‌طرف، هم‌سو و هم‌ارزی که دریافت یا پرداخت به آن‌ها منتقل می‌شود (پنجره «انتقال به سند دیگر»)
router.get('/accounting/treasury/:id/document-options', authorizePermission('accounting.treasury'), validate(treasuryRelinkOptionsSchema), asyncHandler(async (req, res) => {
  await assertSettlementDocumentsReadable(req.user);
  res.json(await listTreasuryRelinkOptions(Number(req.params.id)));
}));

// v9.0.272 (TD-779، ت۴ الف): جدا کردن دریافت یا پرداخت از سندش («علی‌الحساب») یا وصل کردن به سند فعال دیگر
router.put('/accounting/treasury/:id/document', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(relinkTreasuryDocumentSchema), asyncHandler(async (req, res) => {
  if (linksDocument(req.body)) await assertSettlementDocumentsReadable(req.user);
  const result = await relinkTreasuryDocument({
    id: Number(req.params.id),
    documentId: req.body.documentId,
    req,
    userId: req.user?.id,
    username: req.user?.username,
  });
  res.json(result);
}));

// v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the documents a recorded receipt or payment settles, in parts
router.get('/accounting/treasury/:id/allocations', authorizePermission('accounting.treasury'), validate(sourceAllocationsSchema), asyncHandler(async (req, res) => {
  await assertSettlementDocumentsReadable(req.user);
  res.json(await readSourceAllocations({ treasuryId: Number(req.params.id) }));
}));

router.put('/accounting/treasury/:id/allocations', authorizePermission('accounting.treasury'), idempotency({ scope: 'accounting' }), validate(replaceSourceAllocationsSchema), asyncHandler(async (req, res) => {
  await assertSettlementDocumentsReadable(req.user);
  res.json(await replaceSourceAllocations({
    source: { treasuryId: Number(req.params.id) },
    allocations: req.body.allocations,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  }));
}));

// ==========================================
// 5. CHEQUES (دفتر چک صیادی)
// ==========================================

router.get('/accounting/cheques', authorizePermission(...RECORD_READ_PERMISSIONS.cheque), validate(chequesQuerySchema), asyncHandler(async (req, res) => {
  const { type, status, startDate, endDate, search } = (req.query as ValidatedQuery<typeof chequesQuerySchema>) || {};
  const list = await AccountingService.getCheques({
    type,
    status: status as string,
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
  });
  res.json(list);
}));

router.post('/accounting/cheques', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(createChequeSchema), asyncHandler(async (req, res) => {
  if (sendsAllocations(req.body)) await assertSettlementDocumentsReadable(req.user);
  const chq = await AccountingService.createCheque({
    ...req.body,
    // v8.0.118 (TD-409): «بدون سند حسابداری» فقط با مجوز جدا؛ از جلسه کاربر سنجیده می‌شود، نه بدنه درخواست
    allowNoVoucher: await userHasRoleOrPermission(req.user, NO_VOUCHER_TREASURY_PERMISSION),
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.status(201).json(chq);
}));

const updateChequeStatusHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const notes = req.body.notes || req.body.description;
  const chq = await AccountingService.updateChequeStatus(id, {
    status: req.body.status,
    actionDate: req.body.actionDate,
    bankAccountId: req.body.bankAccountId,
    transfereePartyId: req.body.transfereePartyId,
    notes,
    description: req.body.description,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    // v9.0.104 (TD-512): ممیزی با قبل و بعد و سندهای صادرشده، درون تراکنش تغییر وضعیت
    audit: { req, userFullName: req.user?.fullName },
  });
  res.json(chq);
});
router.put('/accounting/cheques/:id/status', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(updateChequeStatusSchema), updateChequeStatusHandler);
router.patch('/accounting/cheques/:id/status', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(updateChequeStatusSchema), updateChequeStatusHandler);

// v11 phase 6.1t (M11): the documents a cheque settles, in parts
router.get('/accounting/cheques/:id/allocations', authorizePermission('accounting.cheques'), validate(sourceAllocationsSchema), asyncHandler(async (req, res) => {
  await assertSettlementDocumentsReadable(req.user);
  res.json(await readSourceAllocations({ chequeId: Number(req.params.id) }));
}));

router.put('/accounting/cheques/:id/allocations', authorizePermission('accounting.cheques'), idempotency({ scope: 'cheques' }), validate(replaceSourceAllocationsSchema), asyncHandler(async (req, res) => {
  await assertSettlementDocumentsReadable(req.user);
  res.json(await replaceSourceAllocations({
    source: { chequeId: Number(req.params.id) },
    allocations: req.body.allocations,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  }));
}));

router.delete('/accounting/cheques/:id', authorizePermission('accounting.cheques'), idempotency({ scope: 'accounting' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  // v9.0.104 (TD-512): ممیزی با وضعیت پیش از حذف و سندهای حذف یا باطل‌شده، درون تراکنش حذف
  const result = await AccountingService.deleteCheque(id, {
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    audit: { req, userFullName: req.user?.fullName },
  });
  res.json(result);
}));

export default router;
