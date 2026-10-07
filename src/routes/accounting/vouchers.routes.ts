/**
 * مسیرهای اسناد حسابداری: فهرست، صدور، ویرایش، حذف، برگشت، اصلاح، قطعی‌سازی و تغییر وضعیت (VoucherService، AGENTS.md §11).
 * authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import { authorizePermission } from '../../middleware/authorize.js';
import { RECORD_READ_PERMISSIONS } from '../../lib/recordReadPermissions.js';
import { AccountingService } from '../../services/accounting.service.js';
import { logActivity, extractClientIp } from '../../lib/auditLogger.js';
import { validate, paramsIdSchema } from '../../middleware/validate.js';
import { idempotency } from '../../middleware/idempotency.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { voucherAuditChanges, voucherAuditSnapshot } from '../../services/accounting/accountingAudit.js';
import { batchFinalizeMessage } from '../../lib/accounting/voucherBatch.js';
import {
  type ValidatedQuery,
  vouchersQuerySchema,
  createVoucherSchema,
  updateVoucherSchema,
  reverseVoucherSchema,
  correctVoucherSchema,
  batchFinalizeVouchersSchema,
  batchApproveVouchersSchema,
  setVoucherStatusSchema,
} from './accounting.schemas.js';

const router = Router();

// ==========================================
// 3. JOURNAL VOUCHERS (اسناد حسابداری)
// ==========================================

router.get('/accounting/vouchers', authorizePermission(...RECORD_READ_PERMISSIONS.journal_voucher), validate(vouchersQuerySchema), asyncHandler(async (req, res) => {
  const { page, limit, search, status, voucherType, startDate, endDate } = (req.query as ValidatedQuery<typeof vouchersQuerySchema>) || {};
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

router.get('/accounting/vouchers/:id', authorizePermission(...RECORD_READ_PERMISSIONS.journal_voucher), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const voucher = await AccountingService.getJournalVoucherById(id);
  if (!voucher) throw new NotFoundError('سند حسابداری یافت نشد');
  res.json(voucher);
}));

router.post('/accounting/vouchers', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(createVoucherSchema), asyncHandler(async (req, res) => {
  const voucher = await AccountingService.createJournalVoucher({
    ...req.body,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    manualEntry: true, // v9.0.190 (TD-551، ت۷): ارز و نرخ هر ردیف و تراز ریالی سند دستی
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
  const { version, ...changes } = req.body;
  // v9.0.290 (TD-555، B03-13): پیش از ویرایش خوانده می‌شود؛ ویرایش با نسخه خوانده‌شده فقط همین حالت را تغییر می‌دهد (نسخه دیگر ۴۰۹)
  const before = await AccountingService.getJournalVoucherById(id);
  const voucher = await AccountingService.updateJournalVoucher(id, { ...changes, manualEntry: true, expectedVersion: version }); // v9.0.190 (TD-551)
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `ویرایش سند حسابداری شماره ${voucher.voucherNumber}`,
    details: voucherAuditChanges(before, voucher),
    ipAddress: req.ip || '',
  });
  res.json(voucher);
}));

router.delete('/accounting/vouchers/:id', authorizePermission('accounting.vouchers'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const before = await AccountingService.getJournalVoucherById(id); // v9.0.290 (TD-555): ممیزی حذف کل سند را دارد
  const result = await AccountingService.deleteJournalVoucher(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'journal_voucher',
    entityId: String(id),
    description: `حذف سند حسابداری شماره ${before.voucherNumber}`,
    details: { before: voucherAuditSnapshot(before) },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

router.post('/accounting/vouchers/:id/reverse', authorizePermission('accounting.vouchers'), idempotency({ scope: 'accounting_voucher' }), validate(reverseVoucherSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { date, reason } = req.body;
  const reversalVoucher = await AccountingService.reverseVoucher({
    voucherId: id,
    date,
    reason,
    userId: req.user?.id,
    username: req.user?.fullName || req.user?.username,
    manualEntry: true, // v9.0.289 (TD-552، ت۸): سند منشأدار فقط با ابطال منشأ برمی‌گردد
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

// repostVoucherSchema + POST /accounting/vouchers/:id/repost — حذف شدند (v4.0.29):
// هیچ فراخوانی frontend ندارند؛ سرویس AccountingService.repostVoucher برای تست باقی است.

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
    // v9.0.291 (TD-556): شناسه‌های قطعی‌شده و ردشده‌ها جدا؛ پیش‌تر همه شناسه‌های فرستاده‌شده «قطعی‌شده» ثبت می‌شد
    details: { requestedIds: ids, finalizedIds: result.ids, refused: result.refused },
    ipAddress: req.ip || '',
  });

  res.json({ message: batchFinalizeMessage(result), ...result });
}));

router.post('/accounting/vouchers/batch-approve', authorizePermission('accounting.vouchers'), validate(batchApproveVouchersSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const result = await AccountingService.approveJournalVouchers(
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
    description: `تایید حسابداری گروهی ${result.approvedCount} سند پیش‌نویس`,
    details: { ids, count: result.approvedCount },
    ipAddress: extractClientIp(req),
  });

  res.json({ message: `${result.approvedCount} سند پیش‌نویس با موفقیت تایید حسابداری شدند.`, ...result });
}));

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

// Auto-voucher manual triggers (POST /accounting/vouchers/auto/invoice/:id و
// POST /accounting/vouchers/auto/payroll/:id) — حذف شدند (v4.0.29): هیچ فراخوانی
// frontend ندارند؛ صدور سند خودکار درون تراکنش سرویس‌ها انجام می‌شود.

export default router;
