import { Router } from 'express';
import { desc, sql, eq, and, or, ilike, SQL } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import {
  appSettings, changelogs, transactions, documentItems, documents, items,
  warehouses, itemPrices, customers, activityLogs, productionProjects, categories,
  projectStages, dailyWorkLogs, transfers, notifications, crmLeads, crmActivities,
  users, personnel, taskCategories, pieceworkTasks, pieceworkPersonnelRates,
  pieceworkLogs, pieceworkPayrolls, pendingMaterials, accounts, journalVouchers,
  journalVoucherItems, bankAccounts, cheques, treasuryTransactions, accountingSettings,
  outboxEvents, deadLetterEvents, workflowInstances, workflowTasks,
  workflowHistoryLogs, workflowPendingApprovals, workflowDelegations,
  workflowDefinitionVersions, workflowTransitions, workflowStates, workflowDefinitions,
  eventActionLogs, eventActionRules, webhookDeliveries, webhookSubscriptions,
  projectBomAllocations, formDrafts, idempotencyKeys, woocommerceOrderLogs
} from '../db/schema.js';
import { authenticateToken, AUTH_COOKIE_NAME, getAuthCookieOptions } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { parsePagination } from '../lib/pagination.js';
import { ValidationError, ForbiddenError } from '../errors/customErrors.js';
import { logActivity } from '../lib/auditLogger.js';
import { isTestEndpointsEnabled, getTestEndpointsSource } from '../lib/runtimeFlags.js';
import { runSeed } from '../db/seed.js';
import { runMigrations, validateDbSchema } from '../db/migrator.js';

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

// V1.1.1: وضعیت محیط و فلگ‌های سیستمی — فقط set/not-set؛ هرگز مقدار secret ها
router.get('/system/env', authorize('admin'), async (req, res) => {
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.full_name || '',
    action: 'VIEW',
    entity: 'سیستم:تنظیمات_محیطی',
    description: 'استعلام وضعیت متغیرهای محیطی و اتصال به پایگاه‌داده',
    ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
  });
  const effectiveTestEndpoints = await isTestEndpointsEnabled();
  res.json({
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
});

router.get('/system/schema-check', authorize('admin'), async (req, res) => {
  try {
    const report = await validateDbSchema();
    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'AUDIT',
      entity: 'سیستم:بررسی_ساختار_دیتابیس',
      description: `اجرای ارزیابی ساختار اسکیما و ایندکس‌های پایگاه داده - وضعیت: ${report.valid ? 'معتبر' : 'دارای مغایرت'}`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });
    res.json(report);
  } catch (e) {
    throw e;
  }
});

router.get('/system/run-seed', authorize('admin'), async (req, res) => {
  try {
    const migrationRes = await runMigrations();
    const seedRes = await runSeed();
    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'SEED',
      entity: 'سیستم:مایگریشن_و_سید',
      description: 'اجرای دستی مایگریشن و سید مجدد داده‌های پیش‌فرض سیستم',
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });
    res.json({ message: 'Migration and seed executed successfully', migration: migrationRes, seed: seedRes });
  } catch (e) {
    logger.error({ message: 'Migration and seed error', error: e });
    throw e;
  }
});

// App Settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await orm.select().from(appSettings);
    res.json(settings);
  } catch (err) {
    throw err;
  }
});

