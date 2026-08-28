import { useSettingsQuery, SettingItem } from './queries/useSettingsQueries';

/**
 * V9 Phase 3: ارز پیش‌فرض سامانه از تنظیمات (appSettings.currency).
 * برای نمایش‌هایی که رکورد فیلد currency اختصاصی ندارد (مانند نرخ‌های پرکیسی
 * و ارزش‌گذاری انبار) استفاده می‌شود تا برچسب ارز هرگز هاردکد نشود.
 */
export function useAppCurrency(): string {
  const { data } = useSettingsQuery();
  const items = Array.isArray(data) ? data : ([] as SettingItem[]);
  return items.find((s: SettingItem) => s?.key === 'currency')?.value || 'IRR';
}
