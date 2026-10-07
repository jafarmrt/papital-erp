import { orm } from './drizzle.js';
import { runMigrations, type MigrationResult } from './migrator.js';
import { categories, appSettings, roles, pieceworkTasks, accounts } from './schema.js';
import { eq, inArray } from 'drizzle-orm';
import { DEFAULT_WORKFLOW_PRESETS } from '../constants/presets.js';
import { INITIAL_PIECEWORK_TASKS } from '../data/pieceworkTasksData.js';
import { DEFAULT_CATEGORIES } from '../data/defaultCategories.js';
import { money } from '../lib/money.js';
import { AccountingService } from '../services/accounting.service.js';
import { WorkflowDefinitionService } from '../services/workflow/workflowDefinitionService.js';
import { logger } from '../middleware/logger.js';
import { withAdvisoryLock, ADVISORY_LOCK_KEYS } from '../lib/advisoryLock.js';

/**
 * Executes system seed with PostgreSQL Advisory Lock (89345) to ensure multi-instance safety.
 * v7.0.39 (TD-194): قفل و آزادسازی روی همان اتصال اختصاصی (withAdvisoryLock)؛ پیش‌تر دو کوئری جدای orm
 * ممکن بود روی دو اتصال متفاوت استخر اجرا شوند و قفل روی اتصال اول باقی بماند.
 */
export async function runSeedWithLock(): Promise<{ success: boolean; message: string }> {
  try {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.SEED, () => runSeed());
    if (!outcome.acquired) {
      logger.info('[Seed] Another instance is seeding — skipping');
      return { success: true, message: 'Another instance is seeding — skipped' };
    }
    return outcome.result;
  } catch (err: any) {
    logger.error('[Seed] Error during locked seed execution:', err);
    throw err;
  }
}

/** جدولی که هیچ ردیفی ندارد (حذف‌شده‌های نرم هم ردیف‌اند) */
async function isEmptyTable(table: typeof categories | typeof pieceworkTasks): Promise<boolean> {
  return (await orm.select({ id: table.id }).from(table).limit(1)).length === 0;
}

/**
 * Standard System Seed Data
 * Seeds initial master catalog, 22 standard categories, roles, presets, piecework tasks, and chart of accounts.
 * v9.0.116 (TD-591، یافته B01-11، تصمیم ت۴ بسته ۱): فقط «درج آنچه نیست». هر گونه داده پایه فقط در جدولی درج می‌شود که از
 * آن گونه هیچ ندارد، نقش فقط اگر کدش نباشد ساخته می‌شود، و هیچ ردیف موجودی (مجوز نقش، دسته، حساب، تنظیم) ویرایش نمی‌شود.
 */
