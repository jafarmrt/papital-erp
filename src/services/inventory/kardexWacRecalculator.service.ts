import { orm } from '../../db/drizzle.js';
import { items, warehouses, transactions } from '../../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { NegativeStockPolicyService } from './negativeStockPolicy.service.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { logActivity } from '../../lib/auditLogger.js';
import { logger } from '../../middleware/logger.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { nextVersion } from '../../lib/occHelper.js';
import { createLedgerLocationResolver } from './warehouseResolver.js';
import { replayKardexWac } from './kardexReplay.js';
import { money } from '../../lib/money.js';

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
        // v9.0.81 (TD-494): کالای ناموجود ۴۰۴، نه ۵۰۰
        throw new NotFoundError(`کالا با شناسه ${itemId} یافت نشد.`);
      }

      // v7.0.45 (audit P2-1): محل هر ردیف کاردکس با همان قاعده تطبیق موجودی انبارها (TD-200) روی همه انبارها نگاشت می‌شود
      const allWarehouses = await txEngine
        .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
        .from(warehouses);
      const resolveLocation = createLedgerLocationResolver(allWarehouses);

      // v8.0.4 (TD-258): همه ردیف‌های کاردکس کالا (حذف‌شده‌ها هم) به ترتیب ثبت؛ WAC و مانده کل با همان الگوریتم موتور
      // زنده بازپخش می‌شوند (replayKardexWac). پیش‌تر به ترتیب تاریخ و بدون رسیدهای ابطال‌شده حساب می‌شد و ابزار تعمیر
      // WAC سالم را تغییر می‌داد.
      const allItemTxs = await txEngine
        .select()
        .from(transactions)
        .where(eq(transactions.itemId, itemId))
        .orderBy(asc(transactions.id));

      // P0-04 (F1 & INV-01): ردیف حذف‌شده و ردیف معکوسِ ردیف حذف‌شده در مانده هیچ انباری نمی‌آیند
      const deletedIds = new Set(allItemTxs.filter(t => t.isDeleted === 1).map(t => t.id));
      const itemTxs = allItemTxs.filter(t => t.isDeleted === 0 && !(t.reversalOfId !== null && deletedIds.has(t.reversalOfId)));

      const qtyByWarehouseId = new Map<number, number>();
      const unresolvedByLocation = new Map<string, number>();

      const policy = await NegativeStockPolicyService.getPolicy(txEngine);

      for (const tx of itemTxs) {
        const qty = fin(tx.quantity);
        const isIn = tx.type === 'in' || tx.type === 'transfer_in';
        const isOut = tx.type === 'out' || tx.type === 'transfer_out';
        if (!isIn && !isOut) continue;

        const signedQty = isIn ? qty.toNumber() : qty.negate().toNumber();
        const wh = resolveLocation(tx.location);
        if (wh) {
          qtyByWarehouseId.set(wh.id, fin(qtyByWarehouseId.get(wh.id) ?? 0).add(signedQty).round(4).toNumber());
        } else {
          const key = String(tx.location ?? '');
          unresolvedByLocation.set(key, fin(unresolvedByLocation.get(key) ?? 0).add(signedQty).round(4).toNumber());
        }
      }

      // v8.0.13 (TD-269): بازپخش از WAC صفر شروع می‌شود؛ WAC کنونی فقط جایگزین نتیجه غیرمثبت است
      const replay = replayKardexWac(allItemTxs, item.weightedAverageCost);
      if (replay.firstNegativeRowId !== null && policy === 'forbidden') {
        // v9.0.81 (TD-494): خطای کاری با پیام فارسی و ۴۲۲ (پیش‌تر Error انگلیسی و ۵۰۰)
        throw new ValidationError(
          `بازسازی کاردکس کالای «${item.name}» (${item.code}) انجام نشد: مانده کاردکس به ترتیب ثبت در ردیف #${replay.firstNegativeRowId} ` +
          `به ${replay.minimumBalance.toNumber()} می‌رسد و موجودی منفی مجاز نیست.`,
          { code: 'KARDEX_REBUILD_NEGATIVE_BALANCE', itemId, transactionId: replay.firstNegativeRowId, balance: replay.minimumBalance.toNumber() }
        );
      }
      let runningWac = replay.wac;

      // v7.0.45 (audit P2-1): پیش‌تر محل نامعلوم بی‌صدا از جدول موجودی انبارها کنار گذاشته می‌شد و دو محل هم‌انبار
      // (کد و نام) یکدیگر را بازنویسی می‌کردند. هم‌راستا با تصمیم TD-200، کالای دارای گردش در محل نامعلوم یا مانده
      // منفی در یک انبار بازسازی نمی‌شود و خطای روشن می‌گیرد.
      const unresolved = [...unresolvedByLocation.entries()].filter(([, q]) => Math.abs(q) > 0.00005);
      if (unresolved.length > 0) {
        throw new ValidationError(
          `بازسازی کاردکس کالای «${item.name}» (${item.code}) انجام نشد: گردش در محل نامعلوم ` +
          unresolved.map(([loc, q]) => `«${loc}» (${q})`).join('، ') +
          '. ابتدا محل این گردش‌ها را در گزارش تطبیق موجودی انبارها بررسی کنید.'
        );
      }
      const negativeWh = [...qtyByWarehouseId.entries()].filter(([, q]) => q < -0.00005);
      if (negativeWh.length > 0) {
        const codes = negativeWh.map(([id, q]) => `${allWarehouses.find(w => w.id === id)?.code ?? id} (${q})`).join('، ');
        throw new ValidationError(`بازسازی کاردکس کالای «${item.name}» (${item.code}) انجام نشد: مانده کاردکس در انبار ${codes} منفی است.`);
      }

      // V6 (TD-136): در صورت صفر یا منفی شدن موجودی نهایی، بهای تمام‌شده تاریخی (WAC) نباید صفر شود
      // آخرین بهای میانگین موزون معتبر کالا حفظ می‌گردد تا در ارزش‌گذاری و معاملات بعدی معتبر بماند.
      if (runningWac.lessThanOrEqual(0)) {
        runningWac = fin(item.weightedAverageCost);
      }

      const oldStock = fin(item.currentStock).toNumber();
      const oldWac = fin(item.weightedAverageCost).toNumber();
      const newWac = runningWac.toNumber();
      const nowIso = new Date().toISOString();

      // جدول نرمال از دفتر کاردکس (موجودی کل را تریگر پایگاه‌داده از همین جدول می‌نویسد — TD-214)
      const stockBefore = await ItemWarehouseStockService.getStockSnapshot(txEngine, itemId);
      await ItemWarehouseStockService.setItemWarehouseStocks(txEngine, itemId, qtyByWarehouseId);
      const snapshot = await ItemWarehouseStockService.getStockSnapshot(txEngine, itemId);
      const whBreakdown = snapshot.byCode;
      const newStock = snapshot.total;

      await txEngine
        .update(items)
        .set({
          weightedAverageCost: money(runningWac),
          lastKardexRebuildAt: nowIso,
          version: nextVersion(item.version),
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
            stocks: stockBefore.byCode
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
    failedItems: Array<{ itemId: number; error: string }>;
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
    // v7.0.45 (audit P2-1): کالایی که بازسازی آن رد می‌شود (محل نامعلوم یا مانده منفی) بقیه را متوقف نمی‌کند و گزارش می‌شود
    const failedItems: Array<{ itemId: number; error: string }> = [];

    for (const item of allActiveItems) {
      let res: Awaited<ReturnType<typeof KardexWacRecalculatorService.rebuildItemFromLedger>>;
      try {
        res = await this.rebuildItemFromLedger(item.id, optsOrUserId, username);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[Kardex Rebuild] Item ${item.id} skipped: ${message}`);
        failedItems.push({ itemId: item.id, error: message });
        continue;
      }
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
      failedItems,
    };
  }
}
