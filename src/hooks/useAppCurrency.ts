import { useMemo } from 'react';
import { useSettingsQuery, SettingItem } from './queries/useSettingsQueries';
import { normalizeRialDisplayUnit, rialDisplayOf, type RialDisplay, type RialDisplayUnit } from '../lib/rialDisplay';

/**
 * v9.0.275 (TD-667، تصمیم ت۱): تنظیم `currency` واحد نمایش مبالغ ریالی است، ریال یا تومان، نه ارز سند.
 * مبلغی که ارز خود را دارد با همان ارز نشان داده می‌شود؛ مبلغ ریالی (ارزش انبار، حقوق، مانده‌ها)
 * با `useRialDisplay()` در واحد نمایش و با برچسب درست آن.
 */
export function useAppCurrency(): RialDisplayUnit {
  const { data } = useSettingsQuery();
  const items = Array.isArray(data) ? data : ([] as SettingItem[]);
  return normalizeRialDisplayUnit(items.find((s: SettingItem) => s?.key === 'currency')?.value);
}

export function useRialDisplay(): RialDisplay {
  const unit = useAppCurrency();
  return useMemo(() => rialDisplayOf(unit), [unit]);
}
