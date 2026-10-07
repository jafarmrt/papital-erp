import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings, itemPrices, items } from '../../db/schema.js';
import { getStrategyCanonicalKey, formatStrategyDisplayTitle, normalizeStrategyTitle } from '../../utils.js';
import type { DecimalValue } from '../../lib/financialDecimal.js';
import { money, type Money } from '../../lib/money.js';
import { priceListMatcher } from '../../lib/items/excelPriceColumns.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';

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

/** یک نوشتن قیمت: تنظیم مبلغ یک فهرست قیمت، یا حذف صریح آن (`remove`) */
export interface ItemPriceWrite {
  itemId: number;
  title: string;
  price?: DecimalValue;
  currency?: string;
  remove?: boolean;
}

export interface ItemPriceChange {
  itemId: number;
  itemCode: string;
  itemName: string;
  title: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  beforePrice: Money | null;
  beforeCurrency: string | null;
  afterPrice: number | null;
  currency: string | null;
  /** شناسه ردیف تازه (تنظیم) */
  priceId?: number;
}

export interface ItemPriceWriteResult {
  changes: ItemPriceChange[];
  /** کالاهایی که پیدا نشدند یا حذف شده‌اند؛ نوشتنشان نادیده گرفته شد */
  missingItemIds: number[];
  /** به ترتیب نوشتن‌ها: شناسه ردیف فعال فهرست پس از نوشتن (تازه یا بی‌تغییر)، یا null */
  priceIds: Array<number | null>;
}

export class ItemPricingService {
  /**
   * Retrieves active pricing strategy titles configured in system settings.
   * v9.0.175 (TD-660): درون تراکنش با همان `tx` خوانده می‌شود (AGENTS §19).
   */
  static async getPricingStrategies(executor: DbExecutor = orm): Promise<string[]> {
    try {
      const [row] = await executor.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
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
   * v9.0.152 (TD-647، ت۱ الف): با فهرست‌های فعال، فقط قیمت فهرست‌های تنظیم‌شده برمی‌گردد؛ پیش‌تر هر عنوانی (از جمله
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

  /**
   * v9.0.175 (TD-660، B05-14): همه نوشتن‌های قیمت فرم و صفحه قیمت‌گذاری (`POST /items/:id/prices` و `batch-update`) از این
   * تابع و درون تراکنش فراخوان می‌گذرند. کالاها پیش از خواندن قیمت‌های فعال به ترتیب صعودی شناسه با `lockStockItems`
   * (FOR NO KEY UPDATE) قفل می‌شوند، پس دو ذخیره هم‌زمان یک فهرست پشت هم اجرا می‌شوند و هر فهرست یک ردیف فعال دارد.
   * پیش‌تر `POST` بی تراکنش و قفل می‌خواند، نرم حذف و درج می‌کرد و پنج ذخیره هم‌زمان «عمده» چهار ردیف فعال ساخت؛ قفل
   * ردیف قیمت‌های موجود در `batch-update` هم جلوی درج هم‌زمان قیمت تازه را نمی‌گرفت.
   * قیمتی که تنها قیمت فعال فهرستش با همان مبلغ و ارز است دوباره نوشته نمی‌شود (همان قاعده ورود اکسل، TD-662).
   */
  static async applyPriceWrites(tx: DbExecutor, writes: ItemPriceWrite[], strategies: string[]): Promise<ItemPriceWriteResult> {
    const itemIds = [...new Set(writes.map(w => Number(w.itemId)).filter(id => Number.isInteger(id) && id > 0))];
    if (itemIds.length === 0) return { changes: [], missingItemIds: [], priceIds: writes.map(() => null) };
    await lockStockItems(tx, itemIds);
    const liveItems = await tx.select({ id: items.id, name: items.name, code: items.code }).from(items)
      .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0)));
    const itemById = new Map(liveItems.map(i => [i.id, i]));
    const active = await tx.select().from(itemPrices)
      .where(and(inArray(itemPrices.itemId, itemIds), eq(itemPrices.isDeleted, 0)))
      .orderBy(asc(itemPrices.id));
    const matcher = priceListMatcher(strategies);
    const nowIso = new Date().toISOString();
    const changes: ItemPriceChange[] = [];
    const priceIds: Array<number | null> = [];

    for (const w of writes) {
      priceIds.push(null);
      const item = itemById.get(Number(w.itemId));
      if (!item) continue;
      const title = matcher.match(String(w.title)) ?? normalizeStrategyTitle(String(w.title));
      const canKey = getStrategyCanonicalKey(title);
      const matching = active.filter(p => p.itemId === item.id && getStrategyCanonicalKey(p.title) === canKey);
      const before = matching[matching.length - 1];
      const base = { itemId: item.id, itemCode: item.code, itemName: item.name, title, beforePrice: before?.price ?? null, beforeCurrency: before?.currency ?? null };

      if (w.remove) {
        if (matching.length === 0) continue;
        await ItemPricingService.retirePrices(tx, matching.map(m => m.id), nowIso);
        removeRows(active, matching);
        changes.push({ ...base, action: 'DELETED', afterPrice: null, currency: null });
        continue;
      }

      const amount = money(w.price ?? 0);
      const currency = String(w.currency || 'IRR');
      if (matching.length === 1 && before.price.equals(amount) && (before.currency || 'IRR') === currency) {
        priceIds[priceIds.length - 1] = before.id;
        continue;
      }
      await ItemPricingService.retirePrices(tx, matching.map(m => m.id), nowIso);
      removeRows(active, matching);
      const [inserted] = await tx.insert(itemPrices).values({
        itemId: item.id, title, price: amount, currency, createdAt: nowIso, updatedAt: nowIso, isDeleted: 0,
      }).returning();
      active.push(inserted);
      priceIds[priceIds.length - 1] = inserted.id;
      changes.push({ ...base, action: before ? 'UPDATED' : 'CREATED', afterPrice: amount.toNumber(), currency, priceId: inserted.id });
    }
    return { changes, missingItemIds: itemIds.filter(id => !itemById.has(id)), priceIds };
  }

  private static async retirePrices(tx: DbExecutor, ids: number[], nowIso: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.update(itemPrices).set({ isDeleted: 1, updatedAt: nowIso }).where(inArray(itemPrices.id, ids));
  }
}

function removeRows<T>(list: T[], rows: T[]): void {
  for (const r of rows) {
    const at = list.indexOf(r);
    if (at >= 0) list.splice(at, 1);
  }
}
