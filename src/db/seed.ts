import { orm } from './drizzle.js';
import { runMigrations } from './migrator.js';
import { users, categories, warehouses, appSettings, changelogs, roles, pieceworkTasks, taskCategories } from './schema.js';
import { eq, sql, inArray } from 'drizzle-orm';
import { DEFAULT_WORKFLOW_PRESETS } from '../constants/presets.js';
import { SYSTEM_UPDATES } from '../data/appInfoAndChangelog.js';
import { INITIAL_PIECEWORK_TASKS } from '../data/pieceworkTasksData.js';
import { AccountingService } from '../services/accounting.service.js';
import { WorkflowDefinitionService } from '../services/workflow/workflowDefinitionService.js';
import { logger } from '../middleware/logger.js';

/**
 * Executes system seed with PostgreSQL Advisory Lock (89345) to ensure multi-instance safety.
 */
export async function runSeedWithLock(): Promise<{ success: boolean; message: string }> {
  try {
    const lockResult: any = await orm.execute(sql`SELECT pg_try_advisory_lock(89345) AS acquired`);
    const acquired = Boolean(lockResult.rows?.[0]?.acquired ?? lockResult?.[0]?.acquired);
    if (!acquired) {
      logger.info('[Seed] Another instance is seeding — skipping');
      return { success: true, message: 'Another instance is seeding — skipped' };
    }

    try {
      return await runSeed();
    } finally {
      await orm.execute(sql`SELECT pg_advisory_unlock(89345)`);
    }
  } catch (err: any) {
    logger.error('[Seed] Error during locked seed execution:', err);
    throw err;
  }
}

/**
 * Standard System Seed Data
 * Seeds initial master catalog, 22 standard categories, roles, presets, piecework tasks, and chart of accounts.
 */
