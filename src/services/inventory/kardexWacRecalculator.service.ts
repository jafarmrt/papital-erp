import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { NegativeStockPolicyService } from './negativeStockPolicy.service.js';
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
        .where(eq(warehouses.isActive, 1));

      const defaultWhCode = activeWHs[0]?.code || 'main';

      const itemTxs = await txEngine
        .select()
        .from(transactions)
        .where(and(eq(transactions.itemId, itemId), eq(transactions.isDeleted, 0)))
        .orderBy(asc(transactions.date), asc(transactions.id));

      let runningBal = fin(0);
      let runningWac = fin(0);
      const whBreakdown: Record<string, number> = {};

      for (const w of activeWHs) {
        whBreakdown[w.code] = 0;
      }
      if (!whBreakdown[defaultWhCode]) {
        whBreakdown[defaultWhCode] = 0;
      }

      const policy = await NegativeStockPolicyService.getPolicy(txEngine);

      for (const tx of itemTxs) {
        const qty = fin(tx.quantity);
        const unitPrice = fin(tx.unitPrice || 0);
        const loc = tx.location || defaultWhCode;

        if (tx.type === 'in' || tx.type === 'transfer_in') {
          // محاسبه دقیق میانگین موزون (WAC):
          // اگر موجودی فعلی مثبت باشد: (runningBal * runningWac + qty * unitPrice) / (runningBal + qty)
          // اگر موجودی فعلی صفر یا منفی باشد: WAC = unitPrice
          if (runningBal.greaterThan(0)) {
            const currentTotalValue = runningBal.multiply(runningWac);
            const incomingTotalValue = qty.multiply(unitPrice);
            const newTotalQty = runningBal.add(qty);
            runningWac = newTotalQty.greaterThan(0)
              ? currentTotalValue.add(incomingTotalValue).divide(newTotalQty, 4)
              : unitPrice.round(4);
          } else {
            runningWac = unitPrice.round(4);
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

      // اگر موجودی نهایی صفر یا کمتر باشد، میانگین موزون WAC صفر می‌گردد
      if (runningBal.lessThanOrEqual(0)) {
        runningWac = fin(0);
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