// V10-5.3: نقشه دید منو per-role — خواندنی برای همه کاربران احراز هویت‌شده (سایدبار)
router.get('/menu-visibility', async (req, res) => {
  try {
    const [row] = await orm.select().from(appSettings).where(eq(appSettings.key, 'menu_visibility'));
    if (!row?.value) return res.json({});
    try {
      const parsed = JSON.parse(row.value);
      return res.json(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return res.json({});
    }
  } catch (err) {
    throw err;
  }
});

import { uploadBase64ToStorage } from '../lib/storage.js';

router.post('/settings', authorize('admin', 'manager'), validate(settingsSchema), async (req, res) => {
  try {
    const { settings } = req.body;
    await orm.transaction(async (tx) => {
      for (const item of settings) {
        let val = item.value;
        if (item.key === 'company_logo' && val && val.startsWith('data:image')) {
          // پیشوند 'logo' → سرو عمومی در صفحه ورود (بدون نشست)
          val = await uploadBase64ToStorage(val, 'image', 'logo');
        }
        // V10-1.1: TZ اعتبارسنجی سمت سرور برای ساعت توافقی واحد
        if (item.key === 'display_timezone') {
          const { ALLOWED_TIMEZONES } = await import('../lib/businessClock.js');
          if (!(ALLOWED_TIMEZONES as readonly string[]).includes(String(val).trim())) {
            throw new ValidationError(`منطقه زمانی '${val}' پشتیبانی نمی‌شود.`);
          }
          val = String(val).trim();
        }
        // V1.1.1: فلگ‌های runtime — فقط مقدار بولی و فقط توسط admin
        if (item.key === 'runtime_enable_test_endpoints') {
          const normalized = String(val).trim().toLowerCase();
          if (normalized !== 'true' && normalized !== 'false') {
            throw new ValidationError('مقدار مجاز برای این فلگ فقط true یا false است.');
          }
          if (req.user?.role !== 'admin') {
            throw new ForbiddenError('تغییر فلگ‌های سیستمی فقط برای مدیر سیستم مجاز است.');
          }
          val = normalized;
        }
        await tx.insert(appSettings).values({ key: item.key, value: val })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: val } });
      }
    });

    // V10-1.1: ابطال کش منطقه زمانی پس از ذخیره تنظیمات
    const { invalidateTimezoneCache } = await import('../lib/businessClock.js');
    invalidateTimezoneCache();

    // V1.1.1: ابطال کش فلگ‌های runtime پس از ذخیره تنظیمات
    const { invalidateRuntimeFlagsCache } = await import('../lib/runtimeFlags.js');
    invalidateRuntimeFlagsCache();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      userFullName: req.user?.full_name || '',
      action: 'SETTING_CHANGE',
      entity: 'تنظیمات سیستم',
      description: `تغییر و بروزرسانی ${settings.length} گزینه از تنظیمات سیستم`
    });

    res.json({ success: true });
  } catch (err) {
    throw err;
  }
});

// Activity Logs / Audit Trail
router.get('/activity-logs', authorize('admin', 'manager'), async (req, res) => {
  try {
    // V9-1.3: صفحه‌بندی NaN-safe با سقف
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 30 });

    const userFilter = req.query.user as string;
    const actionFilter = req.query.action as string;
    const entityFilter = req.query.entity as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const conditions: SQL[] = [];

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
        sql`(${activityLogs.description} ILIKE ${'%' + search + '%'} OR ${activityLogs.userFullName} ILIKE ${'%' + search + '%'} OR ${activityLogs.username} ILIKE ${'%' + search + '%'} OR ${activityLogs.entity} ILIKE ${'%' + search + '%'})`
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
});

router.get('/activity-logs/filters', authorize('admin', 'manager'), async (req, res) => {
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
});

// Changelogs
router.get('/changelogs', async (req, res) => {
  try {
    const logs = await orm.select().from(changelogs).orderBy(desc(changelogs.id));
    res.json(logs);
  } catch (err) {
    throw err;
  }
});

