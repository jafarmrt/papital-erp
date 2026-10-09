import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { itemPrices, items } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { priceListMatcher } from '../../lib/items/excelPriceColumns.js';
import {
  PRICING_PAGE_SIZE, type PricingPage, type PricingPageItem, type PricingPagePrice, type PricingPageQuery,
} from '../../lib/items/pricingPage.js';
import { ItemPricingService } from './itemPricing.service.js';
import { itemListConditions } from './itemPickList.js';

/**
 * v10.0.33 (OBS-R1-79): یک صفحه از کالاهای صفحه قیمت‌گذاری با قیمت‌های فعال همان کالاها. پالایش «قیمت کامل / ناقص»
 * قیمت‌های ذخیره‌شده را با همان قاعده `filterActivePrices` می‌سنجد؛ بی آن پالایش، شمارش و صفحه‌بندی در پایگاه‌داده است.
 */
const ITEM_FIELDS = {
  id: items.id,
  code: items.code,
  name: items.name,
  category: items.category,
  unit: items.unit,
  type: items.type,
  currentStock: items.currentStock,
  weightedAverageCost: items.weightedAverageCost,
};

async function activePricesOf(itemIds: number[], strategies: string[]): Promise<Record<number, PricingPagePrice[]>> {
  const grouped: Record<number, PricingPagePrice[]> = {};
  if (itemIds.length === 0) return grouped;
  const rows = await orm.select().from(itemPrices)
    .where(and(inArray(itemPrices.itemId, itemIds), eq(itemPrices.isDeleted, 0)));
  for (const p of ItemPricingService.filterActivePrices(rows, strategies)) {
    const itemId = Number(p.itemId ?? p.item_id);
    if (!itemId) continue;
    (grouped[itemId] ??= []).push(p as unknown as PricingPagePrice);
  }
  return grouped;
}

/** هر فهرست تنظیم‌شده یک قیمت فعال بزرگ‌تر از صفر دارد */
function hasEveryPrice(prices: PricingPagePrice[] | undefined, strategies: string[]): boolean {
  const matcher = priceListMatcher(strategies);
  const priced = new Set<string>();
  for (const p of prices ?? []) {
    const title = matcher.match(p.title);
    if (title && fin(p.price).isPositive()) priced.add(title);
  }
  return matcher.titles.every(t => priced.has(t));
}

const toItem = (r: Awaited<ReturnType<typeof selectItems>>[number]): PricingPageItem => ({
  id: r.id,
  code: r.code,
  name: r.name,
  category: r.category ?? undefined,
  unit: r.unit ?? 'عدد',
  type: r.type === 'raw_material' ? 'raw_material' : 'product',
  current_stock: Number(r.currentStock ?? 0),
  weighted_average_cost: Number(r.weightedAverageCost ?? 0),
});

function selectItems(where: SQL) {
  return orm.select(ITEM_FIELDS).from(items).where(where).orderBy(desc(items.id)).$dynamic();
}

export async function listPricingPage(q: PricingPageQuery): Promise<PricingPage> {
  const strategies = await ItemPricingService.getPricingStrategies();
  const conditions: SQL[] = [itemListConditions(q.type, q.search, { withCategory: true })];
  if (q.category) conditions.push(eq(items.category, q.category));
  const where = and(...conditions) as SQL;
  const limit = q.limit ?? PRICING_PAGE_SIZE;
  const page = Math.max(1, q.page ?? 1);
  const filter = q.priceFilter ?? 'all';

  let pageRows: PricingPageItem[];
  let total: number;
  let prices: Record<number, PricingPagePrice[]>;
  if (filter === 'all') {
    const query = selectItems(where);
    const [rows, [count]] = await Promise.all([
      q.all ? query : query.limit(limit).offset((page - 1) * limit),
      orm.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(items).where(where),
    ]);
    pageRows = rows.map(toItem);
    total = Number(count?.total) || 0;
    prices = await activePricesOf(pageRows.map(r => r.id), strategies);
  } else {
    const all = (await selectItems(where)).map(toItem);
    const allPrices = await activePricesOf(all.map(r => r.id), strategies);
    const wanted = filter === 'has_price';
    const matching = all.filter(r => hasEveryPrice(allPrices[r.id], strategies) === wanted);
    total = matching.length;
    pageRows = q.all ? matching : matching.slice((page - 1) * limit, page * limit);
    prices = Object.fromEntries(pageRows.filter(r => allPrices[r.id]).map(r => [r.id, allPrices[r.id]]));
  }
  return {
    data: pageRows,
    prices,
    strategies,
    total,
    page: q.all ? 1 : page,
    limit: q.all ? total : limit,
    totalPages: q.all ? 1 : Math.max(1, Math.ceil(total / limit)),
  };
}
