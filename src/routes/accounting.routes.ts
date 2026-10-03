/**
 * ورودی یگانه مسیرهای حسابداری (در app.ts زیر /api سوار می‌شود).
 * هر زیرروتر یکی از شش زیرسرویس حسابداری را پوشش می‌دهد (AGENTS.md §11)؛ authenticateToken یک بار
 * در همین روتر و پیش از همه زیرروترها اعمال می‌شود. مسیرهای دو زیرروتر هیچ URL مشترکی ندارند،
 * پس ترتیب سوار شدن زیرروترها بر انطباق مسیرها اثری ندارد؛ ترتیب مسیرها درون هر زیرروتر حفظ شده است.
 */
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import accountsRoutes from './accounting/accounts.routes.js';
import vouchersRoutes from './accounting/vouchers.routes.js';
import treasuryRoutes from './accounting/treasury.routes.js';
import reportsRoutes from './accounting/reports.routes.js';
import voucherSyncRoutes from './accounting/voucherSync.routes.js';
import fiscalRoutes from './accounting/fiscal.routes.js';

// طرح‌های Zod پیش‌تر از همین فایل صادر می‌شدند؛ واردکننده‌های قبلی (آزمون‌ها) بدون تغییر کار می‌کنند.
export * from './accounting/accounting.schemas.js';

const router = Router();
router.use(authenticateToken); // Protect all accounting routes

router.use(accountsRoutes);     // ChartOfAccountsService + AccountMappingService
router.use(vouchersRoutes);     // VoucherService
router.use(treasuryRoutes);     // TreasuryService (بانک، صندوق، دریافت و پرداخت، چک)
router.use(reportsRoutes);      // AccountingReportService (+ بازرس سلامت مالی، گزارش پروژه، امضای چاپ)
router.use(voucherSyncRoutes);  // VoucherSyncService
router.use(fiscalRoutes);       // FiscalYearService

export default router;
