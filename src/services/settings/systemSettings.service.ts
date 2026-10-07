import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, warehouses } from '../../db/schema.js';
import { ValidationError, ForbiddenError } from '../../errors/customErrors.js';
import { userHasRoleOrPermission } from '../../middleware/authorize.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { SYSTEM_ADMIN_SETTING_KEYS } from '../../lib/settings/settingKeyAccess.js';
import { logActivity } from '../../lib/auditLogger.js';
import { invalidateSettingsCache, appSettingsCache } from '../../lib/memoryCache.js';

/**
 * v7.0.26 (TD-184 / audit P1-3) — ذخیره امن تنظیمات سیستم با مجوز سطح کلید
 * ===========================================================================
 * قبلاً: (۱) فرم تنظیمات همیشه کلید `runtime_enable_test_endpoints` را می‌فرستاد و ذخیره برای نقش «مدیر»
 * همیشه با 403 شکست می‌خورد؛ (۲) مقادیر ماسک‌شده `********` کلیدهای محرمانه برای غیرادمین دوباره ارسال
 * و روی مقدار واقعی ذخیره می‌شد؛ (۳) هر کلید دلخواهی پذیرفته می‌شد و لاگ ممیزی snapshot قبل/بعد نداشت؛
 * (۴) جهش مستقیم دیتابیس در فایل روت انجام می‌شد (نقض RULE 01).
 */

export const MASKED_SETTING_VALUE = '********';

/** کلیدهایی که در پاسخ GET برای غیرادمین ماسک می‌شوند و در لاگ ممیزی محافظت می‌شوند */
export const SENSITIVE_SETTING_PATTERN = /secret|token|password|api_key|consumer_secret|consumer_key/i;

/** تنظیمات کسب‌وکاری — قابل ویرایش توسط admin، manager یا مجوز settings.manage (کنترل در سطح روت) */
const BUSINESS_SETTING_KEYS = new Set([
  'invoice_start_number',
  'fast_moving_days',
  'slow_moving_days',
  'dead_stock_days',
  'pricing_strategies',
  'company_name',
  'company_phone',
  'company_address',
  'company_logo',
  'currency',
  'display_timezone',
  'project_workflow_presets',
  'inventory_control_preset_sections',
  // v8.0.44 (TD-293): «انبار فروشگاه اینترنتی» — کد انبار فعال یا خالی (انبار پیش‌فرض)
  'wc_shop_warehouse',
]);

/** کلیدهای محرمانه یکپارچه‌سازی — فقط مدیر سیستم؛ فهرست مشترک با زبانه ووکامرس (v9.0.114، TD-668) */
const ADMIN_ONLY_SETTING_KEYS = new Set(SYSTEM_ADMIN_SETTING_KEYS);

/** پیکربندی دسترسی نقش‌ها — admin یا دارنده مجوز roles.manage (هم‌راستا با مدیریت نقش‌ها) */
const ROLE_CONFIG_SETTING_KEYS = new Set(['menu_visibility']);

/**
 * v7.0.85 (TD-109): کلیدهای بازنشسته — فلگ `runtime_enable_test_endpoints` پس از حذف روت‌های تست هیچ اثری نداشت و
 * حذف شد. فرم تنظیمات نسخه قبلی (تب بازمانده در مرورگر) هنوز آن را می‌فرستد؛ بی‌صدا نادیده گرفته می‌شود تا ذخیره شکست نخورد.
 */
const RETIRED_SETTING_KEYS = new Set(['runtime_enable_test_endpoints']);

export interface SettingsActor {
  id?: number;
  username?: string;
  fullName?: string;
  role?: string;
}

export interface SaveSettingsResult {
  changedKeys: string[];
  ignoredMaskedKeys: string[];
}

function normalizeSettingValue(key: string, raw: string): string {
  if (key === 'display_timezone') {
    return String(raw).trim();
  }
  return raw;
}

async function validateSettingValue(key: string, value: string): Promise<void> {
  if (key === 'wc_shop_warehouse' && value.trim() !== '') {
    const [wh] = await orm.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.code, value.trim()), eq(warehouses.isActive, 1)));
    if (!wh) {
      throw new ValidationError(`انبار فروشگاه اینترنتی «${value}» انبار فعالی نیست.`);
    }
  }
  if (key === 'display_timezone') {
    const { ALLOWED_TIMEZONES } = await import('../../lib/businessClock.js');
    if (!(ALLOWED_TIMEZONES as readonly string[]).includes(value)) {
      throw new ValidationError(`منطقه زمانی '${value}' پشتیبانی نمی‌شود.`);
    }
  }
}

