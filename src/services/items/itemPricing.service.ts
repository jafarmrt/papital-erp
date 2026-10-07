import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { getStrategyCanonicalKey, formatStrategyDisplayTitle } from '../../utils.js';
import type { DecimalValue } from '../../lib/financialDecimal.js';
import { priceListMatcher } from '../../lib/items/excelPriceColumns.js';

export interface PriceItemRecord {
  id?: number | string;
  itemId?: number | string;
  item_id?: number | string;
  title?: string;
  price?: DecimalValue;
  currency?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  [key: string]: unknown;
}

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
            return parsed.map((s: unknown) => String(s).trim()).filter(Boolean);
          }
        } else {
          const parsed = row.value.split(',').map((s: string) => String(s).trim()).filter(Boolean);
          if (parsed.length > 0) return parsed;
        }
      }
    } catch {
      // fallback
    }
    return ['فروشگاه', 'مصرف‌کننده', 'عمده'];
  }

  /**
   * Filters price records keeping only active prices and the latest price entry per canonical strategy for each item.
   * v9.0.114 (TD-647، ت۱ الف): با فهرست‌های فعال، فقط قیمت فهرست‌های تنظیم‌شده برمی‌گردد؛ پیش‌تر هر عنوانی (از جمله
   * «میانگین خرید (WAC)» و «موجودی کل» از ورود اکسل، یا فهرستی که از تنظیمات حذف شده) به کشوی قیمت فاکتور فروش می‌رفت.
   */
  static filterActivePrices(allPricesList: PriceItemRecord[], activeStrategies?: string[]): PriceItemRecord[] {
    const mapByItemAndTitle = new Map<string, PriceItemRecord>();
    const configured = activeStrategies ? priceListMatcher(activeStrategies) : null;

    for (const p of allPricesList) {
      if (p.isDeleted === 1 || p.is_deleted === 1) continue;
      const rawTitle = (p.title || '').trim();
      if (!rawTitle) continue;

      const canonicalKey = getStrategyCanonicalKey(rawTitle);
      if (!canonicalKey) continue;
      if (configured && !configured.match(rawTitle)) continue;

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
