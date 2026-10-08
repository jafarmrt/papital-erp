import { Router } from 'express';
import { authenticateToken, AUTH_COOKIE_NAME, getAuthCookieOptions } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, userHasRoleOrPermission, requireSystemAdmin } from '../middleware/authorize.js';
import { SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, storageDateParam } from '../middleware/validate.js';
import { parsePagination } from '../lib/pagination.js';
import { logActivity, extractClientIp, purgeOldAuditLogs, checkAuditLogIntegrity } from '../lib/auditLogger.js';
import { BUILD_INFO } from '../lib/version.js';
import { systemNowUtcIso } from '../lib/businessClock.js';
import { SystemSettingsService } from '../services/settings/systemSettings.service.js';
import { DataExportService } from '../services/system/dataExport.service.js';
import { ActivityLogQueryService } from '../services/system/activityLogQuery.service.js';
import { FactoryResetService } from '../services/system/factoryReset.service.js';
import { SystemHealthService } from '../services/system/systemHealth.service.js';
import { SystemReconciliationService } from '../services/system/systemReconciliation.service.js';
import { GlobalSearchService } from '../services/system/globalSearch.service.js';
import { DateCalendarReportService } from '../services/system/dateCalendarReport.service.js';

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

// TD-245 (§23): ورودی‌های مسیرهای تاریخچه ممیزی و اقدام اصلاحی ممیزی یکپارچگی
const optionalQueryText = (max: number) => z.string().max(max, `حداکثر ${max} نویسه مجاز است`).optional();
const digitsQuery = z.string().regex(/^\d+$/, 'باید عدد صحیح نامنفی باشد').optional();

export const activityLogsQuerySchema = z.object({
  query: z.object({
    page: digitsQuery,
    limit: digitsQuery,
    user: optionalQueryText(200),
    action: optionalQueryText(100),
    entity: optionalQueryText(200),
    category: z.enum(['all', 'auth_security', 'financial_docs', 'inventory_items', 'settings_system'], {
      message: 'دسته تاریخچه ممیزی نامعتبر است'
    }).optional(),
    search: optionalQueryText(200),
    startDate: storageDateParam,
    endDate: storageDateParam,
  }).optional()
});

export const purgeActivityLogsSchema = z.object({
  body: z.object({
    retentionDays: z.number({ message: 'مدت نگه‌داشت باید عدد باشد' }).int('مدت نگه‌داشت باید عدد صحیح باشد')
      .positive('مدت نگه‌داشت باید مثبت باشد').max(36500, 'مدت نگه‌داشت حداکثر ۳۶۵۰۰ روز است').optional(),
    // v9.0.212 (TD-522، تصمیم ت۴ الف): خاموش کردن حفاظت و پاک کردن زودتر از ۹۰ روز گزینه‌ای ندارد؛ کلید ناشناخته ۴۰۰ است
  }).strict().optional()
});

export const reconciliationFixSchema = z.object({
  body: z.object({
    action: z.enum(['requeue_dlq', 'clear_stuck_outbox'], { message: 'عملیات درخواستی نامعتبر است' }),
  })
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
router.get('/system/env', requireSystemAdmin, asyncHandler(async (req, res) => {
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username,
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
  const isAdmin = req.user?.role === SYSTEM_ADMIN_ROLE;
  if (isAdmin) {
    res.json(SystemSettingsService.revealSettingSecrets(safeSettings));
    return;
  }
  res.json(SystemSettingsService.maskSensitiveSettings(safeSettings));
}));

// v7.0.26 (TD-184 / audit P1-3): ذخیره فقط کلیدهای تغییرکرده با مجوز سطح کلید در SystemSettingsService
// (RULE 01: روت فقط اعتبارسنجی و فراخوانی سرویس). مجوز settings.manage هم‌راستا با نمایش منوی تنظیمات است.
router.post('/settings', authorizePermission('settings.manage'), validate(settingsSchema), asyncHandler(async (req, res) => {
  const result = await SystemSettingsService.saveSettings(req.body.settings, {
    id: req.user?.id,
    username: req.user?.username,
    fullName: req.user?.full_name,
    role: req.user?.role,
  });
  res.json({ success: true, ...result });
}));

router.get('/activity-logs', authorizePermission('audit_logs.view'), validate(activityLogsQuerySchema), asyncHandler(async (req, res) => {
  const query = (req.query || {}) as NonNullable<z.infer<typeof activityLogsQuerySchema>['query']>;
  // V9-1.3: صفحه‌بندی NaN-safe با سقف
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 30 });

  const { data, count } = await ActivityLogQueryService.listLogs({
    user: query.user,
    action: query.action,
    entity: query.entity,
    category: query.category,
    search: query.search,
    startDate: query.startDate,
    endDate: query.endDate,
  }, limit, offset);

  res.json({
    data,
    total: Number(count),
    page,
    limit,
    totalPages: Math.ceil(Number(count) / limit)
  });
}));

