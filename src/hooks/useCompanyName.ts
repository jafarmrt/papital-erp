import { useSettingsQuery, SettingItem } from './queries/useSettingsQueries';

/**
 * v9.0.328 (TD-815، B12P-12): نام مجموعه از تنظیمات (`company_name`، «تنظیمات عمومی») برای سربرگ‌های چاپی.
 * پیش‌تر فیش حقوقی نام «مجموعه پاپیتال …» را ثابت در کد داشت. بی تنظیم، رشته تهی برمی‌گردد و سربرگ آن را نشان نمی‌دهد.
 */
export function useCompanyName(): string {
  const { data } = useSettingsQuery();
  const items = Array.isArray(data) ? data : ([] as SettingItem[]);
  return (items.find((s: SettingItem) => s?.key === 'company_name')?.value || '').trim();
}
