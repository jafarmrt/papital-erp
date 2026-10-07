/**
 * مسیرهای خزانه: حساب‌های بانکی و صندوق‌ها، تطبیق مانده، دریافت و پرداخت، انتقال وجه، آشتی‌سنجی و دفتر چک صیادی
 * (TreasuryService، AGENTS.md §11). authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import { authorizePermission, userHasRoleOrPermission } from '../../middleware/authorize.js';
import { READ_PERMISSIONS, RECORD_READ_PERMISSIONS } from '../../lib/recordReadPermissions.js';
import { AccountingService } from '../../services/accounting.service.js';
import { NO_VOUCHER_TREASURY_PERMISSION } from '../../services/accounting/treasury/noVoucherTreasury.js';
import { getBankAccountOptions } from '../../services/accounting/treasury/bankAccountOptions.js';
import { relinkTreasuryDocument } from '../../services/accounting/treasury/treasuryDocumentRelink.js';
import { choosableContraAccounts } from '../../services/accounting/treasury/partyContraAccount.js';
import { logActivity } from '../../lib/auditLogger.js';
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
  voidTreasuryTxSchema,
  relinkTreasuryDocumentSchema,
  chequesQuerySchema,
  createChequeSchema,
  updateChequeStatusSchema,
  nextBankCodeQuerySchema,
} from './accounting.schemas.js';

const router = Router();

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
  const report = await AccountingService.recalculateAndSyncBankBalances();
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'bank_reconciliation',
    entityId: 'sync',
    description: `همگام‌سازی مانده حساب‌های بانکی از تراکنش‌ها (${report.syncedCount} حساب هم‌خوان با دفتر کل، ${report.discrepantCount} اختلاف)`,
    details: { report },
    ipAddress: req.ip || '',
  });
  res.json({ message: 'مانده حساب‌های بانکی از تراکنش‌ها ساخته شد؛ اختلاف با دفتر کل در گزارش آمده است', report });
});
router.post('/accounting/banks/sync-reconcile', authorizePermission('accounting.treasury'), syncBanksHandler);
router.post('/accounting/bank-accounts/sync-reconcile', authorizePermission('accounting.treasury'), syncBanksHandler);

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
  const before = (await AccountingService.getBankAccounts()).find((b) => b.id === id) || null;
  const updated = await AccountingService.updateBankAccount(id, {
    ...req.body,
    ...(req.body.shebaNumber || req.body.shabaNumber ? { shebaNumber: req.body.shebaNumber || req.body.shabaNumber } : {}),
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
  const before = (await AccountingService.getBankAccounts()).find((b) => b.id === id) || null;
  const result = await AccountingService.deleteBankAccount(id, { userId: req.user?.id, username: req.user?.fullName || req.user?.username });
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
  const tx = await AccountingService.createTreasuryTransaction({
    ...req.body,
    // v8.0.118 (TD-409): «بدون سند حسابداری» فقط با مجوز جدا؛ از جلسه کاربر سنجیده می‌شود، نه بدنه درخواست
    allowNoVoucher: await userHasRoleOrPermission(req.user, NO_VOUCHER_TREASURY_PERMISSION),
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
  });
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'treasury_transfer',
    entityId: `${result.payment.id}/${result.receipt.id}`,
    description: `انتقال وجه ${Number(req.body.amount).toLocaleString('fa-IR')} بین حساب‌ها (سند ${result.voucherId || 'بدون سند'})`,
    details: { paymentId: result.payment.id, receiptId: result.receipt.id, voucherId: result.voucherId },
    ipAddress: req.ip || '',
  });
  res.status(201).json(result);
}));

router.post('/accounting/treasury/reconcile', authorizePermission('accounting.treasury'), validate(reconcileSchema), asyncHandler(async (req, res) => {
  const { bankAccountId, txIds, batch, reconciled } = req.body;
  // v9.0.103 (TD-511): ممیزی فقط ردیف‌های تغییرکرده، درون همان تراکنش
  const result = await AccountingService.reconcileTransactions({
    bankAccountId,
    txIds,
    batch: batch || `stmt-${Date.now()}`,
    reconciled,
    req,
    userFullName: req.user?.fullName,
  });
  res.json(result);
}));

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

// v9.0.272 (TD-779، ت۴ الف): جدا کردن دریافت یا پرداخت از سندش («علی‌الحساب») یا وصل کردن به سند فعال دیگر
router.put('/accounting/treasury/:id/document', authorizePermission('accounting.treasury'), validate(relinkTreasuryDocumentSchema), asyncHandler(async (req, res) => {
  const result = await relinkTreasuryDocument({
    id: Number(req.params.id),
    documentId: req.body.documentId,
    req,
    userId: req.user?.id,
    username: req.user?.username,
  });
  res.json(result);
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
  const chq = await AccountingService.createCheque({
    ...req.body,
    // v8.0.118 (TD-409): «بدون سند حسابداری» فقط با مجوز جدا؛ از جلسه کاربر سنجیده می‌شود، نه بدنه درخواست
    allowNoVoucher: await userHasRoleOrPermission(req.user, NO_VOUCHER_TREASURY_PERMISSION),
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

router.delete('/accounting/cheques/:id', authorizePermission('accounting.cheques'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
