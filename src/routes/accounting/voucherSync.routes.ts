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
import { orm } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';

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
      ON v.source_document_id = d.id AND v.is_deleted = 0
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

// invoiceSyncVoucherSchema + POST /accounting/invoices/:id/sync-voucher — حذف شدند
// (v4.0.29): هیچ فراخوانی frontend ندارد؛ نسخه piecework همین مسیر در UI فعال است.

export default router;
