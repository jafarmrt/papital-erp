import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, warehouses } from '../../db/schema.js';
import { ValidationError, ForbiddenError } from '../../errors/customErrors.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { SYSTEM_ADMIN_SETTING_KEYS } from '../../lib/settings/settingKeyAccess.js';
import { logActivity } from '../../lib/auditLogger.js';
import { readSettingValue, revealSettingSecrets, sealSettingValue } from './settingSecrets.js';
import { invalidateSettingsCache, appSettingsCache } from '../../lib/memoryCache.js';
import {
  MOVEMENT_DAY_KEYS, currencySettingError, isMovementDayKey, movementDaysError, readMovementDays
} from '../../lib/settings/settingValues.js';

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

/** کلیدهای محرمانه یکپارچه‌سازی — فقط مدیر سیستم؛ فهرست مشترک با زبانه ووکامرس (v9.0.131، TD-668) */
const ADMIN_ONLY_SETTING_KEYS = new Set(SYSTEM_ADMIN_SETTING_KEYS);

/**
 * v7.0.85 (TD-109): کلیدهای بازنشسته — فلگ `runtime_enable_test_endpoints` پس از حذف روت‌های تست هیچ اثری نداشت و
 * حذف شد. فرم تنظیمات نسخه قبلی (تب بازمانده در مرورگر) هنوز آن را می‌فرستد؛ بی‌صدا نادیده گرفته می‌شود تا ذخیره شکست نخورد.
 */
const RETIRED_SETTING_KEYS = new Set([
  'runtime_enable_test_endpoints',
  // v9.0.132 (TD-884، تصمیم ت۱۱): پنهان کردن منو برای هر نقش حذف شد؛ منو فقط از مجوزها ساخته می‌شود. مقدار ذخیره‌شده دست نخورده
  // می‌ماند ولی دیگر خوانده یا نوشته نمی‌شود
  'menu_visibility',
]);

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
  if (key === 'display_timezone' || key === 'currency') {
    return String(raw).trim();
  }
  // v9.0.276 (TD-672): روزهای گردش با ارقام لاتین ذخیره می‌شوند؛ مقدار نادرست دست‌نخورده می‌ماند تا بررسی آن را رد کند
  if (isMovementDayKey(key)) {
    const days = readMovementDays(raw);
    return days === null ? String(raw) : String(days);
  }
  return raw;
}

async function validateSettingValue(key: string, value: string): Promise<void> {
  // v9.0.276 (TD-667 / TD-672، تصمیم‌های ت۱ و ت۴): واحد نمایش فقط ریال یا تومان
  if (key === 'currency') {
    const error = currencySettingError(value);
    if (error) throw new ValidationError(error, { key, value }, 'SETTING_CURRENCY_INVALID');
  }
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

  /** v9.0.361 (TD-898): the system admin's answer carries the WooCommerce keys decrypted, never their ciphertext */
  static revealSettingSecrets<T extends { key: string; value: string }>(settings: T[]): T[] {
    return revealSettingSecrets(settings);
  }

  static isKnownSettingKey(key: string): boolean {
    return BUSINESS_SETTING_KEYS.has(key) || ADMIN_ONLY_SETTING_KEYS.has(key);
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

    const changes: Array<{ key: string; before: string | undefined; after: string; stored: string }> = [];
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
        // v9.0.361 (TD-898): an encrypted key is compared by its plain value; one that cannot be decrypted counts as changed
        const before = readSettingValue(item.key, current.get(item.key));
        if (before !== undefined && before !== null && before === value) {
          continue;
        }

        await assertKeyPermission(item.key, actor);
        await validateSettingValue(item.key, value);
        // encrypted before any write, so a missing ERP_SECRETS_KEY (503) saves nothing
        changes.push({ key: item.key, before: before ?? undefined, after: value, stored: sealSettingValue(item.key, value) });
      }

      // v9.0.276 (TD-672، تصمیم ت۴): سه روز گردش با هم سنجیده می‌شوند (مقدار تازه، وگرنه ذخیره‌شده) و هیچ‌چیز نوشته نمی‌شود اگر نادرست باشند
      if (changes.some(c => isMovementDayKey(c.key))) {
        const merged = Object.fromEntries(MOVEMENT_DAY_KEYS.map(key => [
          key,
          changes.find(c => c.key === key)?.after ?? current.get(key) ?? ''
        ])) as Record<typeof MOVEMENT_DAY_KEYS[number], string>;
        const error = movementDaysError(merged);
        if (error) throw new ValidationError(error, merged, 'SETTING_MOVEMENT_DAYS_INVALID');
      }

      for (const change of changes) {
        await tx.insert(appSettings).values({ key: change.key, value: change.stored })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: change.stored } });
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
