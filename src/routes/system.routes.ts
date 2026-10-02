import { Router } from 'express';
import { desc, sql, eq, and, or, ilike, SQL } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import {
  appSettings, transactions, documentItems, documents, items,
  warehouses, itemPrices, customers, activityLogs, productionProjects, categories,
  projectStages, projectProductStageProgress, dailyWorkLogs, transfers, notifications, crmLeads, crmActivities,
  users, personnel, taskCategories, pieceworkTasks, pieceworkPersonnelRates, pieceworkTaskRateHistory,
  pieceworkLogs, pieceworkPayrolls, pendingMaterials, accounts, journalVouchers,
  journalVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  outboxEvents, deadLetterEvents, workflowInstances, workflowTasks,
  workflowHistoryLogs, workflowPendingApprovals, workflowDelegations,
  workflowDefinitionVersions, workflowTransitions, workflowStates, workflowDefinitions,
  eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions,
  projectBomAllocations, formDrafts, idempotencyKeys, woocommerceOrderLogs,
  documentRefCounters, itemCodeCounters, purchaseRequisitions
} from '../db/schema.js';
import { authenticateToken, AUTH_COOKIE_NAME, getAuthCookieOptions } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize, userHasRoleOrPermission } from '../middleware/authorize.js';
import { containsLikePattern } from '../lib/sqlLike.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { parsePagination } from '../lib/pagination.js';
import { ForbiddenError } from '../errors/customErrors.js';
import { logActivity, extractClientIp, purgeOldAuditLogs, checkAuditLogIntegrity } from '../lib/auditLogger.js';
import { isTestEndpointsEnabled, getTestEndpointsSource } from '../lib/runtimeFlags.js';
import { runSeed } from '../db/seed.js';
import { validateDbSchema } from '../db/migrator.js';
import { appSettingsCache } from '../lib/memoryCache.js';
import { BUILD_INFO } from '../lib/version.js';
import { SystemSettingsService, SENSITIVE_SETTING_PATTERN, MASKED_SETTING_VALUE } from '../services/settings/systemSettings.service.js';
import { DataExportService } from '../services/system/dataExport.service.js';

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
  const effectiveTestEndpoints = await isTestEndpointsEnabled();
  res.json({
    version: BUILD_INFO.version,
    buildInfo: BUILD_INFO,
    db: process.env.DATABASE_URL ? 'set' : 'not set',
    nodeEnv: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    effectiveTestEndpoints,
    testEndpointsSource: getTestEndpointsSource(),
    flags: {
      ENABLE_TEST_ENDPOINTS: process.env.ENABLE_TEST_ENDPOINTS ? 'set' : 'not set',
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
  try {
    const settings = await appSettingsCache.getOrSet('all_settings', async () => {
      return orm.select().from(appSettings);
    }, 60_000);
    const safeSettings = Array.isArray(settings) ? settings : [];
    const isAdmin = req.user?.role === 'admin';
    if (isAdmin) {
      res.json(safeSettings);
      return;
    }
    res.json(safeSettings.map((s: { key: string; value: string }) =>
      SENSITIVE_SETTING_PATTERN.test(s.key)
        ? { ...s, value: MASKED_SETTING_VALUE }
        : s
    ));
  } catch (err) {
    throw err;
  }
}));

