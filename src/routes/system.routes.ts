import { Router } from 'express';
import { authenticateToken, AUTH_COOKIE_NAME, getAuthCookieOptions } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize, userHasRoleOrPermission } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { parsePagination } from '../lib/pagination.js';
import { logActivity, extractClientIp, purgeOldAuditLogs, checkAuditLogIntegrity } from '../lib/auditLogger.js';
import { BUILD_INFO } from '../lib/version.js';
import { SystemSettingsService } from '../services/settings/systemSettings.service.js';
import { DataExportService } from '../services/system/dataExport.service.js';
import { ActivityLogQueryService } from '../services/system/activityLogQuery.service.js';
import { FactoryResetService } from '../services/system/factoryReset.service.js';
import { SystemHealthService } from '../services/system/systemHealth.service.js';
import { SystemReconciliationService } from '../services/system/systemReconciliation.service.js';
import { GlobalSearchService } from '../services/system/globalSearch.service.js';

const router = Router();

const settingsSchema = z.object({
  body: z.object({
    settings: z.array(z.object({
      key: z.string().min(1, 'کلید تنظیمات الزامی است'),
      value: z.string(),
    })).min(1, 'حداقل یک تنظیم باید ارسال شود'),
  })
});

const clearDataSchema = z.object({
  body: z.object({
    mode: z.string().optional(),
  }).optional()
});

router.use(authenticateToken);

// TD-105 (v4.0.31): تاریخ امروز کسب‌وکار از ساعت توافقی سرور — مرجع پیش‌فرض
// مودال‌های خزانه‌داری به‌جای new Date().toISOString() مرورگر کلاینت
router.get('/system/business-date', asyncHandler(async (req, res) => {
  const { businessTodayIsoDate, getDisplayTimezone } = await import('../lib/businessClock.js');
  res.json({
    success: true,
    data: {
      today: await businessTodayIsoDate(),
      timezone: await getDisplayTimezone()
    }
  });
}));

// V1.1.1: وضعیت محیط و فلگ‌های سیستمی — فقط set/not-set؛ هرگز مقدار secret ها
router.get('/system/env', authorize('admin'), asyncHandler(async (req, res) => {
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.full_name || '',
    action: 'VIEW',
    entity: 'سیستم:تنظیمات_محیطی',
    description: 'استعلام وضعیت متغیرهای محیطی و اتصال به پایگاه‌داده',
    ipAddress: extractClientIp(req)
  });
  res.json({
    version: BUILD_INFO.version,
    buildInfo: BUILD_INFO,
    db: process.env.DATABASE_URL ? 'set' : 'not set',
    nodeEnv: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    flags: {
      ERP_ALLOW_TEST_CLEANUP: process.env.ERP_ALLOW_TEST_CLEANUP ? 'set' : 'not set',
      ALLOW_SEED_IN_PRODUCTION: process.env.ALLOW_SEED_IN_PRODUCTION ? 'set' : 'not set',
      DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'not set',
      JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'not set',
      ERP_SETUP_TOKEN: process.env.ERP_SETUP_TOKEN ? 'set' : 'not set'
    }
  });
}));

// App Settings
// V3.0.6 (SEC): مقادیر حساس (secret/token/password) فقط برای ادمین برگردانده می‌شود؛
// سایر کاربران احراز هویت‌شده مقدار ماسک‌شده دریافت می‌کنند تا از افشای
// wc_consumer_secret / wc_webhook_secret / erp_webhook_secret_token جلوگیری شود.
// v7.0.26 (TD-184): الگوی کلیدهای حساس و مقدار ماسک در سرویس تنظیمات متمرکز شد (consumer_key نیز ماسک می‌شود)

router.get('/settings', asyncHandler(async (req, res) => {
  const safeSettings = await SystemSettingsService.getAllSettings();
  const isAdmin = req.user?.role === 'admin';
  if (isAdmin) {
    res.json(safeSettings);
    return;
  }
  res.json(SystemSettingsService.maskSensitiveSettings(safeSettings));
}));

// V10-5.3: نقشه دید منو per-role — خواندنی برای همه کاربران احراز هویت‌شده (سایدبار)
router.get('/menu-visibility', asyncHandler(async (req, res) => {
  const result = await SystemSettingsService.getMenuVisibility();
  return res.json(result);
}));

