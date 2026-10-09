import { orm } from './drizzle.js';
import { runMigrations, type MigrationResult } from './migrator.js';
import { categories, appSettings, pieceworkTasks, accounts } from './schema.js';
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
/** v10.0.22 (TD-959): `failedSections` names every base data section that failed; `success` is false when one did. */
export interface SeedResult { success: boolean; message: string; failedSections: string[] }

export async function runSeedWithLock(): Promise<SeedResult> {
  try {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.SEED, () => runSeed());
    if (!outcome.acquired) {
      logger.info('[Seed] Another instance is seeding — skipping');
      return { success: true, message: 'Another instance is seeding — skipped', failedSections: [] };
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
 * Seeds initial master catalog, 22 standard categories, settings, piecework tasks, and chart of accounts.
 * v9.0.133 (TD-591، یافته B01-11، تصمیم ت۴ بسته ۱): فقط «درج آنچه نیست». هر گونه داده پایه فقط در جدولی درج می‌شود که از
 * آن گونه هیچ ندارد و هیچ ردیف موجودی (دسته، حساب، تنظیم) ویرایش نمی‌شود. v9.0.134 (TD-526): در هر محیط، تولید هم، در بوت اجرا
 * می‌شود و نقشی نمی‌سازد.
 */
export async function runSeed(
  options: { migrate?: () => Promise<MigrationResult> } = {}
): Promise<SeedResult> {
  logger.info('[Seeder] Starting system master data seed process...');
  // v10.0.22 (TD-959): a failed section is still logged and the others still run (each is insert-only, so the next
  // boot retries it), but the result says which failed instead of always reporting success
  const failedSections: string[] = [];

  // 1. Ensure database schema is migrated and up-to-date
  // v7.0.50 (TD-217): runMigrations خطا را برنمی‌اندازد؛ seed روی اسکیمای مهاجرت‌نشده اجرا نمی‌شود
  // (بازنشانی سیستم و initial-setup پیش‌تر پس از مهاجرت شکست‌خورده ادامه می‌دادند). options.migrate فقط برای آزمون است.
  const migration = await (options.migrate ?? runMigrations)();
  if (!migration.success) {
    throw new Error(`[Seeder] Schema migrations failed; seed aborted: ${migration.errors.join('; ') || 'unknown error'}`);
  }

  // 2. ۲۲ دسته استاندارد، فقط وقتی هیچ دسته‌ای نیست (v9.0.133، TD-591: دسته موجود بازنویسی و دسته حذف‌شده برگردانده نمی‌شود)
  try {
    if (await isEmptyTable(categories)) {
      await orm.insert(categories).values(DEFAULT_CATEGORIES.map(c => ({ ...c })));
      logger.info(`[Seeder] Seeded ${DEFAULT_CATEGORIES.length} standard categories into an empty table.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding categories:', err);
    failedSections.push('categories');
  }

  // 3. System warehouses are user-managed (no hardcoded default warehouse)

  // 4. نقش‌ها: seed هیچ نقشی نمی‌سازد (v9.0.134، TD-526، مدل مجوز §۴.۳). نقش «مدیر سیستم» را مهاجرت 0066 می‌سازد و نقش‌های
  // دیگر را مدیر با «ساخت نقش از الگو» (`src/lib/permissions/roleTemplates.ts`) می‌سازد.

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
    // v9.0.133 (TD-591): فقط پایگاه‌داده‌ای که هیچ‌یک از این کلیدها را ندارد؛ کلید تازه در نصب موجود رفتار را عوض نمی‌کند
    // (مثلاً `invoice_start_number` نبودنش یعنی شروع از ۱ و درجش شماره فاکتور بعدی را به ۱۰۰۰ می‌پراند)
    const existingSettings = await orm.select({ key: appSettings.key }).from(appSettings).where(inArray(appSettings.key, settings.map(s => s.key))).limit(1);
    if (existingSettings.length === 0) {
      await orm.insert(appSettings).values(settings);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding app settings:', err);
    failedSections.push('app settings');
  }

  // (v4.0.29) همگام‌سازی جدول changelogs حذف شد — dual-storage مذموم؛ منبع حقیقت
  // یگانه، فایل‌های src/data/changelogs/*.ts هستند.

  // 7. Task categories: No hardcoded defaults seeded as per user configuration (managed from scratch)
  logger.info('[Seeder] Task categories: skipped default seed (user defined from zero).');

  // 8. Seed piecework tasks
  try {
    // v9.0.133 (TD-591): فقط وقتی هیچ عنوان کاری نیست
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
    failedSections.push('piecework tasks');
  }

  // 9. Seed standard chart of accounts
  // v9.0.133 (TD-591): فقط وقتی هیچ حساب فعالی نیست؛ همگام‌سازی حساب‌های موجود (والد و ماهیت) فقط با دکمه «همگام‌سازی کدینگ پیش‌فرض» است
  try {
    const hasAccounts = (await orm.select({ id: accounts.id }).from(accounts).where(eq(accounts.isDeleted, 0)).limit(1)).length > 0;
    const seedRes = hasAccounts ? { seededCount: 0 } : await AccountingService.seedStandardAccounts();
    if (seedRes.seededCount > 0) {
      logger.info(`[Seeder] Seeded ${seedRes.seededCount} standard chart of accounts.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding standard chart of accounts:', err);
    failedSections.push('chart of accounts');
  }

  // 10. Seed standard workflow definitions
  try {
    await WorkflowDefinitionService.seedDefaultWorkflows();
    logger.info('[Seeder] Seeded standard workflow definitions.');
  } catch (err) {
    logger.error('[Seeder] Error seeding standard workflow definitions:', err);
    failedSections.push('workflow definitions');
  }

  if (failedSections.length > 0) {
    const message = `Base data sections failed: ${failedSections.join(', ')}`;
    logger.error(`[Seeder] ${message}`);
    return { success: false, message, failedSections };
  }
  logger.info('[Seeder] Master data seed completed successfully.');
  return { success: true, message: 'Master data seed completed successfully', failedSections };
}