// V10-5.3: نقشه دید منو per-role — خواندنی برای همه کاربران احراز هویت‌شده (سایدبار)
router.get('/menu-visibility', asyncHandler(async (req, res) => {
  try {
    const result = await appSettingsCache.getOrSet('menu_visibility', async () => {
      const [row] = await orm.select().from(appSettings).where(eq(appSettings.key, 'menu_visibility'));
      if (!row?.value) return {};
      try {
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }, 60_000);
    return res.json(result);
  } catch (err) {
    throw err;
  }
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
  try {
    // V9-1.3: صفحه‌بندی NaN-safe با سقف
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 30 });

    const userFilter = req.query.user as string;
    const actionFilter = req.query.action as string;
    const entityFilter = req.query.entity as string;
    const categoryFilter = req.query.category as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const conditions: SQL[] = [];

    if (categoryFilter === 'auth_security') {
      conditions.push(
        sql`(${activityLogs.action} IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT') OR ${activityLogs.entity} IN ('احراز هویت', 'کاربر', 'کاربران سیستم', 'پروفایل کاربر', 'نقش و دسترسی', 'نقش'))`
      );
    } else if (categoryFilter === 'financial_docs') {
      conditions.push(
        sql`(${activityLogs.entity} IN ('فاکتور', 'پیش‌فاکتور', 'اسناد انبار', 'اسناد انبار / پیش‌فاکتور', 'account', 'journal_voucher', 'bank_account', 'bank_reconciliation', 'treasury_transaction', 'treasury_transfer', 'treasury_reconciliation', 'cheque', 'فیش حقوقی', 'پرداخت حقوق', 'طرف حساب', 'تامین‌کننده', 'طرفین حساب') OR ${activityLogs.entity} ILIKE 'حسابداری%')`
      );
    } else if (categoryFilter === 'inventory_items') {
      conditions.push(
        sql`(${activityLogs.entity} IN ('کالا', 'کالاها_و_محصولات', 'قیمت کالا', 'ماده اولیه', 'موجودی انبار', 'انبار', 'انبارداری و موجودی', 'ترنسفر', 'پروژه تولید', 'پیشرفت به تفکیک کد کالا', 'عنوان پرکیسی', 'عناوین پرکیسی', 'کارکرد پرکیسی') OR ${activityLogs.entity} ILIKE '%کالا%' OR ${activityLogs.entity} ILIKE '%انبار%')`
      );
    } else if (categoryFilter === 'settings_system') {
      conditions.push(
        sql`(${activityLogs.action} IN ('SETTING_CHANGE', 'EXPORT', 'RESTORE', 'AUDIT_APPLY', 'RECONCILIATION_EXECUTE', 'SEED') OR ${activityLogs.entity} LIKE 'سیستم:%' OR ${activityLogs.entity} IN ('تنظیمات سیستم', 'صف خطاهای قرنطینه (DLQ)', 'رویدادهای سیستم'))`
      );
    }

    if (userFilter) {
      conditions.push(eq(activityLogs.username, userFilter));
    }
    if (actionFilter) {
      conditions.push(eq(activityLogs.action, actionFilter));
    }
    if (entityFilter) {
      conditions.push(eq(activityLogs.entity, entityFilter));
    }
    if (startDate) {
      conditions.push(sql`${activityLogs.timestamp} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${activityLogs.timestamp} <= ${endDate + ' 23:59:59'}`);
    }
    if (search) {
      conditions.push(
        sql`(${activityLogs.description} ILIKE ${containsLikePattern(search)} OR ${activityLogs.userFullName} ILIKE ${containsLikePattern(search)} OR ${activityLogs.username} ILIKE ${containsLikePattern(search)} OR ${activityLogs.entity} ILIKE ${containsLikePattern(search)})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await orm.select({
      log: activityLogs,
      resolvedFullName: users.fullName
    })
      .from(activityLogs)
      .leftJoin(users, eq(users.username, activityLogs.username))
      .where(whereClause)
      .orderBy(desc(activityLogs.id))
      .limit(limit)
      .offset(offset);

    // یک موجودیت هویت کاربر: نام کامل ثبت‌شده > نام کامل از جدول users > username
    const data = logs.map(({ log: l, resolvedFullName }) => ({
      ...l,
      userFullName: l.userFullName || resolvedFullName || l.username
    }));

    const [{ count }] = await orm.select({ count: sql<number>`count(*)` })
      .from(activityLogs)
      .where(whereClause);

    res.json({
      data,
      total: Number(count),
      page,
      limit,
      totalPages: Math.ceil(Number(count) / limit)
    });
  } catch (err) {
    throw err;
  }
}));

router.get('/activity-logs/filters', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  try {
    const rawUsers = await orm.selectDistinct({ username: activityLogs.username, fullName: activityLogs.userFullName }).from(activityLogs);
    const userMap = new Map<string, string>();
    rawUsers.forEach(u => {
      if (u.username) {
        if (!userMap.has(u.username) || (u.fullName && !userMap.get(u.username))) {
          userMap.set(u.username, u.fullName || '');
        }
      }
    });
    const users = Array.from(userMap.entries()).map(([username, fullName]) => ({ username, fullName }));

    const distinctActions = await orm.selectDistinct({ action: activityLogs.action }).from(activityLogs);
    const distinctEntities = await orm.selectDistinct({ entity: activityLogs.entity }).from(activityLogs);

    res.json({
      users,
      actions: distinctActions.map(a => a.action).filter(Boolean),
      entities: distinctEntities.map(e => e.entity).filter(Boolean)
    });
  } catch (err) {
    throw err;
  }
}));

// Purge old audit logs (Admin only with strict retention policy enforcement - Sub-phase 1.5 / D-2)
router.post('/activity-logs/purge', authorize('admin'), asyncHandler(async (req, res) => {
  try {
    const { retentionDays, preserveCritical, allowForceRecent } = req.body || {};
    const report = await purgeOldAuditLogs({
      retentionDays: retentionDays !== undefined ? Number(retentionDays) : undefined,
      preserveCritical: preserveCritical !== undefined ? Boolean(preserveCritical) : true,
      allowForceRecent: Boolean(allowForceRecent),
      actorUsername: (req as any).user?.username,
      actorUserId: (req as any).user?.id,
      actorIp: extractClientIp(req)
    });

    res.json({
      success: true,
      message: `پاکسازی ایمن تاریخچه ممیزی با موفقیت انجام شد (${report.purgedCount} رکورد).`,
      report
    });
  } catch (err) {
    throw err;
  }
}));

// Audit log integrity and retention status check
router.get('/activity-logs/integrity', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  try {
    const integrity = await checkAuditLogIntegrity();
    res.json(integrity);
  } catch (err) {
    throw err;
  }
}));

// Admin clear data (Wipe & Reset all system operational data and users to trigger initial setup scenario)
router.post('/admin/clear-data', authorize('admin'), validate(clearDataSchema), asyncHandler(async (req, res) => {
  // P0-01 (ARCH-01): محافظت قطعی در برابر حذف فیزیکی دیتابیس در محیط پروداکشن
  const isProd = process.env.NODE_ENV === 'production';
  const allowDangerousPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE === 'true';

  if (isProd || !allowDangerousPurge) {
    logger.error({
      message: 'Blocked unauthorized attempt to wipe all ERP operational data via /admin/clear-data',
      user: req.user?.username,
      nodeEnv: process.env.NODE_ENV,
      allowDangerousPurge,
      ip: extractClientIp(req)
    });
    throw new ForbiddenError(
      'عملیات حذف کل داده‌های سیستم در محیط پروداکشن یا بدون فعال‌سازی صریح متغیر ALLOW_DANGEROUS_DATA_PURGE اکیداً مسدود است (مطابق قانون بنیادین RULE 09).'
    );
  }

  try {
    logger.warn({
      message: 'Authorized /admin/clear-data execution started in non-production environment',
      user: req.user?.username,
      ip: extractClientIp(req)
    });

    await orm.transaction(async (tx) => {
      // 1. Logs, Webhooks, Outbox, DLQ, Drafts & Idempotency
      await tx.delete(eventActionLogs);
      await tx.delete(webhookDeliveries);
      await tx.delete(webhookSubscriptions);
      await tx.delete(eventActionRules);
      await tx.delete(deadLetterEvents);
      await tx.delete(outboxEvents);
      await tx.delete(woocommerceOrderLogs);
      await tx.delete(idempotencyKeys);
      await tx.delete(formDrafts);
      await tx.delete(activityLogs);
      await tx.delete(notifications);

      // 1.5. Purchase Requisitions (Must be deleted BEFORE workflowInstances, productionProjects, and users)
      await tx.delete(purchaseRequisitions);

      // 2. Workflow Tasks, Delegations, Instances, History & Definitions
      await tx.delete(workflowHistoryLogs);
      await tx.delete(workflowTasks);
      await tx.delete(workflowPendingApprovals);
      await tx.delete(workflowInstances);
      await tx.delete(workflowDelegations);
      await tx.delete(workflowDefinitionVersions);
      await tx.delete(workflowTransitions);
      await tx.delete(workflowStates);
      await tx.delete(workflowDefinitions);

      // 3. Project Dependencies & Allocations (Must be deleted BEFORE transactions, projectStages and productionProjects)
      await tx.delete(pieceworkLogs);
      await tx.delete(dailyWorkLogs);
      await tx.delete(projectProductStageProgress);
      await tx.delete(projectBomAllocations);
      await tx.delete(projectStages);
      await tx.delete(productionProjects);

      // 4. Treasury & Accounting Transactions (Must be deleted BEFORE documents and accounts)
      await tx.delete(treasuryTransactions);
      await tx.delete(cheques);
      await tx.delete(journalVoucherItems);
      await tx.delete(journalVouchers);
      await tx.delete(accountingSettings);
      await tx.delete(bankAccounts);
      await tx.delete(accounts);

      // 5. Inventory Transactions & Documents (Must be deleted BEFORE items, customers and crmLeads)
      await tx.delete(documentItems);
      await tx.delete(transactions);
      await tx.delete(documents);
      await tx.delete(documentRefCounters);
      await tx.delete(itemCodeCounters);

      // 6. CRM & Customer Relations (Must be deleted BEFORE personnel and customers)
      await tx.delete(crmActivities);
      await tx.delete(crmLeads);

      // 7. HR, Piecework & Payroll Records (Must be deleted AFTER CRM and projects)
      await tx.delete(pieceworkPayrolls);
      await tx.delete(pieceworkPersonnelRates);
      await tx.delete(pieceworkTaskRateHistory);
      await tx.delete(pieceworkTasks);
      await tx.delete(taskCategories);
      await tx.delete(personnel);

      // 9. Materials, Transfers, Items & Customers
      await tx.delete(pendingMaterials);
      await tx.delete(transfers);
      await tx.delete(itemPrices);
      await tx.delete(items);
      await tx.delete(customers);

      // 10. Categories, Warehouses & Settings
      await tx.delete(categories);
      await tx.delete(warehouses);
      await tx.delete(appSettings);

      // 11. Users (Wipe all user accounts to return system to initial setup state)
      await tx.delete(users);
    });

    // Re-seed system standard defaults (22 categories, default warehouse, standard chart of accounts, task categories, piecework tasks, system roles)
    await runSeed();

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

import fs from 'fs';
import path from 'path';
import { errorMessageOf } from '../utils.js';

// V3.0.7 (TD-065): اطلاعات زیرساخت (مسیر uploads، حافظه، پروتکل) فقط برای ادمین
router.get('/system/health', authorize('admin'), asyncHandler(async (req, res) => {
  let dbStatus = { status: 'ok', latencyMs: 0, message: 'پایگاه‌داده PostgreSQL متصل و آماده است' };
  
  // 1. Check DB Connection & Latency
  try {
    const dbStart = Date.now();
    await orm.execute(sql`SELECT 1`);
    dbStatus.latencyMs = Date.now() - dbStart;
  } catch (e) {
    dbStatus.status = 'error';
    dbStatus.message = `خطا در اتصال به پایگاه‌داده: ${errorMessageOf(e)}`;
  }

  // 2. Check Write Permissions on public/uploads
  let storageStatus = { status: 'ok', writable: true, uploadsPath: '', message: 'پوشه ذخیره‌سازی تصاویر قابل نوشتن است' };
  try {
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    storageStatus.uploadsPath = uploadsDir;
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFile = path.join(uploadsDir, `.test-write-${Date.now()}`);
    fs.writeFileSync(testFile, 'write-test');
    fs.unlinkSync(testFile);
  } catch (e) {
    storageStatus.status = 'error';
    storageStatus.writable = false;
    storageStatus.message = `خطای دسترسی نوشتن به پوشه تصاویر: ${errorMessageOf(e)}`;
  }

  // 3. Subsystem Health Checks (Outbox, DLQ, Vouchers, Workflow)
  let outboxMetrics = { pendingCount: 0, dlqCount: 0, status: 'ok' };
  let accountingMetrics = { totalVouchers: 0, unbalancedVouchers: 0, status: 'ok' };
  let workflowMetrics = { activeInstances: 0, overdueSlaTasks: 0, status: 'ok' };

  try {
    const [pendingRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(outboxEvents).where(eq(outboxEvents.status, 'pending'));
    const [dlqRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(deadLetterEvents);
    outboxMetrics.pendingCount = pendingRes?.count || 0;
    outboxMetrics.dlqCount = dlqRes?.count || 0;
    if (outboxMetrics.dlqCount > 0) outboxMetrics.status = 'warning';

    const [vouchersRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(journalVouchers);
    accountingMetrics.totalVouchers = vouchersRes?.count || 0;

    const [wfRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowInstances).where(eq(workflowInstances.status, 'IN_PROGRESS'));
    const [overdueRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowTasks)
      .where(and(eq(workflowTasks.status, 'pending'), sql`due_at IS NOT NULL AND due_at < now()`));
    workflowMetrics.activeInstances = wfRes?.count || 0;
    workflowMetrics.overdueSlaTasks = overdueRes?.count || 0;
    if (workflowMetrics.overdueSlaTasks > 0) workflowMetrics.status = 'warning';
  } catch (err) {
    logger.warn({ message: 'Health Check Subsystems Warning', error: err });
  }

  // 4. Check HTTPS / SSL
  const forwardedProto = (req.headers['x-forwarded-proto'] as string) || '';
  const isHttps = req.secure || forwardedProto.toLowerCase() === 'https';

  // 5. Memory & Runtime
  const mem = process.memoryUsage();
  const memoryUsageMb = {
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024),
  };

  res.json({
    database: dbStatus,
    storage: storageStatus,
    outbox: outboxMetrics,
    accounting: accountingMetrics,
    workflow: workflowMetrics,
    observability: { status: 'ok', contextTracing: true },
    network: {
      isHttps,
      protocol: req.protocol,
      forwardedProto: forwardedProto || 'تنظیم نشده',
      host: req.headers.host || ''
    },
    server: {
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb
    },
    checkTimestamp: new Date().toISOString()
  });
}));

// Automated System Integrity & Reconciliation Scan
router.get('/system/reconciliation-check', authorize('admin'), asyncHandler(async (req, res) => {
  try {
    const checks: Array<{ id: string; category: string; title: string; status: 'ok' | 'warning' | 'error'; details: string }> = [];

    // Check 1: Database Schema Validation
    const schemaReport = await validateDbSchema();
    checks.push({
      id: 'db_schema',
      category: 'پایگاه‌داده',
      title: 'ارزیابی ساختار و ایندکس‌های PostgreSQL',
      status: schemaReport.valid ? 'ok' : 'warning',
      details: schemaReport.valid ? 'تمامی جداول و لایه‌های ایندکس منطبق با Schema رسمی هستند.' : `تعداد ${schemaReport.missingTables.length} جدول ناموجود یافت شد.`
    });

    // Check 2: Outbox & DLQ Quarantine Check
    const [dlqCountRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(deadLetterEvents);
    const dlqCount = dlqCountRes?.count || 0;
    checks.push({
      id: 'outbox_dlq',
      category: 'صف رویدادها (Outbox / DLQ)',
      title: 'سلامت صف پیام‌ها و قرنطینه خطاها',
      status: dlqCount === 0 ? 'ok' : 'warning',
      details: dlqCount === 0 ? 'هیچ رویدادی در صف قرنطینه DLQ دچار خطا نشده است.' : `تعداد ${dlqCount} رویداد ناموفق در صف قرنطینه DLQ موجود است که نیازمند بازبینی/Replay است.`
    });

    // Check 3: Accounting Journal Vouchers Integrity
    const unbalancedQuery = await orm.execute(sql`
      SELECT jv.id, jv.voucher_number
      FROM journal_vouchers jv
      JOIN journal_voucher_items jvi ON jvi.voucher_id = jv.id
      GROUP BY jv.id, jv.voucher_number
      HAVING SUM(jvi.debit) <> SUM(jvi.credit)
    `);
    const unbalancedCount = unbalancedQuery.rows?.length || 0;
    checks.push({
      id: 'accounting_vouchers',
      category: 'حسابداری دوبل',
      title: 'موازنه بدهکار/بستانکار اسناد حسابداری',
      status: unbalancedCount === 0 ? 'ok' : 'error',
      details: unbalancedCount === 0 ? 'تمام اسناد حسابداری ثبت‌شده ۱۰۰٪ تراز و متوازن هستند.' : `تعداد ${unbalancedCount} سند ناهمتراز شناسایی شد که مجموع بدهکار و بستانکار آنها برابر نیست.`
    });

    // Check 4: Inventory Items Count & Stock Consistency
    const [itemsCountRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(items);
    checks.push({
      id: 'inventory_kardex',
      category: 'انبارداری و کالاهها',
      title: 'بررسی لایه موجودی و کالاها',
      status: 'ok',
      details: `تعداد کل کالاها و مواد اولیه فعال در سیستم: ${itemsCountRes?.count || 0} قلم`
    });

    // Check 5: Workflow Engine SLA SLA Overdues
    const [overdueTasksRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowTasks)
      .where(and(eq(workflowTasks.status, 'pending'), sql`due_at IS NOT NULL AND due_at < now()`));
    const overdueCount = overdueTasksRes?.count || 0;
    checks.push({
      id: 'workflow_sla',
      category: 'فرآیندها و SLA',
      title: 'پایش زمان‌سنجی و مهلت تاییدات فرآیندها',
      status: overdueCount === 0 ? 'ok' : 'warning',
      details: overdueCount === 0 ? 'تمامی کارتابل‌های تایید در مهلت SLA مجاز خود قرار دارند.' : `تعداد ${overdueCount} وظیفه ارجاع‌شده در کارتابل‌ها از مهلت قانونی SLA عبور کرده‌اند.`
    });

    // Compute Health Score Percentage
    const okChecks = checks.filter(c => c.status === 'ok').length;
    const healthScorePercentage = Math.round((okChecks / checks.length) * 100);

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
  } catch (err) {
    throw err;
  }
}));

// Execute Non-Destructive Auto-Fix Actions
router.post('/system/reconciliation-fix', authorize('admin'), asyncHandler(async (req, res) => {
  try {
    const { action } = req.body || {};

    if (action === 'requeue_dlq') {
      const dlqEvents = await orm.select().from(deadLetterEvents);
      let requeuedCount = 0;

      for (const dlq of dlqEvents) {
        await orm.insert(outboxEvents).values({
          eventId: `${dlq.originalEventId}_replayed_${Date.now()}`,
          eventType: dlq.eventType,
          aggregateType: dlq.aggregateType,
          aggregateId: dlq.aggregateId,
          status: 'pending',
          payload: dlq.payload || {},
          metadata: { ...((dlq.metadata as Record<string, any>) || {}), replayedFromDlq: true },
          retryCount: 0
        }).onConflictDoNothing();

        await orm.delete(deadLetterEvents).where(eq(deadLetterEvents.id, dlq.id));
        requeuedCount++;
      }

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
      await orm.update(outboxEvents)
        .set({ status: 'pending', retryCount: 0 })
        .where(and(eq(outboxEvents.status, 'processing'), sql`occurred_at < now() - interval '5 minutes'`));

      return res.json({ success: true, message: 'رویدادهای متوقف‌شده در حالت Processing با موفقیت بازنشانی شدند.' });
    }

    return res.status(400).json({ error: 'عملیات درخواستی نامعتبر است' });
  } catch (err) {
    throw err;
  }
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

    const searchTerm = containsLikePattern(q);
    const [canItems, canCustomers, canDocuments, canProjects] = await Promise.all([
      userHasRoleOrPermission(req.user, 'products.view'),
      userHasRoleOrPermission(req.user, 'customers.view'),
      userHasRoleOrPermission(req.user, 'documents.view'),
      userHasRoleOrPermission(req.user, 'projects.view')
    ]);

    // 1. Products & Raw Materials
    let matchingItems: Array<{
      id: number;
      name: string;
      code: string;
      type: string;
      category: string | null;
      unit: string | null;
      currentStock: number | null;
      thumbnail: string | null;
    }> = [];
    if (canItems) {
      try {
        matchingItems = await orm.select({
          id: items.id,
          name: items.name,
          code: items.code,
          type: items.type,
          category: items.category,
          unit: items.unit,
          currentStock: items.currentStock,
          thumbnail: items.thumbnail
        })
        .from(items)
        .where(
          and(
            eq(items.isDeleted, 0),
            or(
              ilike(items.name, searchTerm),
              ilike(items.code, searchTerm),
              ilike(items.category, searchTerm),
              ilike(items.material, searchTerm),
              ilike(items.color, searchTerm)
            )
          )
        )
        .limit(10);
      } catch (e) {
        logger.error({ message: 'Error fetching search items', error: e });
      }
    }

    // 2. Customers
    let matchingCustomers: Array<{
      id: number;
      name: string;
      city: string | null;
      province: string | null;
      address: string | null;
    }> = [];
    if (canCustomers) {
      try {
        matchingCustomers = await orm.select({
          id: customers.id,
          name: customers.name,
          city: customers.city,
          province: customers.province,
          address: customers.address
        })
        .from(customers)
        .where(
          and(
            eq(customers.isDeleted, 0),
            or(
              ilike(customers.name, searchTerm),
              ilike(customers.city, searchTerm),
              ilike(customers.province, searchTerm),
              ilike(customers.phone, searchTerm)
            )
          )
        )
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search customers', error: e });
      }
    }

    // 3. Documents & Invoices
    let matchingDocuments: Array<{
      id: number;
      ref_number: string;
      buyer_name: string | null;
      type: string;
      date: string;
    }> = [];
    if (canDocuments) {
      try {
        matchingDocuments = await orm.select({
          id: documents.id,
          ref_number: documents.refNumber,
          buyer_name: documents.buyerName,
          type: documents.type,
          date: documents.date
        })
        .from(documents)
        .where(
          and(
            eq(documents.isDeleted, 0),
            or(
              ilike(documents.refNumber, searchTerm),
              ilike(documents.buyerName, searchTerm),
              ilike(documents.notes, searchTerm)
            )
          )
        )
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search documents', error: e });
      }
    }

    // 4. Projects
    let matchingProjects: Array<{
      id: number;
      project_code: string;
      title: string;
      status: string | null;
      customer_name: string | null;
    }> = [];
    if (canProjects) {
      try {
        matchingProjects = await orm.select({
          id: productionProjects.id,
          project_code: productionProjects.projectCode,
          title: productionProjects.title,
          status: productionProjects.status,
          customer_name: productionProjects.customerName
        })
        .from(productionProjects)
        .where(
          and(
            eq(productionProjects.isDeleted, 0),
            or(
              ilike(productionProjects.title, searchTerm),
              ilike(productionProjects.projectCode, searchTerm),
              ilike(productionProjects.customerName, searchTerm)
            )
          )
        )
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search projects', error: e });
      }
    }

    res.json({
      items: matchingItems,
      customers: matchingCustomers,
      documents: matchingDocuments,
      projects: matchingProjects
    });
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


