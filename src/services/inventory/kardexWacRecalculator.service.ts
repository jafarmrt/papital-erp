import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { NegativeStockPolicyService } from './negativeStockPolicy.service.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';

export interface KardexRebuildOptions {
  userId?: number;
  user?: string;
  fixWAC?: boolean;
}

export class KardexWacRecalculatorService {
  /**
   * Rebuilds stock and WAC for a single item from its sequential transaction ledger (Kardex).
   */
  static async rebuildItemFromLedger(
    itemId: number,
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ): Promise<{
    itemId: number;
    oldStock: number;
    newStock: number;
    oldWac: number;
    newWac: number;
    beforeStock: number;
    afterStock: number;
    whBreakdown: Record<string, number>;
  }> {
    const userId = typeof optsOrUserId === 'number' ? optsOrUserId : (optsOrUserId?.userId || undefined);
    const userName = typeof optsOrUserId === 'object' && optsOrUserId?.user ? optsOrUserId.user : (username || 'سیستم');

    return await orm.transaction(async (txEngine) => {
      const [item] = await txEngine
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)))
        .for('update');

      if (!item) {
        throw new Error(`کالا با شناسه ${itemId} یافت نشد.`);
      }

      const activeWHs = await txEngine
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, 1))
        .orderBy(asc(warehouses.id)); // v7.0.36 (P2-3): پیش‌فرض قطعی

      const defaultWhCode = activeWHs[0]?.code || 'main';

      const itemTxs = await txEngine
        .select()
        .from(transactions)
        .where(and(eq(transactions.itemId, itemId), eq(transactions.isDeleted, 0)))
        .orderBy(asc(transactions.date), asc(transactions.id));

      // P0-04 (F1 & INV-01): شناسایی تراکنش‌های معکوسی که ردیف مبدا آن‌ها حذف شده تا اثر مضاعف نگذارند
      const reversalIds = itemTxs
        .filter(t => t.reversalOfId !== null)
        .map(t => t.reversalOfId as number);

      let deletedOrigIds = new Set<number>();
      if (reversalIds.length > 0) {
        const deletedOrigs = await txEngine
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(inArray(transactions.id, reversalIds), eq(transactions.isDeleted, 1)));
        deletedOrigIds = new Set(deletedOrigs.map(d => d.id));
      }

      let runningBal = fin(0);
      let runningWac = fin(item.weightedAverageCost || 0);
      const whBreakdown: Record<string, number> = {};

      for (const w of activeWHs) {
        whBreakdown[w.code] = 0;
      }
      if (!whBreakdown[defaultWhCode]) {
        whBreakdown[defaultWhCode] = 0;
      }

      const policy = await NegativeStockPolicyService.getPolicy(txEngine);

      for (const tx of itemTxs) {
        // اگر تراکنش، معکوس یک ردیف حذف‌شده باشد، نباید بازپخش شود
        if (tx.reversalOfId && deletedOrigIds.has(tx.reversalOfId)) {
          continue;
        }

        const qty = fin(tx.quantity);
        const unitPrice = fin(tx.unitPrice || 0);
        const loc = tx.location || defaultWhCode;
        const isReversal = tx.reversalOfId !== null || (Boolean(tx.documentRef) && tx.documentRef!.startsWith('REV-'));

        if (tx.type === 'in' || tx.type === 'transfer_in') {
          // P1-03 (H-04 & TD-135): محاسبه دقیق WAC بر مبنای متد مرکزی واحد و بدون واگرایی
          if (!isReversal) {
            runningWac = FinancialMath.calculateWAC(runningBal, runningWac, qty, unitPrice);
          }

          runningBal = runningBal.add(qty);
          whBreakdown[loc] = fin(whBreakdown[loc] || 0).add(qty).toNumber();
        } else if (tx.type === 'out' || tx.type === 'transfer_out') {
          runningBal = runningBal.subtract(qty);
          whBreakdown[loc] = fin(whBreakdown[loc] || 0).subtract(qty).toNumber();

          if (runningBal.lessThan(0) && policy === 'forbidden') {
            throw new Error(`Negative stock detected during rebuild for item ${itemId} (${item.name}): balance=${runningBal.toNumber()}`);
          }
        }
      }

      // V6 (TD-136): در صورت صفر یا منفی شدن موجودی نهایی، بهای تمام‌شده تاریخی (WAC) نباید صفر شود
      // آخرین بهای میانگین موزون معتبر کالا حفظ می‌گردد تا در ارزش‌گذاری و معاملات بعدی معتبر بماند.
      if (runningWac.lessThanOrEqual(0)) {
        runningWac = fin(item.weightedAverageCost || 0);
      }

      const oldStock = fin(item.currentStock).toNumber();
      const oldWac = fin(item.weightedAverageCost).toNumber();
      const newStock = runningBal.toNumber();
      const newWac = runningWac.toNumber();
      const nowIso = new Date().toISOString();

      await txEngine
        .update(items)
        .set({
          currentStock: newStock,
          weightedAverageCost: newWac,
          stocks: whBreakdown,
          lastKardexRebuildAt: nowIso,
        })
        .where(eq(items.id, itemId));

      // V7 Phase 4.1 (TD-165): همگام‌سازی همزمان جدول رابطه‌ای نرمال‌سازی‌شده item_warehouse_stocks
      await ItemWarehouseStockService.rebuildItemWarehouseStocks(txEngine, itemId, whBreakdown);

      logger.info(`[Kardex Rebuild] Item ${itemId} (${item.name}): stock ${oldStock} -> ${newStock}, WAC ${oldWac} -> ${newWac}, processed ${itemTxs.length} transactions`);

      // Transactional Outbox
      const stockEvent = domainEventBus.createEvent(
        DomainEventType.STOCK_ADJUSTED,
        'Item',
        String(itemId),
        {
          itemId,
          itemCode: item.code,
          itemName: item.name,
          oldStock,
          newStock,
          oldWac,
          newWac,
          reason: 'بازسازی کامل کارتکس و WAC از روی تراکنش‌ها'
        },
        { userId, userName }
      );
      await OutboxService.saveToOutbox(txEngine, stockEvent);

      // Audit Log
      await logActivity({
        tx: txEngine,
        userId,
        username: userName,
        action: 'AUDIT_APPLY',
        entity: 'کالا',
        entityId: itemId,
        description: `بازسازی کارتکس و محاسبه مجدد WAC کالا ${item.name} (${item.code})`,
        details: {
          before: {
            stock: oldStock,
            wac: oldWac,
            stocks: item.stocks
          },
          after: {
            stock: newStock,
            wac: newWac,
            stocks: whBreakdown,
            lastKardexRebuildAt: nowIso
          },
          transactionsProcessed: itemTxs.length
        }
      });

      return {
        itemId,
        oldStock,
        newStock,
        oldWac,
        newWac,
        beforeStock: oldStock,
        afterStock: newStock,
        whBreakdown,
      };
    });
  }

  /**
   * Rebuilds stock and WAC for ALL items from their transaction ledgers.
   */
  static async rebuildAllFromLedger(
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ): Promise<{
    rebuiltCount: number;
    totalItemsChecked: number;
    discrepanciesFixed: number;
    wacRepairedCount: number;
    results: Array<{
      itemId: number;
      oldStock: number;
      newStock: number;
      oldWac: number;
      newWac: number;
    }>;
  }> {
    const allActiveItems = await orm
      .select({ id: items.id })
      .from(items)
      .where(eq(items.isDeleted, 0));

    const results: Array<{
      itemId: number;
      oldStock: number;
      newStock: number;
      oldWac: number;
      newWac: number;
    }> = [];

    let fixedCount = 0;
    let wacRepairedCount = 0;

    for (const item of allActiveItems) {
      const res = await this.rebuildItemFromLedger(item.id, optsOrUserId, username);
      if (res.oldStock !== res.newStock) fixedCount++;
      if (res.oldWac !== res.newWac) wacRepairedCount++;
      results.push({
        itemId: res.itemId,
        oldStock: res.oldStock,
        newStock: res.newStock,
        oldWac: res.oldWac,
        newWac: res.newWac,
      });
    }

    return {
      rebuiltCount: results.length,
      totalItemsChecked: results.length,
      discrepanciesFixed: fixedCount,
      wacRepairedCount,
      results,
    };
  }
}
