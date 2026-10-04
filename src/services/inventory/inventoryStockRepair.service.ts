import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { InsufficientStockError } from '../../errors/customErrors.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { withOrderedLocks } from '../../lib/lockOrder.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { assertStockMovementDate } from './stockMovementDate.js';

export class InventoryStockRepairService {
  /**
   * Executes inter-warehouse stock transfer with strict transaction safety and row locking (TD-138).
   */
  static async executeWarehouseTransfer(params: {
    itemId: number;
    fromLocation: string;
    toLocation: string;
    quantity: number;
    date?: string;
    notes?: string;
    createdBy?: string;
    user?: string;
    /** v8.0.4 (TD-257): کاربر مجوز «ثبت سند انبار با تاریخ گذشته» دارد (بررسی در مسیر) */
    allowBackdate?: boolean;
  }): Promise<{
    success: boolean;
    transferDocId: number;
    quantity: number;
    fromLocation: string;
    toLocation: string;
    updatedStocks: Record<string, number>;
  }> {
    const qty = fin(params.quantity).toNumber();
    if (qty <= 0) {
      throw new Error('مقدار انتقال باید بزرگتر از صفر باشد.');
    }
    if (params.fromLocation === params.toLocation) {
      throw new Error('مبداء و مقصد انتقال نمی‌توانند یکسان باشند.');
    }

    const txDate = params.date || await businessTodayIsoDate();
    const operatorName = params.user || params.createdBy || 'سیستم';

    return await orm.transaction(async (txEngine) => {
      await withOrderedLocks(txEngine, [
        { table: items, id: params.itemId, name: 'items' }
      ], async () => true);

      const [item] = await txEngine
        .select()
        .from(items)
        .where(and(eq(items.id, params.itemId), eq(items.isDeleted, 0)))
        .for('update');

      if (!item) {
        throw new Error(`کالا با شناسه ${params.itemId} یافت نشد.`);
      }

      const activeWHs = await txEngine
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, 1));

      const whCodes = new Set(activeWHs.map(w => w.code));
      if (!whCodes.has(params.fromLocation)) {
        throw new Error(`انبار مبداء معتبر نیست (${params.fromLocation}).`);
      }
      if (!whCodes.has(params.toLocation)) {
        throw new Error(`انبار مقصد معتبر نیست (${params.toLocation}).`);
      }

      // v7.0.45 (audit P2-1): انتقال روی جدول موجودی انبارها (منبع حقیقت) و سپس بازسازی کش از آن. پیش‌تر فقط
      // JSONB تغییر می‌کرد؛ جدول، موجودی کهنه انبار مبداء را نگه می‌داشت و گردش بعدی همان مقدار کهنه را دوباره در
      // JSONB می‌نوشت (بازتولید: رسید ۱۰، انتقال ۴، فروش ۵ ← موجودی ۹ به‌جای ۵).
      const fromWh = await ItemWarehouseStockService.resolveWarehouse(txEngine, params.fromLocation);
      const toWh = await ItemWarehouseStockService.resolveWarehouse(txEngine, params.toLocation);
      const before = await ItemWarehouseStockService.getStockSnapshot(txEngine, params.itemId);
      const currentFromQty = before.byCode[fromWh.code] ?? 0;

      if (currentFromQty < qty) {
        throw new InsufficientStockError(
          `موجودی انبار مبداء (${params.fromLocation}) برای کالا کافی نیست. موجودی فعلی: ${currentFromQty}، درخواست: ${qty}`
        );
      }

      // v8.0.4 (TD-257): تاریخ انتقال نه پیش از آخرین گردش کالا، مگر با مجوز و موجودی کافی انبار مبداء تا آن تاریخ و پس از آن
      await assertStockMovementDate(txEngine, {
        itemId: params.itemId,
        itemLabel: `«${item.name}» (${item.code})`,
        date: txDate,
        inOut: 'out',
        quantity: qty,
        warehouseId: fromWh.id,
        warehouseCode: fromWh.code,
        allowBackdate: params.allowBackdate === true,
      });

      await ItemWarehouseStockService.applyMovement(txEngine, { itemId: params.itemId, warehouse: fromWh, inOut: 'out', quantity: qty });
      await ItemWarehouseStockService.applyMovement(txEngine, { itemId: params.itemId, warehouse: toWh, inOut: 'in', quantity: qty });
      const after = await ItemWarehouseStockService.getStockSnapshot(txEngine, params.itemId);
      const updatedStocks = after.byCode;

      // v7.0.48 (TD-214): current_stock را تریگر پایگاه‌داده از item_warehouse_stocks می‌نویسد
      await txEngine
        .update(items)
        .set({ version: nextVersion(item.version) })
        .where(eq(items.id, params.itemId));

      const itemUnitPrice = money(item.weightedAverageCost);
      const itemTotalPrice = money(itemUnitPrice.multiply(qty));

      // 1. Transaction log out from source
      const [outTx] = await txEngine.insert(transactions).values({
        itemId: params.itemId,
        type: 'out',
        quantity: qty,
        unitPrice: itemUnitPrice,
        totalPrice: itemTotalPrice,
        date: txDate,
        documentType: 'transfer',
        documentRef: `انتقال انبار: ${params.fromLocation} به ${params.toLocation}`,
        location: params.fromLocation,
        notes: params.notes || `انتقال از ${params.fromLocation} به ${params.toLocation}`,
        createdBy: operatorName,
        isDeleted: 0,
      }).returning({ id: transactions.id });

      // 2. Transaction log in to destination
      await txEngine.insert(transactions).values({
        itemId: params.itemId,
        type: 'in',
        quantity: qty,
        unitPrice: itemUnitPrice,
        totalPrice: itemTotalPrice,
        date: txDate,
        documentType: 'transfer',
        documentRef: `انتقال انبار: ${params.fromLocation} به ${params.toLocation}`,
        location: params.toLocation,
        notes: params.notes || `دریافت از ${params.fromLocation}`,
        createdBy: operatorName,
        isDeleted: 0,
      });

      return {
        success: true,
        transferDocId: outTx?.id || 0,
        quantity: qty,
        fromLocation: params.fromLocation,
        toLocation: params.toLocation,
        updatedStocks,
      };
    });
  }
}