// v7.0.26 (TD-184 / audit P1-3): ذخیره فقط کلیدهای تغییرکرده با مجوز سطح کلید در SystemSettingsService
// (RULE 01: روت فقط اعتبارسنجی و فراخوانی سرویس). مجوز settings.manage هم‌راستا با نمایش منوی تنظیمات است.
router.post('/settings', authorize('admin', 'manager', 'settings.manage'), validate(settingsSchema), asyncHandler(async (req, res) => {
  const result = await SystemSettingsService.saveSettings(req.body.settings, {
    id: req.user?.id,
    username: req.user?.username,
    fullName: req.user?.full_name,
    role: req.user?.role,
  });
  res.json({ success: true, ...result });
}));

router.get('/activity-logs', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  // V9-1.3: صفحه‌بندی NaN-safe با سقف
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 30 });

  const { data, count } = await ActivityLogQueryService.listLogs({
    user: req.query.user as string,
    action: req.query.action as string,
    entity: req.query.entity as string,
    category: req.query.category as string,
    search: req.query.search as string,
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
  }, limit, offset);

  res.json({
    data,
    total: Number(count),
    page,
    limit,
    totalPages: Math.ceil(Number(count) / limit)
  });
}));

router.get('/activity-logs/filters', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  res.json(await ActivityLogQueryService.getFilterOptions());
}));

// Purge old audit logs (Admin only with strict retention policy enforcement - Sub-phase 1.5 / D-2)
router.post('/activity-logs/purge', authorize('admin'), asyncHandler(async (req, res) => {
  const { retentionDays, preserveCritical, allowForceRecent } = req.body || {};
  const report = await purgeOldAuditLogs({
    retentionDays: retentionDays !== undefined ? Number(retentionDays) : undefined,
    preserveCritical: preserveCritical !== undefined ? Boolean(preserveCritical) : true,
    allowForceRecent: Boolean(allowForceRecent),
    actorUsername: req.user?.username,
    actorUserId: req.user?.id,
    actorIp: extractClientIp(req)
  });

  res.json({
    success: true,
    message: `پاکسازی ایمن تاریخچه ممیزی با موفقیت انجام شد (${report.purgedCount} رکورد).`,
    report
  });
}));

// Audit log integrity and retention status check
router.get('/activity-logs/integrity', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  const integrity = await checkAuditLogIntegrity();
  res.json(integrity);
}));

// Admin clear data (Wipe & Reset all system operational data and users to trigger initial setup scenario)
router.post('/admin/clear-data', authorize('admin'), validate(clearDataSchema), asyncHandler(async (req, res) => {
  // P0-01 (ARCH-01): محافظت قطعی در برابر حذف فیزیکی دیتابیس در محیط پروداکشن
  // (نگهبان پیش از هر کاری اجرا می‌شود و FactoryResetService.wipeAndReseed آن را دوباره بررسی می‌کند)
  const actor = { username: req.user?.username, ip: extractClientIp(req) };
  FactoryResetService.assertAllowed(actor);

  try {
    // پاکسازی همه داده‌ها و کاربران در یک تراکنش و seed دوباره پیش‌فرض‌های استاندارد
    await FactoryResetService.wipeAndReseed(actor);

    // Clear authentication cookie so the current session terminates immediately
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions(req));

    res.json({
      success: true,
      isSetup: false,
      message: 'کلیه اطلاعات، حساب‌های کاربری و داده‌های سیستم با موفقیت پاکسازی شدند و سامانه به وضعیت راه‌اندازی اولیه بازنشانی گردید.'
    });
  } catch (err) {
    logger.error({ message: 'Error clearing system data', error: err });
    throw err;
  }
}));

// V3.0.7 (TD-065): اطلاعات زیرساخت (مسیر uploads، حافظه، پروتکل) فقط برای ادمین
router.get('/system/health', authorize('admin'), asyncHandler(async (req, res) => {
  // 1. Check DB Connection & Latency
  const dbStatus = await SystemHealthService.checkDatabase();

  // 2. Check Write Permissions on public/uploads
  const storageStatus = SystemHealthService.checkStorage();

  // 3. Subsystem Health Checks (Outbox, DLQ, Vouchers, Workflow)
  const subsystems = await SystemHealthService.collectSubsystemMetrics();

  // 4. Check HTTPS / SSL
  const forwardedProto = (req.headers['x-forwarded-proto'] as string) || '';
  const isHttps = req.secure || forwardedProto.toLowerCase() === 'https';

  // 5. Memory & Runtime
  const server = SystemHealthService.getServerRuntime();

  res.json({
    database: dbStatus,
    storage: storageStatus,
    outbox: subsystems.outbox,
    accounting: subsystems.accounting,
    workflow: subsystems.workflow,
    observability: { status: 'ok', contextTracing: true },
    network: {
      isHttps,
      protocol: req.protocol,
      forwardedProto: forwardedProto || 'تنظیم نشده',
      host: req.headers.host || ''
    },
    server,
    checkTimestamp: new Date().toISOString()
  });
}));

