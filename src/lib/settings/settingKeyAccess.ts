import { isSystemAdminViewer, type ViewerAccess } from '../permissions/pageAccess';

/**
 * کلیدهای تنظیمات که فقط مدیر سیستم تغییر می‌دهد: آدرس فروشگاه و کلیدهای محرمانه ووکامرس (تغییر آدرس فروشگاه کلیدها را
 * به سایت دیگری می‌فرستد، پس هم‌ردیف کلیدهای محرمانه است). سرور (`SystemSettingsService`) و زبانه ووکامرس از همین فهرست
 * می‌خوانند (v9.0.114، TD-668)؛ بقیه کلیدهای کسب‌وکاری با `settings.manage` ذخیره می‌شوند.
 */
export const SYSTEM_ADMIN_SETTING_KEYS: readonly string[] = [
  'wc_store_url',
  'wc_consumer_key',
  'wc_consumer_secret',
  'wc_webhook_secret',
];

/** این کاربر این کلید تنظیمات را ذخیره می‌کند (همان قاعده سرور) */
export function canEditSettingKey(key: string, viewer: ViewerAccess | null | undefined): boolean {
  if (isSystemAdminViewer(viewer)) return true;
  if (SYSTEM_ADMIN_SETTING_KEYS.includes(key)) return false;
  const held = Array.isArray(viewer?.permissions) ? viewer.permissions : [];
  return held.includes('settings.manage');
}