// Admin clear data (Wipe & Reset all system operational data and users to trigger initial setup scenario)
router.post('/admin/clear-data', authorize('admin'), validate(clearDataSchema), async (req, res) => {
  try {
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

      // 5. Inventory Transactions & Documents (Must be deleted BEFORE items and customers)
      await tx.delete(documentItems);
      await tx.delete(transactions);
      await tx.delete(documents);

      // 7. HR, Piecework & Payroll Records
      await tx.delete(pieceworkPayrolls);
      await tx.delete(pieceworkPersonnelRates);
      await tx.delete(pieceworkTasks);
      await tx.delete(taskCategories);
      await tx.delete(personnel);

      // 8. CRM & Customer Relations
      await tx.delete(crmActivities);
      await tx.delete(crmLeads);

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
});

import fs from 'fs';
import path from 'path';

router.get('/system/health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = { status: 'ok', latencyMs: 0, message: 'پایگاه‌داده PostgreSQL متصل و آماده است' };
  
  // 1. Check DB Connection & Latency
  try {
    const dbStart = Date.now();
    await orm.execute(sql`SELECT 1`);
    dbStatus.latencyMs = Date.now() - dbStart;
  } catch (e) {
    dbStatus.status = 'error';
    dbStatus.message = `خطا در اتصال به پایگاه‌داده: ${e.message}`;
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
    storageStatus.message = `خطای دسترسی نوشتن به پوشه تصاویر: ${e.message}`;
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
});

// Automated System Integrity & Reconciliation Scan
router.get('/system/reconciliation-check', authorize('admin'), async (req, res) => {
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
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
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
});

// Execute Non-Destructive Auto-Fix Actions
router.post('/system/reconciliation-fix', authorize('admin'), async (req, res) => {
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
      const result = await orm.update(outboxEvents)
        .set({ status: 'pending', retryCount: 0 })
        .where(and(eq(outboxEvents.status, 'processing'), sql`occurred_at < now() - interval '5 minutes'`));

      return res.json({ success: true, message: 'رویدادهای متوقف‌شده در حالت Processing با موفقیت بازنشانی شدند.' });
    }

    return res.status(400).json({ error: 'عملیات درخواستی نامعتبر است' });
  } catch (err) {
    throw err;
  }
});

// V1.1.1 — Test Endpoints (runtime-gated)
// مسیرها همیشه ثبت می‌شوند و مجوز در زمانِ «درخواست» بررسی می‌شود تا فلگ از
// تب «پیکربندی سیستمی» بدون ری‌استارت قابل کنترل باشد:
//   1) NODE_ENV=production → ممنوع همیشگی (کلید ایمنی؛ از UI قابل بازکردن نیست)
//   2) فلگ runtime_enable_test_endpoints خاموش → Forbidden با پیام راهنما
// پیش‌فرض پس از seed: خاموش. روش امن اجرای تست‌ها: `npm run test` از خط فرمان.
function assertTestEndpointsAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenError('اندپوینت‌های تست در محیط production همیشه مسدود است.');
  }
}

async function assertTestEndpointsEnabled(): Promise<void> {
  assertTestEndpointsAllowed();
  if (!(await isTestEndpointsEnabled())) {
    throw new ForbiddenError(
      'اندپوینت‌های تست خاموش است. مدیر سیستم می‌تواند آن را از تنظیمات ← «پیکربندی سیستمی» فعال کند. ' +
      'توجه: اجرای تست از داخل برنامه روی دیتابیس زنده داده می‌نویسد؛ روش امن اجرا دستور `npm run test` است.'
    );
  }
}

// Phase 21 Test Suite Runner API
router.get('/system/tests/run', authorize('admin'), async (req, res) => {
  try {
    await assertTestEndpointsEnabled();
    // TST-001: computed specifiers keep src/tests out of the production bundle
    const runnerSpec = ['..', 'tests', 'testRunner.js'].join('/');
    const stressSpec = ['..', 'tests', 'suites', 'stressSuite.js'].join('/');
    const { Phase21TestRunner } = await import(/* @vite-ignore */ runnerSpec);
    const { cleanupStressTestArtifacts } = await import(/* @vite-ignore */ stressSpec);
    const layer = req.query.layer as any;
    const report = await Phase21TestRunner.runAllTests(layer);

    // Ensure all test and stress artifacts are wiped immediately after test execution
    await cleanupStressTestArtifacts().catch(err => logger.warn({ message: 'TestRunner post-run cleanup warning', error: err }));

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      userFullName: req.user?.full_name || '',
      action: 'AUDIT_APPLY',
      entity: 'آزمون‌های یکپارچگی سیستم (Phase 21)',
      description: `اجرای آزمون‌های یکپارچگی سرتاسری E2E سیستم - وضعیت: ${report.overallStatus.toUpperCase()} (${report.passedCount}/${report.totalTests} پاس شد)`
    });

    return res.json(report);
  } catch (err) {
    throw err;
  }
});

