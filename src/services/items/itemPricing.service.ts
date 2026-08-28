import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { getStrategyCanonicalKey, formatStrategyDisplayTitle } from '../../utils.js';

export class ItemPricingService {
  /**
   * Retrieves active pricing strategy titles configured in system settings.
   */
  static async getPricingStrategies(): Promise<string[]> {
    try {
      const [row] = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
      if (row && row.value) {
        if (row.value.trim().startsWith('[')) {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((s: any) => String(s).trim()).filter(Boolean);
          }
        } else {
          const parsed = row.value.split(',').map((s: string) => String(s).trim()).filter(Boolean);
          if (parsed.length > 0) return parsed;
        }
      }
    } catch (e) {
      // fallback
    }
    return ['فروشگاه', 'مصرف‌کننده', 'عمده'];
  }

  /**
   * Filters price records keeping only active prices and the latest price entry per canonical strategy for each item.
   * Preserves all active non-deleted prices across all strategy tiers.
   */
  static filterActivePrices(allPricesList: any[], _activeStrategies?: string[]) {
    const mapByItemAndTitle = new Map<string, any>();

    for (const p of allPricesList) {
      if (p.isDeleted === 1 || p.is_deleted === 1) continue;
      const rawTitle = (p.title || '').trim();
      if (!rawTitle) continue;

      const canonicalKey = getStrategyCanonicalKey(rawTitle);
      if (!canonicalKey) continue;

      const key = `${p.itemId || p.item_id}_${canonicalKey}`;
      const existing = mapByItemAndTitle.get(key);
      const cleanDisplayTitle = formatStrategyDisplayTitle(p.title);

      if (!existing) {
        mapByItemAndTitle.set(key, {
          ...p,
          title: cleanDisplayTitle
        });
      } else {
        const existingId = Number(existing.id) || 0;
        const currentId = Number(p.id) || 0;
        if (currentId > existingId) {
          mapByItemAndTitle.set(key, {
            ...p,
            title: cleanDisplayTitle
          });
        }
      }
    }

    return Array.from(mapByItemAndTitle.values());
  }
}