async function assertKeyPermission(key: string, actor: SettingsActor): Promise<void> {
  if (ADMIN_ONLY_SETTING_KEYS.has(key)) {
    if (actor.role !== SYSTEM_ADMIN_ROLE) {
      throw new ForbiddenError(`تغییر تنظیم «${key}» (کلیدهای محرمانه یکپارچه‌سازی و فلگ‌های سیستمی) فقط برای مدیر سیستم مجاز است.`);
    }
    return;
  }
  if (ROLE_CONFIG_SETTING_KEYS.has(key)) {
    if (!(await userHasRoleOrPermission(actor, 'roles.manage'))) {
      throw new ForbiddenError('تغییر نمایش منو برای نقش‌ها نیازمند مجوز مدیریت نقش‌ها است.');
    }
  }
}

function redactForAudit(key: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return SENSITIVE_SETTING_PATTERN.test(key) ? '[PROTECTED]' : value;
}

export class SystemSettingsService {
  /** همه تنظیمات (کش ۶۰ ثانیه‌ای مشترک با invalidateSettingsCache)؛ مقدار غیرآرایه به فهرست خالی تبدیل می‌شود. */
  static async getAllSettings(): Promise<Array<{ key: string; value: string }>> {
    const settings = await appSettingsCache.getOrSet('all_settings', async () => {
      return orm.select().from(appSettings);
    }, 60_000);
    return Array.isArray(settings) ? settings : [];
  }

  /** V3.0.6 (SEC): مقدار کلیدهای حساس برای غیرادمین ماسک می‌شود. */
  static maskSensitiveSettings<T extends { key: string; value: string }>(settings: T[]): T[] {
    return settings.map((s) =>
      SENSITIVE_SETTING_PATTERN.test(s.key)
        ? { ...s, value: MASKED_SETTING_VALUE }
        : s
    );
  }

  /** V10-5.3: نقشه دید منو per-role (کش ۶۰ ثانیه‌ای)؛ مقدار نامعتبر یا غیرشیء به {} تبدیل می‌شود. */
  static async getMenuVisibility(): Promise<Record<string, unknown>> {
    return appSettingsCache.getOrSet('menu_visibility', async () => {
      const [row] = await orm.select().from(appSettings).where(eq(appSettings.key, 'menu_visibility'));
      if (!row?.value) return {};
      try {
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }, 60_000);
  }

  static isKnownSettingKey(key: string): boolean {
    return BUSINESS_SETTING_KEYS.has(key) || ADMIN_ONLY_SETTING_KEYS.has(key) || ROLE_CONFIG_SETTING_KEYS.has(key);
  }

  /**
   * Saves only the keys that actually changed. Masked values never overwrite real secrets,
   * unknown keys are rejected, and per-key permissions are checked only for changed keys.
   */
  static async saveSettings(
    items: Array<{ key: string; value: string }>,
    actor: SettingsActor
  ): Promise<SaveSettingsResult> {
    items = items.filter(i => !RETIRED_SETTING_KEYS.has(i.key));
    const unknownKeys = items.map(i => i.key).filter(k => !this.isKnownSettingKey(k));
    if (unknownKeys.length > 0) {
      throw new ValidationError(`کلید(های) تنظیمات ناشناخته: ${unknownKeys.join('، ')}`);
    }

    const changes: Array<{ key: string; before: string | undefined; after: string }> = [];
    const ignoredMaskedKeys: string[] = [];

    await orm.transaction(async (tx) => {
      const existingRows = await tx.select().from(appSettings);
      const current = new Map(existingRows.map(r => [r.key, r.value]));

      for (const item of items) {
        if (item.value === MASKED_SETTING_VALUE) {
          ignoredMaskedKeys.push(item.key);
          continue;
        }
        const value = normalizeSettingValue(item.key, item.value);
        const before = current.get(item.key);
        if (before !== undefined && before === value) {
          continue;
        }

        await assertKeyPermission(item.key, actor);
        await validateSettingValue(item.key, value);

        await tx.insert(appSettings).values({ key: item.key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } });
        changes.push({ key: item.key, before, after: value });
      }
    });

    if (changes.length > 0) {
      invalidateSettingsCache();
      const { invalidateTimezoneCache, warmDisplayTimezone } = await import('../../lib/businessClock.js');
      invalidateTimezoneCache();
      await warmDisplayTimezone(); // v8.0.77 (TD-324): بیرون از تراکنش، تا خواندن بعدی درون تراکنشی منتظر اتصال دوم نماند

      await logActivity({
        userId: actor.id,
        username: actor.username || 'سیستم',
        userFullName: actor.fullName || '',
        action: 'SETTING_CHANGE',
        entity: 'تنظیمات سیستم',
        description: `تغییر ${changes.length} گزینه از تنظیمات سیستم: ${changes.map(c => c.key).join('، ')}`,
        details: {
          changes: changes.map(c => ({
            setting: c.key,
            previousValue: redactForAudit(c.key, c.before),
            newValue: redactForAudit(c.key, c.after),
          })),
          ignoredMaskedKeys,
        },
      });
    }

    return { changedKeys: changes.map(c => c.key), ignoredMaskedKeys };
  }
}