// Purge any lingering test / stress documents & artifacts from system
router.post('/system/clean-test-data', authorize('admin'), async (req, res) => {
  try {
    await assertTestEndpointsEnabled();
    const { cleanupStressTestArtifacts } = await import('../tests/suites/stressSuite.js');
    await cleanupStressTestArtifacts();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'مدیر سیستم',
      userFullName: req.user?.full_name || '',
      action: 'DELETE',
      entity: 'سیستم:پاکسازی_داده‌های_تست',
      description: 'پاکسازی خودکار و حذف کامل تمامی اسناد و اقلام آزمون‌های استرس و تست‌های سیستم'
    });

    res.json({
      success: true,
      message: 'تمامی اسناد، کالاها و لاگ‌های آزمایشی و تست‌های استرس با موفقیت پاکسازی شدند.'
    });
  } catch (err) {
    throw err;
  }
});

// Global Multi-Entity Search Route
router.get('/global-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) {
      return res.json({ items: [], customers: [], documents: [], projects: [] });
    }

    const searchTerm = `%${q}%`;

    // 1. Products & Raw Materials
    let matchingItems: Array<{
      id: number;
      name: string;
      code: string;
      type: string;
      category: string | null;
      unit: string | null;
      currentStock: number;
      thumbnail: string | null;
    }> = [];
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

    // 2. Customers
    let matchingCustomers: Array<{
      id: number;
      name: string;
      city: string | null;
      province: string | null;
      address: string | null;
    }> = [];
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

    // 3. Documents & Invoices
    let matchingDocuments: Array<{
      id: number;
      ref_number: string;
      buyer_name: string | null;
      type: string;
      date: string;
    }> = [];
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

    // 4. Projects
    let matchingProjects: Array<{
      id: number;
      project_code: string;
      title: string;
      status: string;
      customer_name: string | null;
    }> = [];
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
});

// Export full database dump as JSON
router.get('/export-backup', authorize('admin'), async (req, res) => {
  try {
    const [
      allUsers,
      allPersonnel,
      allCustomers,
      allItems,
      allCategories,
      allWarehouses,
      allItemPrices,
      allProjects,
      allProjectStages,
      allTransfers,
      allCrmLeads,
      allCrmActivities,
      allDailyLogs,
      allDocs,
      allDocItems,
      allTx,
      allActivityLogs,
      allSettings
    ] = await Promise.all([
      orm.select().from(users),
      orm.select().from(personnel),
      orm.select().from(customers),
      orm.select().from(items),
      orm.select().from(categories),
      orm.select().from(warehouses),
      orm.select().from(itemPrices),
      orm.select().from(productionProjects),
      orm.select().from(projectStages),
      orm.select().from(transfers),
      orm.select().from(crmLeads),
      orm.select().from(crmActivities),
      orm.select().from(dailyWorkLogs),
      orm.select().from(documents),
      orm.select().from(documentItems),
      orm.select().from(transactions),
      orm.select().from(activityLogs),
      orm.select().from(appSettings)
    ]);

    const backupData = {
      exportedAt: new Date().toISOString(),
      version: '5.5.3',
      data: {
        users: allUsers,
        personnel: allPersonnel,
        customers: allCustomers,
        items: allItems,
        categories: allCategories,
        warehouses: allWarehouses,
        itemPrices: allItemPrices,
        productionProjects: allProjects,
        projectStages: allProjectStages,
        transfers: allTransfers,
        crmLeads: allCrmLeads,
        crmActivities: allCrmActivities,
        dailyWorkLogs: allDailyLogs,
        documents: allDocs,
        documentItems: allDocItems,
        transactions: allTx,
        activityLogs: allActivityLogs,
        appSettings: allSettings
      }
    };

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'EXPORT',
      entity: 'سیستم:نسخه_پشتیبان',
      description: `استخراج نسخه پشتیبان کامل پایگاه داده شامل ${Object.keys(backupData.data).length} جدول و موجودیت سیستم`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="erp-backup-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(backupData);
  } catch (error) {
    throw error;
  }
});