// Automated System Integrity & Reconciliation Scan
router.get('/system/reconciliation-check', authorize('admin'), asyncHandler(async (req, res) => {
  const { checks, okChecks, healthScorePercentage } = await SystemReconciliationService.runIntegrityScan();

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.full_name || '',
    action: 'AUDIT',
    entity: 'سیستم:ممیزی_و_تطبیق_داده‌ها',
    description: `اجرای ممیزی خودکار یکپارچگی سیستم - امتیاز سلامت: ${healthScorePercentage}% (${okChecks} از ${checks.length} چک موفق)`,
    ipAddress: extractClientIp(req)
  });

  res.json({
    healthScorePercentage,
    totalChecks: checks.length,
    okChecks,
    checks,
    timestamp: new Date().toISOString()
  });
}));

// Execute Non-Destructive Auto-Fix Actions
router.post('/system/reconciliation-fix', authorize('admin'), asyncHandler(async (req, res) => {
  const { action } = req.body || {};

  if (action === 'requeue_dlq') {
    const requeuedCount = await SystemReconciliationService.requeueDeadLetterEvents();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      userFullName: req.user?.full_name || '',
      action: 'RESTORE',
      entity: 'رویدادهای سیستم',
      description: `بازبازیابی و انتقال ${requeuedCount} رویداد قرنطینه DLQ به صف Outbox`
    });

    return res.json({ success: true, message: `تعداد ${requeuedCount} رویداد از صف قرنطینه به صف پردازش Outbox منتقل شدند.` });
  }

  if (action === 'clear_stuck_outbox') {
    await SystemReconciliationService.resetStuckOutboxEvents();

    return res.json({ success: true, message: 'رویدادهای متوقف‌شده در حالت Processing با موفقیت بازنشانی شدند.' });
  }

  return res.status(400).json({ error: 'عملیات درخواستی نامعتبر است' });
}));

// (v4.0.29) توابع assertTestEndpointsAllowed/assertTestEndpointsEnabled حذف شدند —
// روت‌های /system/tests/run و /system/clean-test-data حذف شده‌اند و اجرای
// آزمون‌ها فقط از طریق CLI استاندارد `npm run test` انجام می‌شود.

// Global Multi-Entity Search Route
// v7.0.53 (audit P2-10، تصمیم مالک محصول): هر بخش نتیجه فقط برای دارنده مجوز مشاهده همان بخش جستجو و برگردانده
// می‌شود (کالا: products.view، طرف حساب: customers.view، سند و فاکتور: documents.view، پروژه: projects.view)؛
// بخش بدون مجوز خالی است، نه خطا. پیش‌تر هر کاربر واردشده (مثلاً «کاربر ثبت گزارش») همه بخش‌ها را می‌گرفت.
// نویسه‌های % و _ ورودی هم escape می‌شوند.
router.get('/global-search', asyncHandler(async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) {
      return res.json({ items: [], customers: [], documents: [], projects: [] });
    }

    const [canItems, canCustomers, canDocuments, canProjects] = await Promise.all([
      userHasRoleOrPermission(req.user, 'products.view'),
      userHasRoleOrPermission(req.user, 'customers.view'),
      userHasRoleOrPermission(req.user, 'documents.view'),
      userHasRoleOrPermission(req.user, 'projects.view')
    ]);

    const result = await GlobalSearchService.search(q, {
      items: canItems,
      customers: canCustomers,
      documents: canDocuments,
      projects: canProjects
    });

    res.json(result);
  } catch (err) {
    logger.error({ message: 'Global search error', error: err });
    throw err;
  }
}));

// Export full database dump as JSON
// v7.0.29 (TD-188 / audit P1-6): خروجی امن داده‌ها (بدون هش رمز، رمز صرافی پرسنل و کلیدهای محرمانه؛
// شامل دفاتر حسابداری و کارمزدی) — نسخه پشتیبان قابل بازگردانی نیست؛ پشتیبان واقعی: scripts/backup.sh
router.get('/export-backup', authorize('admin'), asyncHandler(async (req, res) => {
  const exportData = await DataExportService.buildExport();
  const tableCount = Object.keys((exportData.data as Record<string, unknown>) || {}).length;

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.full_name || '',
    action: 'EXPORT',
    entity: 'سیستم:خروجی_داده‌ها',
    description: `دریافت خروجی داده‌های کسب‌وکاری شامل ${tableCount} جدول (بدون رمزهای عبور و کلیدهای محرمانه)`,
    ipAddress: extractClientIp(req)
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="erp-data-export-${new Date().toISOString().split('T')[0]}.json"`);
  res.json(exportData);
}));

export default router;