export async function runSeed(
  options: { migrate?: () => Promise<MigrationResult> } = {}
): Promise<{ success: boolean; message: string }> {
  logger.info('[Seeder] Starting system master data seed process...');

  // 1. Ensure database schema is migrated and up-to-date
  // v7.0.50 (TD-217): runMigrations خطا را برنمی‌اندازد؛ seed روی اسکیمای مهاجرت‌نشده اجرا نمی‌شود
  // (بازنشانی سیستم و initial-setup پیش‌تر پس از مهاجرت شکست‌خورده ادامه می‌دادند). options.migrate فقط برای آزمون است.
  const migration = await (options.migrate ?? runMigrations)();
  if (!migration.success) {
    throw new Error(`[Seeder] Schema migrations failed; seed aborted: ${migration.errors.join('; ') || 'unknown error'}`);
  }

  // 2. ۲۲ دسته استاندارد، فقط وقتی هیچ دسته‌ای نیست (v9.0.116، TD-591: دسته موجود بازنویسی و دسته حذف‌شده برگردانده نمی‌شود)
  try {
    if (await isEmptyTable(categories)) {
      await orm.insert(categories).values(DEFAULT_CATEGORIES.map(c => ({ ...c })));
      logger.info(`[Seeder] Seeded ${DEFAULT_CATEGORIES.length} standard categories into an empty table.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding categories:', err);
  }

  // 3. System warehouses are user-managed (no hardcoded default warehouse)

  // 4. Check & seed system roles
  const defaultRoles = [
    {
      name: 'مدیر ارشد سیستم',
      code: 'admin',
      description: 'دسترسی کامل و نامحدود به تمامی بخش‌ها و منوهای سامانه',
      permissions: [
        'products.view', 'products.create', 'products.edit', 'products.edit_price', 'products.delete',
        'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'warehouse.backdate', 'inventory.reconcile',
        'documents.view', 'documents.create', 'documents.finalize', 'documents.edit', 'documents.delete',
        'audit.view', 'audit.create', 'audit.apply',
        'customers.view', 'customers.manage',
        'crm.view', 'crm.manage', 'crm.delete',
        'reports.view',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'workflow.view', 'workflow.approve', 'workflow.manage',
        'events.view', 'events.manage',
        'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
        'personnel.view', 'personnel.manage', 'personnel.view_sensitive', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll', 'payroll.view_sensitive',
        'pending_materials.view', 'pending_materials.approve',
        'procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve',
        'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
        'woocommerce.view', 'woocommerce.manage', 'audit_logs.view',
        'users.manage', 'roles.manage', 'settings.manage'
      ],
      isSystem: 1
    },
    {
      name: 'مدیر عمومی / مدیر سیستم',
      code: 'manager',
      description: 'دسترسی مدیریتی جامع به تمامی ماژول‌ها و عملیات سامانه',
      permissions: [
        'products.view', 'products.create', 'products.edit', 'products.edit_price', 'products.delete',
        'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'inventory.reconcile',
        'documents.view', 'documents.create', 'documents.finalize', 'documents.edit', 'documents.delete',
        'audit.view', 'audit.create', 'audit.apply',
        'customers.view', 'customers.manage',
        'crm.view', 'crm.manage', 'crm.delete',
        'reports.view',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'workflow.view', 'workflow.approve', 'workflow.manage',
        'events.view', 'events.manage',
        'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
        'personnel.view', 'personnel.manage', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll',
        // v9.0.109 (TD-882): اطلاعات بانکی پرسنل و فیش را تا v9.0.108 با کد خود بی پوشش می‌دید (همان مهاجرت 0064)
        'personnel.view_sensitive', 'payroll.view_sensitive',
        'pending_materials.view', 'pending_materials.approve', 'pending_materials.delete',
        'procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve',
        'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
        'woocommerce.view', 'woocommerce.manage', 'audit_logs.view',
        // v9.0.107 (TD-516): دسترسی‌ای که این نقش تا v9.0.87 فقط با کد خود در گارد داشت (همان مهاجرت 0062)
        'settings.manage'
      ],
      isSystem: 1
    },
    {
      name: 'مدیر ارشد مالی (CFO)',
      code: 'cfo_accountant',
      description: 'دسترسی کامل به کدینگ حساب‌ها، اسناد دوبل، خزانه‌داری، چک‌های صیادی، صورت‌های مالی، قیمت‌گذاری و حقوق پرسنل',
      permissions: [
        'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
        'products.view', 'products.edit_price',
        'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
        // v9.0.108 (TD-541، تصمیم ت۱ بسته ۸): ثبت قطعی و نهایی کردن سند فروش (همان مهاجرت 0063)
        'documents.finalize',
        'customers.view', 'customers.manage',
        'workflow.view', 'workflow.approve',
        'events.view',
        'personnel.view', 'piecework.view', 'piecework.payroll',
        'daily_logs.view', 'daily_logs.create',
        'reports.view', 'audit_logs.view'
      ],
      isSystem: 1
    },
    {
      name: 'انباردار',
      code: 'warehouse_keeper',
      description: 'مسئول ورود/خروج فیزیکی کالاها، جابجایی بین انبارها و ثبت شمارش انبارگردانی',
      permissions: [
        'products.view', 'products.create', 'products.edit',
        'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'inventory.reconcile',
        // v9.0.107 (TD-516): ویرایش سند را تا v9.0.87 فقط با کد خود در گارد داشت (همان مهاجرت 0062)
        'documents.edit',
        // v9.0.108 (TD-541): فاکتور فروش قطعی را تا v9.0.107 فقط با کد خود ثبت می‌کرد (همان مهاجرت 0063)
        'documents.finalize',
        'audit.view', 'audit.create', 'audit.apply',
        'pending_materials.view', 'pending_materials.approve',
        'workflow.view', 'workflow.approve', 'workflow.execute',
        'customers.view',
        'projects.view', 'projects.edit',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'حسابدار و کارشناس مالی',
      code: 'accountant',
      description: 'مدیریت اسناد دوبل، کدینگ، فاکتورهای فروش، خزانه‌داری و صدور چک و صورت‌های مالی',
      permissions: [
        'products.view', 'products.edit_price',
        'warehouse.view',
        'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
        // v9.0.108 (TD-541): فاکتور فروش قطعی را تا v9.0.107 فقط با کد خود ثبت می‌کرد (همان مهاجرت 0063)
        'documents.finalize',
        'customers.view', 'customers.manage',
        'workflow.view', 'workflow.approve',
        'crm.view',
        'reports.view',
        'projects.view',
        'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'مدیر تولید و کارگاه',
      code: 'production_manager',
      description: 'مدیریت پروژه‌های تولید، مراحل ساخت، تایید خط تولید، کارهای پرکیسی و درخواست‌های مواد اولیه',
      permissions: [
        'products.view', 'products.create', 'products.edit',
        'warehouse.view', 'warehouse.in', 'warehouse.out',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'workflow.view', 'workflow.approve', 'workflow.execute',
        'personnel.view', 'piecework.view', 'piecework.log', 'piecework.manage_tasks',
        'pending_materials.view', 'pending_materials.approve',
        'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
        'reports.view'
      ],
      isSystem: 1
    },
    {
      name: 'خزانه‌دار و مسئول صندوق',
      code: 'treasurer',
      description: 'مدیریت حساب‌های بانکی، صندوق و تراز نقدینگی، ثبت و پیگیری دریافت/پرداخت‌ها و چک‌های صیادی',
      permissions: [
        'accounting.view', 'accounting.treasury', 'accounting.cheques',
        'workflow.view', 'workflow.approve', 'workflow.execute',
        'documents.view', 'customers.view',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'مدیر فروش',
      code: 'sales_manager',
      description: 'صدور فاکتور و پیش‌فاکتور فروش، ثبت مشتریان و مشاهده موجودی کالاها',
      permissions: [
        'products.view',
        'warehouse.view',
        'documents.view', 'documents.create', 'documents.edit',
        'customers.view', 'customers.manage',
        'workflow.view', 'workflow.approve',
        'crm.view', 'crm.manage',
        'reports.view',
        'projects.view',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'ناظر انبارگردانی',
      code: 'inventory_auditor',
      description: 'ایجاد دوره‌های انبارگردانی، ثبت شمارش عینی و کنترل و اعمال مغایرت‌ها',
      permissions: [
        'products.view',
        'warehouse.view', 'inventory.reconcile',
        'audit.view', 'audit.create', 'audit.apply',
        'workflow.view',
        'projects.view',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'کاربر تماشاگر',
      code: 'viewer',
      description: 'دسترسی محدود صرفاً جهت مشاهده اطلاعات، کالاها و فاکتورها بدون امکان ویرایش',
      // V10-5.1: viewer نباید daily_logs.create داشته باشد (تناقض با ماهیت فقط-مشاهده)
      permissions: [
        'products.view', 'warehouse.view', 'documents.view', 'customers.view', 'crm.view', 'reports.view', 'projects.view', 'workflow.view', 'daily_logs.view'
      ],
      isSystem: 1
    },
    {
      name: 'کاربر ثبت گزارش (کاربر ساده)',
      code: 'daily_logger',
      description: 'کاربر ساده با دسترسی محدود صرفاً جهت ثبت و مشاهده گزارش کار روزانه و اعلان‌ها',
      permissions: [
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    },
    {
      name: 'مسئول خرید و تدارکات',
      code: 'procurement_officer',
      description: 'مدیریت درخواست‌های خرید پروژه‌ها و انبار، استعلام قیمت، تفکیک اقلام، تخصیص تامین‌کننده و صدور سفارش‌های خرید قطعی',
      permissions: [
        'procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve',
        'products.view', 'products.edit_price',
        'warehouse.view', 'warehouse.in',
        'documents.view', 'documents.create', 'documents.edit',
        'customers.view', 'customers.manage',
        'projects.view',
        'workflow.view', 'workflow.approve',
        'daily_logs.view', 'daily_logs.create'
      ],
      isSystem: 1
    }
  ];

  try {
    const existingRoles = await orm.select().from(roles);
    const existingRoleCodes = new Set(existingRoles.map(r => r.code));
    const newRoles = defaultRoles.filter(r => !existingRoleCodes.has(r.code));
    if (newRoles.length > 0) {
      await orm.insert(roles).values(newRoles);
    }

    // v9.0.116 (TD-591، تصمیم ت۴ بسته ۱): نقش موجود دست نمی‌خورد؛ مجوزی که مدیر برداشته برگردانده نمی‌شود
  } catch (err) {
    logger.error('[Seeder] Error seeding roles:', err);
  }

  // 5. System Settings
  const settings = [
    { key: 'invoice_start_number', value: '1000' },
    { key: 'fast_moving_days', value: '30' },
    { key: 'slow_moving_days', value: '90' },
    { key: 'dead_stock_days', value: '180' },
    { key: 'company_name', value: 'سامانه جامع ERP پاپیتال' },
    { key: 'company_phone', value: '' },
    { key: 'company_address', value: '' },
    { key: 'company_logo', value: '' },
    { key: 'currency', value: 'IRR' },
    { key: 'display_timezone', value: 'Asia/Tehran' },
    { key: 'pricing_strategies', value: 'فروشگاه,مصرف‌کننده,عمده' },
    { key: 'project_workflow_presets', value: JSON.stringify(DEFAULT_WORKFLOW_PRESETS) },
  ];

  try {
    // v9.0.116 (TD-591): فقط پایگاه‌داده‌ای که هیچ‌یک از این کلیدها را ندارد؛ کلید تازه در نصب موجود رفتار را عوض نمی‌کند
    // (مثلاً `invoice_start_number` نبودنش یعنی شروع از ۱ و درجش شماره فاکتور بعدی را به ۱۰۰۰ می‌پراند)
    const existingSettings = await orm.select({ key: appSettings.key }).from(appSettings).where(inArray(appSettings.key, settings.map(s => s.key))).limit(1);
    if (existingSettings.length === 0) {
      await orm.insert(appSettings).values(settings);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding app settings:', err);
  }

  // (v4.0.29) همگام‌سازی جدول changelogs حذف شد — dual-storage مذموم؛ منبع حقیقت
  // یگانه، فایل‌های src/data/changelogs/*.ts هستند.

  // 7. Task categories: No hardcoded defaults seeded as per user configuration (managed from scratch)
  logger.info('[Seeder] Task categories: skipped default seed (user defined from zero).');

  // 8. Seed piecework tasks
  try {
    // v9.0.116 (TD-591): فقط وقتی هیچ عنوان کاری نیست
    const missingTasks = (await isEmptyTable(pieceworkTasks)) ? INITIAL_PIECEWORK_TASKS : [];

    if (missingTasks.length > 0) {
      const chunkSize = 20;
      for (let i = 0; i < missingTasks.length; i += chunkSize) {
        const chunk = missingTasks.slice(i, i + chunkSize);
        await orm.insert(pieceworkTasks).values(chunk.map(t => ({ ...t, defaultRate: money(t.defaultRate) })));
      }
      logger.info(`[Seeder] Seeded ${missingTasks.length} missing piecework tasks.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding piecework tasks:', err);
  }

  // 9. Seed standard chart of accounts
  // v9.0.116 (TD-591): فقط وقتی هیچ حساب فعالی نیست؛ همگام‌سازی حساب‌های موجود (والد و ماهیت) فقط با دکمه «همگام‌سازی کدینگ پیش‌فرض» است
  try {
    const hasAccounts = (await orm.select({ id: accounts.id }).from(accounts).where(eq(accounts.isDeleted, 0)).limit(1)).length > 0;
    const seedRes = hasAccounts ? { seededCount: 0 } : await AccountingService.seedStandardAccounts();
    if (seedRes.seededCount > 0) {
      logger.info(`[Seeder] Seeded ${seedRes.seededCount} standard chart of accounts.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding standard chart of accounts:', err);
  }

  // 10. Seed standard workflow definitions
  try {
    await WorkflowDefinitionService.seedDefaultWorkflows();
    logger.info('[Seeder] Seeded standard workflow definitions.');
  } catch (err) {
    logger.error('[Seeder] Error seeding standard workflow definitions:', err);
  }

  logger.info('[Seeder] Master data seed completed successfully.');
  return { success: true, message: 'Master data seed completed successfully' };
}
