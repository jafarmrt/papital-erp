import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { warehouses } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { resolveShopWarehouseCode } from '../woocommerce/shopWarehouse.js';

/**
 * v11 phase 8.1 (package 18, start plan decision 5): the warehouse the site sells from is a setting of its own
 * (`sf_warehouse`); left empty it is the «انبار فروشگاه اینترنتی» of the WooCommerce settings, so both shops sell the same
 * stock until the owner splits them. The sellable quantity is the rule the sales invoice checks:
 * `ItemStockReservationService.computeSellable` (the warehouse's stock, at most the total less the reservations).
 */
export async function activeWarehouses(executor: DbExecutor): Promise<Array<{ code: string; name: string }>> {
  return executor.select({ code: warehouses.code, name: warehouses.name }).from(warehouses)
    .where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id));
}

/** The setting when it names an active warehouse, else the shop warehouse */
export async function storefrontWarehouseCode(executor: DbExecutor, wanted: string): Promise<string> {
  const code = wanted.trim();
  if (code) {
    const [row] = await executor.select({ code: warehouses.code }).from(warehouses)
      .where(and(eq(warehouses.code, code), eq(warehouses.isActive, 1)));
    if (row) return row.code;
    logger.warn({ message: `[Storefront] warehouse "${code}" is inactive or missing; the shop warehouse was used.` });
  }
  return resolveShopWarehouseCode(executor);
}

/** Each item's sellable quantity in the site's warehouse */
export async function storefrontSellable(executor: DbExecutor, itemIds: number[], wantedWarehouse: string): Promise<Map<number, number>> {
  const sellable = new Map<number, number>();
  if (itemIds.length === 0) return sellable;
  const location = await storefrontWarehouseCode(executor, wantedWarehouse);
  const report = await ItemStockReservationService.getReservedStockDetails(executor, true, { itemIds });
  const summaryById = new Map(report.itemSummaries.map(s => [Number(s.itemId), s]));
  const stocks = await ItemWarehouseStockService.getStocksForItems(executor, itemIds);
  for (const itemId of itemIds) {
    const summary = summaryById.get(itemId);
    sellable.set(itemId, ItemStockReservationService.computeSellable(summary, stocks.get(itemId)?.byCode ?? {}, { location }).sellable);
  }
  return sellable;
}
