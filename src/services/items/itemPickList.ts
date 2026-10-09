import { and, asc, desc, eq, gt, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { ItemPick } from '../../lib/permissions/pickLists.js';
import type { ItemListSort, ItemListStats } from '../../lib/items/itemListSort.js';
import { can } from '../../middleware/authorize.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';

/**
 * v9.0.138 (TD-888، تصمیم ت۱۰ الف مدل مجوز): فهرست انتخاب کالا (`GET /items/options`) برای فرم‌های بخش‌های دیگر (فاکتور و
 * حواله، رسید انبار، انبارگردانی، پروژه، خرید، ارتباط با مشتری، انتقال). فقط فیلدهای `ITEM_PICK_FIELDS` و موجودی هر انبار؛
 * میانگین بها فقط برای دارندگان `products.view`. فهرست کامل (`GET /items`، با نقطه سفارش، رزروها و نسخه رکورد) فقط با
 * مجوزهای بخش کالا باز است.
 */

/** شرط نوع و جست‌وجوی کالا، مشترک فهرست کامل و فهرست انتخاب */
export function itemListConditions(
  type: string | undefined, search: string | undefined, options: { withCategory?: boolean } = {},
): SQL {
  const conditions: SQL[] = [eq(items.isDeleted, 0)];
  if (type === 'product' || type === 'raw_material') conditions.push(eq(items.type, type));
  if (search) {
    const pattern = containsLikePattern(search);
    // v10.0.32 (OBS-R1-74): فهرست کامل در دسته‌بندی هم جست‌وجو می‌کند، همان که جعبه جست‌وجوی صفحه کالاها می‌گوید
    const fields = [ilike(items.name, pattern), ilike(items.code, pattern)];
    if (options.withCategory) fields.push(ilike(items.category, pattern));
    conditions.push(or(...fields) as SQL);
  }
  return and(...conditions) as SQL;
}

const SORT_COLUMNS = {
  category: items.category,
  code: items.code,
  name: items.name,
  reorder_point: items.reorderPoint,
  weighted_average_cost: items.weightedAverageCost,
  current_stock: items.currentStock,
} as const;

/** v10.0.32 (OBS-R1-74): ترتیب فهرست کامل؛ بی ستون تازه‌ترین کالا، و شناسه برای ترتیب پایدار میان صفحه‌ها */
export function itemListOrder(sort: ItemListSort | null): SQL[] {
  if (!sort) return [desc(items.id)];
  const column = SORT_COLUMNS[sort.key];
  return [sort.direction === 'desc' ? desc(column) : asc(column), desc(items.id)];
}

/** v10.0.32 (OBS-R1-74): آمار روی همه کالاهای پالایش، نه فقط ردیف‌های صفحه */
export async function itemListStats(where: SQL): Promise<ItemListStats> {
  const [row] = await orm.select({ lowStock: sql<number>`count(*)`.mapWith(Number) })
    .from(items)
    .where(and(where, gt(items.reorderPoint, 0), lte(items.currentStock, items.reorderPoint)));
  return { lowStock: Number(row?.lowStock) || 0 };
}

export interface ItemPickListQuery {
  type?: string;
  search?: string;
  /** بی سقف وقتی نیامده یا صفر است */
  limit?: number;
}

export async function listItemPicks(user: { role?: string } | undefined, query: ItemPickListQuery): Promise<ItemPick[]> {
  const withCost = await can(user, 'products.view');
  const base = orm.select({
    id: items.id,
    type: items.type,
    name: items.name,
    code: items.code,
    unit: items.unit,
    category: items.category,
    image: items.image,
    thumbnail: items.thumbnail,
    color: items.color,
    weight: items.weight,
    material: items.material,
    size: items.size,
    currentStock: items.currentStock,
    weightedAverageCost: items.weightedAverageCost,
  }).from(items)
    .where(itemListConditions(query.type, query.search))
    .orderBy(desc(items.id))
    .$dynamic();
  const rows = query.limit && query.limit > 0 ? await base.limit(query.limit) : await base;
  const stockMap = await ItemWarehouseStockService.getStocksForItems(orm, rows.map(r => r.id));

  return rows.map(({ weightedAverageCost, ...row }) => {
    const stocks: Record<string, number> = stockMap.get(row.id)?.byCode ?? {};
    const currentStock = Number(row.currentStock || 0);
    const pick: Record<string, unknown> = { ...row, currentStock, current_stock: currentStock, stocks };
    if (withCost) {
      pick.weightedAverageCost = weightedAverageCost;
      pick.weighted_average_cost = weightedAverageCost;
    }
    for (const [code, qty] of Object.entries(stocks)) pick[`stock_${code}`] = Number(qty || 0);
    return pick as unknown as ItemPick;
  });
}