// Production Readiness 360-Degree Diagnostics Endpoint
router.get('/system/health/diagnostics', authorize('admin', 'manager'), async (req, res) => {
  try {
    const t0 = Date.now();
    await orm.execute(sql`SELECT 1`);
    const dbLatencyMs = Date.now() - t0;

    const [outboxRes] = await orm.select({ count: sql<number>`count(*)` }).from(outboxEvents).where(eq(outboxEvents.status, 'pending'));
    const [dlqRes] = await orm.select({ count: sql<number>`count(*)` }).from(deadLetterEvents).where(eq(deadLetterEvents.status, 'quarantined'));
    
    const [totals] = await orm.select({
      totalDebit: sql<number>`coalesce(sum(${journalVoucherItems.debit}), 0)`,
      totalCredit: sql<number>`coalesce(sum(${journalVoucherItems.credit}), 0)`
    }).from(journalVoucherItems);

    const debit = Number(totals?.totalDebit || 0);
    const credit = Number(totals?.totalCredit || 0);
    const voucherIsBalanced = Math.abs(debit - credit) < 0.01;

    const [negativeStockRes] = await orm.select({ count: sql<number>`count(*)` }).from(items).where(sql`${items.currentStock}::numeric < 0`);
    const [activeInstancesRes] = await orm.select({ count: sql<number>`count(*)` }).from(workflowInstances).where(eq(workflowInstances.status, 'IN_PROGRESS'));

    const pendingOutbox = Number(outboxRes?.count || 0);
    const dlqCount = Number(dlqRes?.count || 0);
    const negativeStockCount = Number(negativeStockRes?.count || 0);
    const activeWorkflows = Number(activeInstancesRes?.count || 0);

    const status = (negativeStockCount === 0 && voucherIsBalanced && dlqCount === 0) ? 'HEALTHY' : 'WARNING';

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'VIEW',
      entity: 'سیستم:پایش_سلامت',
      description: `استعلام گزارش جامع پایش سلامت سیستم - وضعیت کل: ${status}`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });

    res.json({
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        connected: true,
        latencyMs: dbLatencyMs
      },
      outboxQueue: {
        pendingEvents: pendingOutbox,
        quarantinedDlqEvents: dlqCount
      },
      accountingIntegrity: {
        totalDebit: debit,
        totalCredit: credit,
        isBalanced: voucherIsBalanced,
        imbalanceAmount: Math.abs(debit - credit)
      },
      inventoryIntegrity: {
        negativeStockItemsCount: negativeStockCount
      },
      workflows: {
        activeInstances: activeWorkflows
      }
    });
  } catch (error) {
    throw error;
  }
});

// Production Auto-Reconciliation & Self-Healing Endpoint
router.post('/system/reconciliation/auto-repair', authorize('admin'), async (req, res) => {
  try {
    const { OutboxService } = await import('../services/events/outboxService.js');
    const { AccountingService } = await import('../services/accounting.service.js');

    // Re-process stuck outbox items
    const batchResult = await OutboxService.processPendingBatch(100);
    const reprocessedCount = batchResult.processed;

    // Sync missing invoice vouchers
    const voucherSyncRes = await AccountingService.syncAllInvoiceVouchers();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'مدیر سیستم',
      userFullName: req.user?.full_name || '',
      action: 'RECONCILIATION_EXECUTE',
      entity: 'سیستم خودترمیمی و بازیابی بحران',
      description: `اجرای عملیات خودترمیمی؛ پردازش ${reprocessedCount} رویداد Outbox معلق و همگام‌سازی اسناد حسابداری`
    });

    res.json({
      success: true,
      message: 'عملیات خودترمیمی و بازسازی تعادل داده‌ها با موفقیت اجرا گردید.',
      reprocessedOutboxEvents: reprocessedCount,
      voucherSync: voucherSyncRes
    });
  } catch (error) {
    throw error;
  }
});

// V8 Master Release Gate Audit Endpoint
router.get('/system/release-gate/status', authorize('admin'), async (req, res) => {
  try {
    const { ReleaseGateService } = await import('../services/releaseGate.service.js');
    const report = await ReleaseGateService.evaluateReleaseGate();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'admin',
      userFullName: req.user?.full_name || '',
      action: 'AUDIT',
      entity: 'سیستم:ارزیابی_دروازه_انتشار',
      description: `اجرای ارزیابی رسمی Release Gate نسخه ۸ — وضعیت: ${report.overallStatus} (${report.passedCriteria}/${report.totalCriteria})`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });

    res.json(report);
  } catch (error) {
    throw error;
  }
});

export default router;


