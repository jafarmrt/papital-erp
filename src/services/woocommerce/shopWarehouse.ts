import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { appSettings, warehouses } from '../../db/schema.js';
import { getDefaultWarehouseCode } from '../inventory/warehouseResolver.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { logger } from '../../middleware/logger.js';

/**
 * v8.0.44 (TD-293، تصمیم مالک محصول — گزینه الف): «انبار فروشگاه اینترنتی». فاکتور سفارش ووکامرس از همین انبار کم می‌کند و
 * همگام‌سازی موجودی، موجودی قابل فروش همین انبار را به فروشگاه می‌فرستد. پیش‌تر فاکتور از انبار پیش‌فرض کم می‌کرد ولی
 * همگام‌سازی جمع همه انبارها (با رزروها) را می‌فرستاد و سفارش پرداخت‌شده کالایی که در انبار دیگر بود رد می‌شد.
 */
export const WC_SHOP_WAREHOUSE_KEY = 'wc_shop_warehouse';

/** کد انبار فروشگاه: تنظیم، اگر انبار فعالی با آن کد هست؛ وگرنه انبار پیش‌فرض (فعالِ کم‌شناسه‌ترین) */
export async function resolveShopWarehouseCode(tx: DbExecutor): Promise<string> {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WC_SHOP_WAREHOUSE_KEY));
  const wanted = String(row?.value ?? '').trim();
  if (wanted) {
    const [wh] = await tx.select({ code: warehouses.code }).from(warehouses).where(and(eq(warehouses.code, wanted), eq(warehouses.isActive, 1)));
    if (wh) return wh.code;
    logger.warn({ message: `[WooCommerce] انبار فروشگاه «${wanted}» فعال نیست یا وجود ندارد؛ انبار پیش‌فرض به کار رفت.` });
  }
  return (await getDefaultWarehouseCode(tx)) ?? 'main';
}

/**
 * موجودی قابل فروش هر کالا در انبار فروشگاه، با همان قاعده‌ای که فاکتور خروج می‌سنجد: کمینه (موجودی همان انبار، موجودی کل
 * منهای رزروها) — ItemStockReservationService.computeSellable.
 *
 * v9.0.375 (TD-821) و v9.0.376 (TD-831): رزرو فقط برای همین کالاها خوانده می‌شود و خطای خواندن آن همگام‌سازی را رد می‌کند؛
 * پیش‌تر گزارش همه کالاها ساخته و خطایش بلعیده می‌شد و فروشگاه موجودی بی رزرو می‌گرفت.
 */
export async function shopSellableStocks(tx: DbExecutor, itemIds: number[]): Promise<{ warehouseCode: string; sellable: Map<number, number> }> {
  const warehouseCode = await resolveShopWarehouseCode(tx);
  const report = await ItemStockReservationService.getReservedStockDetails(tx, true, { itemIds });
  const summaryById = new Map(report.itemSummaries.map(s => [Number(s.itemId), s]));
  const stocks = await ItemWarehouseStockService.getStocksForItems(tx, itemIds);
  const sellable = new Map<number, number>();
  for (const itemId of itemIds) {
    const summary = summaryById.get(itemId);
    sellable.set(itemId, ItemStockReservationService.computeSellable(summary, stocks.get(itemId)?.byCode ?? {}, { location: warehouseCode }).sellable);
  }
  return { warehouseCode, sellable };
}
