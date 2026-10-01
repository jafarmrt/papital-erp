import { eq, and } from 'drizzle-orm';
import { itemWarehouseStocks, warehouses, items } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { ValidationError, InsufficientStockError } from '../../errors/customErrors.js';
import { logger } from '../../middleware/logger.js';
import type { DbExecutor } from '../../db/drizzle.js';

export type DbClient = DbExecutor;

export interface WarehouseInfo {
  id: number;
  code: string;
  name: string;
}

export class ItemWarehouseStockService {
  /**
   * Resolves raw warehouse input (code, name, id or empty) to standard WarehouseInfo.
   */
  public static async resolveWarehouse(tx: DbClient, raw?: unknown): Promise<WarehouseInfo> {
    const allWarehouses = await tx
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, 1));

    if (allWarehouses.length === 0) {
      throw new ValidationError('هیچ انبار فعالی در سیستم تعریف نشده است.');
    }

    const input = String(raw ?? '').trim();
    if (!input) {
      return allWarehouses[0];
    }

    const lower = input.toLowerCase();
    const byCode = allWarehouses.find(w => w.code.toLowerCase() === lower);
    if (byCode) return byCode;

    const byName = allWarehouses.find(w => w.name.trim().toLowerCase() === lower);
    if (byName) return byName;

    const byId = allWarehouses.find(w => String(w.id) === input);
    if (byId) return byId;

    throw new ValidationError(`انبار با مشخصه «${input}» تعریف نشده یا غیرفعال است.`);
  }

  /**
   * Applies stock movement directly on the normalized item_warehouse_stocks table under row lock.
   */
  public static async applyMovement(
    tx: DbClient,
    params: {
      itemId: number;
      warehouse: WarehouseInfo;
      inOut: 'in' | 'out';
      quantity: number;
    }
  ): Promise<{ newLocationStock: number; previousLocationStock: number }> {
    const { itemId, warehouse, inOut, quantity } = params;
    const qty = Number(quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError(`مقدار گردش انبار باید عددی مثبت باشد: ${quantity}`);
    }

    // v7.0.35 (audit P2-2): ردیف (کالا × انبار) ابتدا با INSERT ... ON CONFLICT DO NOTHING تضمین و سپس قفل
    // سطری واقعی گرفته می‌شود. پیش‌تر SELECT ... FOR UPDATE روی ردیف ناموجود قفلی نمی‌گرفت و دو تراکنش همزمانِ
    // اولین حرکت یک کالا در یک انبار هر دو INSERT می‌کردند و یکی با خطای 23505 شکست می‌خورد.
    const { row: existing, created } = await ItemWarehouseStockService.lockOrCreateRow(tx, itemId, warehouse);

    let previousLocationStock = Number(existing.currentStock || 0);
    if (created) {
      // Lazy migration / initialize from items.stocks JSONB or items.currentStock under lock
      const [it] = await tx
        .select({ stocks: items.stocks, currentStock: items.currentStock })
        .from(items)
        .where(eq(items.id, itemId))
        .for('update');

      previousLocationStock = 0;
      if (it) {
        const stocksJson = (it.stocks as Record<string, number>) || {};
        const valByCode = stocksJson[warehouse.code] ?? stocksJson[warehouse.code.toLowerCase()];
        const valById = stocksJson[String(warehouse.id)];
        const valByName = stocksJson[warehouse.name];
        const rawStockVal = valByCode ?? valById ?? valByName;

        if (rawStockVal !== undefined && Number.isFinite(Number(rawStockVal))) {
          previousLocationStock = Number(rawStockVal);
        } else if (Object.keys(stocksJson).length === 0 && Number(it.currentStock || 0) > 0 && (warehouse.code === 'main' || warehouse.id === 1)) {
          previousLocationStock = Number(it.currentStock || 0);
        }
      }
    }
    let newLocationStock: number;

    if (inOut === 'in') {
      newLocationStock = fin(previousLocationStock).add(qty).round(4).toNumber();
    } else {
      // v7.0.22 (TD-180 / audit P0-3): منفی شدن موجودی همیشه ممنوع است (هم‌راستا با قید
      // دیتابیسی chk_iws_current_stock_non_negative)؛ پیام خوانا به‌جای خطای ۵۰۰ نقض قید.
      if (previousLocationStock < qty) {
        throw new InsufficientStockError(
          `موجودی کافی در انبار «${warehouse.name}» (${warehouse.code}) نیست. موجودی فعلی: ${previousLocationStock}، درخواست کسر: ${qty}`
        );
      }
      newLocationStock = fin(previousLocationStock).subtract(qty).round(4).toNumber();
    }

    await tx
      .update(itemWarehouseStocks)
      .set({
        currentStock: newLocationStock,
        warehouseCode: warehouse.code,
        version: created ? existing.version : existing.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(itemWarehouseStocks.id, existing.id));

    return { newLocationStock, previousLocationStock };
  }

  /**
   * v7.0.35 (audit P2-2): ردیف موجودی (کالا × انبار) را در صورت نبود با موجودی صفر درج می‌کند (ON CONFLICT DO
   * NOTHING روی ایندکس یکتای idx_item_warehouse_unique) و سپس آن را FOR UPDATE قفل می‌کند. درج همزمان تا پایان
   * تراکنش اول منتظر می‌ماند، پس فراخوان دوم همیشه ردیف commitشده و قفل واقعی را می‌گیرد. `created` یعنی ردیف
   * در همین تراکنش ساخته شد و مقدار اولیه آن هنوز تعیین نشده است.
   */
  private static async lockOrCreateRow(
    tx: DbClient,
    itemId: number,
    warehouse: WarehouseInfo
  ): Promise<{ row: typeof itemWarehouseStocks.$inferSelect; created: boolean }> {
    const nowIso = new Date().toISOString();
    const inserted = await tx
      .insert(itemWarehouseStocks)
      .values({
        itemId,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        currentStock: 0,
        reservedStock: 0,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: [itemWarehouseStocks.itemId, itemWarehouseStocks.warehouseId] })
      .returning({ id: itemWarehouseStocks.id });

    const [row] = await tx
      .select()
      .from(itemWarehouseStocks)
      .where(and(
        eq(itemWarehouseStocks.itemId, itemId),
        eq(itemWarehouseStocks.warehouseId, warehouse.id)
      ))
      .for('update');

    return { row, created: inserted.length > 0 };
  }

  /**
   * Syncs the normalized rows of an item to the JSONB items.stocks column and items.currentStock.
   * Maintains 100% backwards compatibility as a high-performance Read-Cache.
   */
  public static async syncJsonbReadCache(
    tx: DbClient,
    itemId: number
  ): Promise<{ stocksJson: Record<string, number>; totalStock: number }> {
    const rows = await tx
      .select({
        warehouseCode: itemWarehouseStocks.warehouseCode,
        currentStock: itemWarehouseStocks.currentStock,
      })
      .from(itemWarehouseStocks)
      .where(eq(itemWarehouseStocks.itemId, itemId));

    const stocksJson: Record<string, number> = {};
    let totalStock = fin(0);

    for (const r of rows) {
      const val = Number(r.currentStock || 0);
      stocksJson[r.warehouseCode] = val;
      totalStock = totalStock.add(val);
    }

    const finalTotalStock = totalStock.round(4).toNumber();

    await tx
      .update(items)
      .set({
        stocks: stocksJson,
        currentStock: finalTotalStock,
      })
      .where(eq(items.id, itemId));

    return { stocksJson, totalStock: finalTotalStock };
  }

  /**
   * Bulk synchronizes warehouse breakdown into item_warehouse_stocks (e.g., during Kardex rebuild).
   */
  public static async rebuildItemWarehouseStocks(
    tx: DbClient,
    itemId: number,
    breakdown: Record<string, number>
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    for (const [rawWh, qty] of Object.entries(breakdown)) {
      try {
        const wh = await ItemWarehouseStockService.resolveWarehouse(tx, rawWh);
        const stockNum = fin(Number(qty) || 0).round(4).toNumber();

        const { row: existing, created } = await ItemWarehouseStockService.lockOrCreateRow(tx, itemId, wh);
        await tx
          .update(itemWarehouseStocks)
          .set({
            currentStock: stockNum,
            warehouseCode: wh.code,
            version: created ? existing.version : existing.version + 1,
            updatedAt: nowIso,
          })
          .where(eq(itemWarehouseStocks.id, existing.id));
      } catch (err: any) {
        logger.warn(`[ItemWarehouseStockService] Could not resolve warehouse "${rawWh}" for item ${itemId}: ${err.message}`);
      }
    }
  }
}