export async function runSeed(): Promise<{ success: boolean; message: string }> {
  logger.info('[Seeder] Starting system master data seed process...');

  // 1. Ensure database schema is migrated and up-to-date
  await runMigrations();

  // 2. Check & sync 22 standard categories
  const defaultCategories = [
    // محصولات نهایی (product)
    { name: 'گردنبند', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
    { name: 'گوشواره میخی', prefix: 'S', type: 'product', defaultUnit: 'جفت' },
    { name: 'گوشواره آویز', prefix: 'E', type: 'product', defaultUnit: 'جفت' },
    { name: 'انگشتر', prefix: 'R', type: 'product', defaultUnit: 'عدد' },
    { name: 'دستبند', prefix: 'B', type: 'product', defaultUnit: 'عدد' },
    { name: 'گوشواره آویز بزرگ', prefix: 'E', type: 'product', defaultUnit: 'جفت' },
    { name: 'گردنبند بزرگ', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
    { name: 'گوشواره دو تکه', prefix: 'E', type: 'product', defaultUnit: 'عدد' },
    { name: 'گردنبند دو تکه', prefix: 'N', type: 'product', defaultUnit: 'عدد' },

    // مواد اولیه (raw_material) — V10-2.1: prefix بدون dash انتهایی تا کد کلاینت تک‌خط ساخته شود
    { name: 'ترنسفر', prefix: 'T', type: 'raw_material', defaultUnit: 'برگ' },
    { name: 'مهره', prefix: 'B', type: 'raw_material', defaultUnit: 'ریسه' },
    { name: 'مهره کریستالی', prefix: 'B-C', type: 'raw_material', defaultUnit: 'ریسه' },
    { name: 'سنگ', prefix: 'S', type: 'raw_material', defaultUnit: 'ریسه' },
    { name: 'مهره حدید', prefix: 'B-H', type: 'raw_material', defaultUnit: 'ریسه' },
    { name: 'مهره چوبی', prefix: 'B-W', type: 'raw_material', defaultUnit: 'ریسه' },
    { name: 'خرج کار', prefix: 'M', type: 'raw_material', defaultUnit: 'عدد' },
    { name: 'خرج کار طلایی', prefix: 'M-G', type: 'raw_material', defaultUnit: 'عدد' },
    { name: 'خرج کار برنزی', prefix: 'M-B', type: 'raw_material', defaultUnit: 'عدد' },
    { name: 'خرج کار استیل', prefix: 'M-M', type: 'raw_material', defaultUnit: 'عدد' },
    { name: 'بند چرمی و زنجیر', prefix: 'C', type: 'raw_material', defaultUnit: 'متر' },
    { name: 'کیلر، رنگ، گلیز', prefix: 'G', type: 'raw_material', defaultUnit: 'عدد' },
    { name: 'سایر اقلام', prefix: 'O', type: 'raw_material', defaultUnit: 'عدد' }
  ];

  try {
    const existingCatRows = await orm.select().from(categories);
    const existingCatMap = new Map(existingCatRows.map(c => [c.name, c]));

    for (const cat of defaultCategories) {
      const existing = existingCatMap.get(cat.name);
      if (existing) {
        const currentUnit = existing.defaultUnit || (existing as any).default_unit;
        if (existing.prefix !== cat.prefix || existing.type !== cat.type || currentUnit !== cat.defaultUnit) {
          await orm.update(categories).set({
            prefix: cat.prefix,
            type: cat.type,
            defaultUnit: cat.defaultUnit
          }).where(eq(categories.id, existing.id));
        }
      } else {
        await orm.insert(categories).values(cat);
      }
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
        'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'inventory.reconcile',
        'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
        'audit.view', 'audit.create', 'audit.apply',
        'customers.view', 'customers.manage',
        'crm.view', 'crm.manage', 'crm.delete',
        'reports.view',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'workflow.view', 'workflow.approve', 'workflow.manage',
        'events.view', 'events.manage',
        'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
        'personnel.view', 'personnel.manage', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll',
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
        'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
        'audit.view', 'audit.create', 'audit.apply',
        'customers.view', 'customers.manage',
        'crm.view', 'crm.manage', 'crm.delete',
        'reports.view',
        'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
        'workflow.view', 'workflow.approve', 'workflow.manage',
        'events.view', 'events.manage',
        'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all',
        'personnel.view', 'personnel.manage', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll',
        'pending_materials.view', 'pending_materials.approve',
        'procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve',
        'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury', 'accounting.cheques', 'accounting.reports',
        'woocommerce.view', 'woocommerce.manage', 'audit_logs.view'
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
        'products.view',
        'warehouse.view', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'inventory.reconcile',
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

    // Update existing system roles with missing default permissions
    // V10-5.1: (اختیاری) پاکسازی grants ناشناخته — فقط با ERP_SEED_PERMISSION_CLEANUP=true
    const cleanupEnabled = process.env.ERP_SEED_PERMISSION_CLEANUP === 'true';
    const defaultRoleMap = new Map(defaultRoles.map(d => [d.code, d]));
    const defaultPermSets = new Map(defaultRoles.map(d => [d.code, new Set(d.permissions)]));
    for (const existingRole of existingRoles) {
      const defaultDef = defaultRoleMap.get(existingRole.code);
      if (defaultDef) {
        const currentPerms: string[] = Array.isArray(existingRole.permissions) ? (existingRole.permissions as string[]) : [];
        const missingPerms = defaultDef.permissions.filter(p => !currentPerms.includes(p));

        if (cleanupEnabled) {
          const stalePerms = currentPerms.filter(p => !defaultPermSets.get(existingRole.code)?.has(p) && p !== '*');
          if (stalePerms.length > 0) {
            logger.warn(`[Seeder] ERP_SEED_PERMISSION_CLEANUP: removing ${stalePerms.length} stale permission(s) from role ${existingRole.code}: ${stalePerms.join(', ')}`);
          }
          await orm.update(roles).set({ permissions: [...defaultDef.permissions] }).where(eq(roles.id, existingRole.id));
        } else if (missingPerms.length > 0) {
          const updatedPerms = [...currentPerms, ...missingPerms];
          await orm.update(roles).set({ permissions: updatedPerms }).where(eq(roles.id, existingRole.id));
        }
      }
    }
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
    // V1.1.1: فلگ‌های runtime — پیش‌فرض امن (endpoint های تست خاموش)
    { key: 'runtime_enable_test_endpoints', value: 'false' }
  ];

  try {
    const existingSettings = await orm.select().from(appSettings).where(inArray(appSettings.key, settings.map(s => s.key)));
    const existingKeys = new Set(existingSettings.map(s => s.key));
    const newSettings = settings.filter(s => !existingKeys.has(s.key));
    if (newSettings.length > 0) {
      await orm.insert(appSettings).values(newSettings);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding app settings:', err);
  }

  // 6. Sync changelogs directly from source of truth (SYSTEM_UPDATES)
  try {
    const initialChangelogs = SYSTEM_UPDATES.map(u => ({
      version: u.version,
      date: new Date().toISOString(),
      features: `${u.title}\n${u.summary}\n${Array.isArray(u.changes) ? u.changes.join('\n') : ''}`,
      fixes: Array.isArray(u.fixes) ? u.fixes.join('\n') : ''
    }));

    const existingLogs = await orm.select().from(changelogs);
    const existingVersions = new Set(existingLogs.map(l => l.version));
    const newLogs = initialChangelogs.filter(l => !existingVersions.has(l.version));
    if (newLogs.length > 0) {
      const chunkSize = 10;
      for (let i = 0; i < newLogs.length; i += chunkSize) {
        const chunk = newLogs.slice(i, i + chunkSize);
        await orm.insert(changelogs).values(chunk);
      }
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding changelogs:', err);
  }

  // 7. Seed task categories
  try {
    const defaultCategories = Array.from(new Set(INITIAL_PIECEWORK_TASKS.map(t => t.category).filter(Boolean)));
    for (const catName of defaultCategories) {
      await orm.insert(taskCategories).values({ name: catName, description: 'دسته‌بندی کاری پیش‌فرض کارگاه' }).onConflictDoNothing();
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding task categories:', err);
  }

  // 8. Seed piecework tasks
  try {
    const existingTasks = await orm.select({ code: pieceworkTasks.code }).from(pieceworkTasks);
    const existingCodes = new Set(existingTasks.map(t => t.code));
    const missingTasks = INITIAL_PIECEWORK_TASKS.filter(t => !existingCodes.has(t.code));

    if (missingTasks.length > 0) {
      const chunkSize = 20;
      for (let i = 0; i < missingTasks.length; i += chunkSize) {
        const chunk = missingTasks.slice(i, i + chunkSize);
        await orm.insert(pieceworkTasks).values(chunk);
      }
      logger.info(`[Seeder] Seeded ${missingTasks.length} missing piecework tasks.`);
    }
  } catch (err) {
    logger.error('[Seeder] Error seeding piecework tasks:', err);
  }

  // 9. Seed standard chart of accounts
  try {
    const seedRes = await AccountingService.seedStandardAccounts();
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
