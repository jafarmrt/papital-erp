/**
 * مسیرهای صدور خودکار سند دوبل: صدور اسناد معوق اسناد نهایی فاقد سند و وضعیت پوشش اتوماسیون
 * (VoucherSyncService، AGENTS.md §11 / TD-193). authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import { authorizePermission } from '../../middleware/authorize.js';
import { AccountingService } from '../../services/accounting.service.js';
import { logActivity } from '../../lib/auditLogger.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { ConflictError } from '../../errors/customErrors.js';
import { getAutomationStatus } from '../../services/accounting/automationStatus.service.js';

const router = Router();

// اقدام سریع: صدور اسناد دوبل فقط برای اسناد نهایی فاقد سند (v7.0.31 / TD-193 / audit P1-8)
// هیچ سند حسابداری موجودی بازنویسی نمی‌شود؛ قفل مشورتی تضمین می‌کند در کل خوشه فقط یک اجرا فعال باشد.
router.post('/accounting/quick-fix/sync-all-vouchers', authorizePermission('accounting.vouchers'), asyncHandler(async (req, res) => {
  const summary = await AccountingService.syncMissingDocumentVouchers({
    userId: req.user?.id,
    username: req.user?.username || 'system',
  });
  if (summary.locked) {
    throw new ConflictError('صدور اسناد معوق هم‌اکنون توسط کاربر یا نمونه دیگری در حال اجراست؛ چند دقیقه بعد دوباره تلاش کنید.');
  }
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'journal_voucher',
    entityId: 'QUICK_FIX_SYNC_MISSING',
    description: `صدور اسناد دوبل برای اسناد نهایی فاقد سند: ${summary.created} سند صادر شد، ${summary.failed} ناموفق، ${summary.skippedForReview} نیازمند بررسی`,
    details: { checked: summary.checked, created: summary.created, failed: summary.failed, skippedForReview: summary.skippedForReview, reviewDocumentIds: summary.reviewDocumentIds, errors: summary.errors },
    ipAddress: req.ip || '',
  });
  const parts = [`${summary.created} سند حسابداری برای اسناد نهایی فاقد سند صادر شد`];
  if (summary.failed > 0) parts.push(`${summary.failed} سند به دلیل خطا صادر نشد`);
  if (summary.skippedForReview > 0) parts.push(`${summary.skippedForReview} سند دارای سند حسابداری بدون پیوند است و نیازمند بررسی حسابدار است`);
  res.json({ success: summary.failed === 0, message: parts.join('؛ '), syncedCount: summary.created, ...summary });
}));

// V10-6.1: وضعیت صدور خودکار اسناد حسابداری به تفکیک نوع سند. v9.0.297 (TD-560): شمارش در سرویس، فقط اسناد نهایی،
// انبارگردانی پشتیبانی‌شده و انتقال بی اثر مالی (src/lib/accounting/automationStatus.ts)
router.get('/accounting/automation-status', authorizePermission('accounting.reports', 'accounting.view'), asyncHandler(async (_req, res) => {
  res.json(await getAutomationStatus());
}));

// invoiceSyncVoucherSchema + POST /accounting/invoices/:id/sync-voucher — حذف شدند
// (v4.0.29): هیچ فراخوانی frontend ندارد؛ نسخه piecework همین مسیر در UI فعال است.

export default router;