router.get('/activity-logs/filters', authorizePermission('audit_logs.view'), asyncHandler(async (req, res) => {
  res.json(await ActivityLogQueryService.getFilterOptions());
}));

// Purge old audit logs (Admin only with strict retention policy enforcement - Sub-phase 1.5 / D-2)
router.post('/activity-logs/purge', requireSystemAdmin, validate(purgeActivityLogsSchema), asyncHandler(async (req, res) => {
  const { retentionDays } = (req.body || {}) as NonNullable<z.infer<typeof purgeActivityLogsSchema>['body']>;
  const report = await purgeOldAuditLogs({
    retentionDays,
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
router.get('/activity-logs/integrity', authorizePermission('audit_logs.view'), asyncHandler(async (req, res) => {
  const integrity = await checkAuditLogIntegrity();
  res.json(integrity);
}));

// Admin clear data (Wipe & Reset all system operational data and users to trigger initial setup scenario)
router.post('/admin/clear-data', requireSystemAdmin, validate(clearDataSchema), asyncHandler(async (req, res) => {
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
router.get('/system/health', requireSystemAdmin, asyncHandler(async (req, res) => {
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
    // لحظه مطلق استعلام (UTC ISO) — مرورگر آن را در منطقه زمانی توافقی نمایش می‌دهد
    checkTimestamp: systemNowUtcIso()
  });
}));

// v7.0.131 (TD-232): گزارش فقط‌خواندنی تقویم ستون‌های تاریخ متنی (همان npm run dates:report)
router.get('/system/date-calendar-report', requireSystemAdmin, asyncHandler(async (_req, res) => {
  res.json(await DateCalendarReportService.buildReport());
}));

// Automated System Integrity & Reconciliation Scan
router.get('/system/reconciliation-check', requireSystemAdmin, asyncHandler(async (req, res) => {
  const { checks, okChecks, healthScorePercentage } = await SystemReconciliationService.runIntegrityScan();

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username,
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
    timestamp: systemNowUtcIso()
  });
}));

// Execute Non-Destructive Auto-Fix Actions
// TD-245: فقط رویدادهای حل‌نشده DLQ بازگردانده و علامت replayed می‌خورند (بدون حذف)، در یک تراکنش با ثبت ممیزی؛
// بازنشانی رویدادهای متوقف Outbox هم ثبت ممیزی دارد.
router.post('/system/reconciliation-fix', requireSystemAdmin, validate(reconciliationFixSchema), asyncHandler(async (req, res) => {
  const { action } = req.body as z.infer<typeof reconciliationFixSchema>['body'];
  const actor = {
    userId: req.user?.id,
    username: req.user?.username,
    fullName: req.user?.full_name,
    ipAddress: extractClientIp(req)
  };

  if (action === 'requeue_dlq') {
    const requeuedCount = await SystemReconciliationService.requeueDeadLetterEvents(actor);
    return res.json({ success: true, requeuedCount, message: `تعداد ${requeuedCount} رویداد از صف قرنطینه به صف پردازش Outbox منتقل شدند.` });
  }

  const resetCount = await SystemReconciliationService.resetStuckOutboxEvents(actor);
  return res.json({ success: true, resetCount, message: `تعداد ${resetCount} رویداد متوقف‌شده در حالت Processing با موفقیت بازنشانی شدند.` });
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
router.get('/export-backup', requireSystemAdmin, asyncHandler(async (req, res) => {
  const exportData = await DataExportService.buildExport();
  const tableCount = Object.keys((exportData.data as Record<string, unknown>) || {}).length;

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username,
    userFullName: req.user?.full_name || '',
    action: 'EXPORT',
    entity: 'سیستم:خروجی_داده‌ها',
    description: `دریافت خروجی داده‌های کسب‌وکاری شامل ${tableCount} جدول (بدون رمزهای عبور و کلیدهای محرمانه)`,
    ipAddress: extractClientIp(req)
  });

  res.setHeader('Content-Type', 'application/json');
  // TD-245: تاریخ نام فایل، تاریخ امروز کسب‌وکار (منطقه زمانی توافقی) است، نه تاریخ UTC
  res.setHeader('Content-Disposition', `attachment; filename="${await DataExportService.buildExportFileName()}"`);
  res.json(exportData);
}));

export default router;


