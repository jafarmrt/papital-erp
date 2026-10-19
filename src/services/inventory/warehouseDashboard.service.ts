import { sql, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, appSettings, warehouses, itemWarehouseStocks } from '../../db/schema.js';
import { resolveMovementDays } from '../../lib/settings/settingValues.js';
import { getMonthlyMovementTrends } from './monthlyMovementTrend.js';
import { dashboardMovementRows, recentDocumentCount } from './dashboardMovementStats.js';

/**
 * The «وضعیت انبار» page data (`GET /stats`, `GET /dashboard-bi-stats`), read here instead of in the route
 * (v10.2.28, TD-1326, OBS-R2-97). The reorder alarm is not part of it: the page reads `GET /items/reorder-alerts`,
 * which compares free stock (TD-843 / TD-1158); the uncapped total-stock list, the low-stock count and the user count
 * that no screen read are gone.
 */
export interface WarehouseStatsSummary {
  totalProducts: number;
  totalMaterials: number;
  recentTx: number;
}

export async function warehouseStatsSummary(): Promise<WarehouseStatsSummary> {
  const [counts] = await orm.select({
    products: sql<number>`count(*) filter (where ${items.type} = 'product')::int`,
    materials: sql<number>`count(*) filter (where ${items.type} = 'raw_material')::int`,
  }).from(items).where(eq(items.isDeleted, 0));
  // v9.0.289 (TD-671): documents, not Kardex rows, without voided rows and their reversals, seven business days
  const recentTx = await recentDocumentCount(7);
  return { totalProducts: Number(counts?.products ?? 0), totalMaterials: Number(counts?.materials ?? 0), recentTx: Number(recentTx) };
}

const BI_CACHE_TTL_MS = 30_000;
const biCache: { data: Awaited<ReturnType<typeof readWarehouseBiStats>> | null; timestamp: number } = { data: null, timestamp: 0 };

/** For tests: empties the 30-second cache of the BI statistics */
export function invalidateDashboardBiCache(): void {
  biCache.data = null;
  biCache.timestamp = 0;
}

async function readWarehouseBiStats() {
  const settings = await orm.select().from(appSettings)
    .where(inArray(appSettings.key, ['fast_moving_days', 'slow_moving_days', 'dead_stock_days']));
  // v9.0.276 (TD-672, decision t4): an invalid stored value takes the defaults, never a 500
  const { fastDays, slowDays, deadDays } = resolveMovementDays(Object.fromEntries(settings.map(s => [s.key, s.value])));

  // v9.0.289 (TD-671): real ledger outflows, without void reversals and warehouse transfers, in business-day ranges
  const { fastMoving, slowMoving, deadStock } = await dashboardMovementRows({ fastDays, slowDays, deadDays });

  const [valuation] = await orm.select({
    totalValue: sql<string | null>`SUM(${items.currentStock} * COALESCE(${items.weightedAverageCost}, 0))::text`,
  }).from(items).where(eq(items.isDeleted, 0));

  const activeWarehouses = await orm.select({ name: warehouses.name, code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1));
  const locations: Record<string, number> = {};
  const locationItemCounts: Record<string, number> = {};
  for (const w of activeWarehouses) {
    locations[w.code] = 0;
    locationItemCounts[w.code] = 0;
  }
  // v7.0.52 (TD-219): per-warehouse stock from item_warehouse_stocks
  const distribution = await orm
    .select({
      location: warehouses.code,
      totalStock: sql<string>`SUM(${itemWarehouseStocks.currentStock})`,
      itemCount: sql<string>`COUNT(*) FILTER (WHERE ${itemWarehouseStocks.currentStock} > 0)`,
    })
    .from(itemWarehouseStocks)
    .innerJoin(warehouses, eq(warehouses.id, itemWarehouseStocks.warehouseId))
    .innerJoin(items, eq(items.id, itemWarehouseStocks.itemId))
    .where(eq(items.isDeleted, 0))
    .groupBy(warehouses.code);
  // v9.0.96 (TD-496, decision t6): the warehouse chart counts the items with stock in each warehouse; quantities of
  // different units are never added together
  for (const row of distribution) {
    if (row.location in locations) {
      locations[row.location] = Number(row.totalStock);
      locationItemCounts[row.location] = Number(row.itemCount);
    }
  }

  // v8.0.54 (TD-316): Jalali months
  const monthlyTrends = await getMonthlyMovementTrends();

  return {
    fastMoving,
    slowMoving,
    deadStock,
    totalValuation: valuation?.totalValue ?? 0,
    locations,
    locationItemCounts,
    warehouses: activeWarehouses,
    monthlyTrends,
    fastDays,
    slowDays,
    deadDays,
  };
}

/** The BI statistics, kept for 30 seconds */
export async function warehouseBiStats() {
  const now = Date.now();
  if (biCache.data && now - biCache.timestamp < BI_CACHE_TTL_MS) return biCache.data;
  const data = await readWarehouseBiStats();
  biCache.data = data;
  biCache.timestamp = now;
  return data;
}
