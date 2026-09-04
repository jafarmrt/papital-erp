import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { fin, FinancialMath } from '../../utils/financialMath.js';

export class InventoryStockRepairService {
  /**
   * Executes inter-warehouse stock transfer with strict transaction safety and row locking.
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

    const txDate = params.date || new Date().toISOString().split('T')[0];
    const operatorName = params.user || params.createdBy || 'سیستم';

    return await orm.transaction(async (txEngine) => {
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

      const stocksObj = (item.stocks as Record<string, number>) || {};
      const currentFromQty = fin(stocksObj[params.fromLocation]).toNumber();

      if (currentFromQty < qty) {
        throw new Error(
          `موجودی انبار مبداء (${params.fromLocation}) برای کالا کافی نیست. موجودی فعلی: ${currentFromQty}، درخواست: ${qty}`
        );
      }

      const updatedStocks = { ...stocksObj };
      updatedStocks[params.fromLocation] = FinancialMath.subtract(currentFromQty, qty);
      updatedStocks[params.toLocation] = FinancialMath.add(fin(updatedStocks[params.toLocation]).toNumber(), qty);

      await txEngine
        .update(items)
        .set({ stocks: updatedStocks })
        .where(eq(items.id, params.itemId));

      const itemUnitPrice = Number(item.weightedAverageCost) || 0;
      const itemTotalPrice = fin(itemUnitPrice).multiply(qty).toNumber();

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
