import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { Category } from '../../types';
import { QUERY_KEYS, settingsKeys } from '../../lib/queryKeys';
import type { SettingItem } from './useSettingsQueries';

/**
 * v10.2 package 11 part 5e (TD-1364, OBS-R2-102): the project materials tab reads its categories and the inventory
 * control preset of the settings through the keys the settings screens and the other forms use, so a category or
 * settings change refreshes them and an opening of the tab reads none of them again while they are fresh. The item pick
 * list is the workspace's `useProjectItemOptions`, under the items key a stock change invalidates.
 */

const listOf = <T,>(res: unknown): T[] => {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
};

export function useInventoryCategoriesQuery() {
  return useQuery<Category[]>({
    queryKey: QUERY_KEYS.categories.list(),
    queryFn: async ({ signal }) => listOf<Category>(await fetchJson('/api/categories', { signal })),
  });
}

export function useInventorySettingsQuery() {
  return useQuery<SettingItem[]>({
    queryKey: settingsKeys.all,
    queryFn: async ({ signal }) => listOf<SettingItem>(await fetchJson('/api/settings', { signal })),
  });
}

/** the inventory control preset sections saved in the settings, `null` when none is saved; throws when unreadable */
export function presetSectionsOfSettings(settings: readonly SettingItem[] | undefined): unknown[] | null {
  const setting = (settings ?? []).find(s => s?.key === 'inventory_control_preset_sections');
  if (!setting?.value) return null;
  const parsed: unknown = JSON.parse(setting.value);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
}
