/**
 * مسیرهای بستن سال مالی: پیش‌نمایش و اجرای اسناد اختتامیه/افتتاحیه (FiscalYearService، AGENTS.md §11).
 * authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import { authorizePermission, requirePermission } from '../../middleware/authorize.js';
import { AccountingService } from '../../services/accounting.service.js';
import { getFiscalClosingYears } from '../../services/accounting/fiscalYearOrder.js';
import { reopenFiscalYear } from '../../services/accounting/fiscalYearReopen.js';
import { logActivity } from '../../lib/auditLogger.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
  type ValidatedQuery,
  fiscalClosingPreviewQuerySchema,
  fiscalClosingExecuteSchema,
  fiscalYearReopenSchema,
} from './accounting.schemas.js';

const router = Router();

// ==========================================
// 7. FISCAL YEAR CLOSING & INVOICE VOUCHER SYNC
// ==========================================

// v9.0.161 (TD-543): سال‌های تمام‌شده با وضعیت بسته/باز، سال پیش‌فرض فرم و تنها سال قابل بازگشایی
router.get('/accounting/fiscal-closing/years', requirePermission('accounting.vouchers'), asyncHandler(async (_req, res) => {
  res.json(await getFiscalClosingYears());
}));

router.get('/accounting/fiscal-closing/preview', authorizePermission('accounting.vouchers'), validate(fiscalClosingPreviewQuerySchema), asyncHandler(async (req, res) => {
  const { year, closingDate, openingDateNewYear } = (req.query as ValidatedQuery<typeof fiscalClosingPreviewQuerySchema>) || {};
  const data = await AccountingService.getFiscalYearClosingPreview({
    year: year as string,
    closingDate: closingDate as string,
    openingDateNewYear: openingDateNewYear as string,
  });
  res.json(data);
}));

router.post('/accounting/fiscal-closing/execute', authorizePermission('accounting.fiscal_close'), validate(fiscalClosingExecuteSchema), asyncHandler(async (req, res) => {
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

// v9.0.161 (TD-543، تصمیم ت۲ مالک محصول): فقط آخرین سال بسته، با دلیل؛ ممیزی درون تراکنش بازگشایی ثبت می‌شود
router.post('/accounting/fiscal-closing/reopen', requirePermission('accounting.fiscal_reopen'), validate(fiscalYearReopenSchema), asyncHandler(async (req, res) => {
  const { year, reason } = req.body;
  const result = await reopenFiscalYear({
    year,
    reason,
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

export default router;
