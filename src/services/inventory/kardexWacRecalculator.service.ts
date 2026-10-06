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
import { replayKardexWac, wacDiffersFromReplay } from './kardexReplay.js';
import { money } from '../../lib/money.js';
import { lockStockItems } from './stockItemLocks.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { issueWacCorrectionVoucher } from '../accounting/wacCorrectionVoucher.js';

export interface KardexRebuildOptions {
  userId?: number;
  user?: string;
}

/** v9.0.84 (TD-487): کالایی که WAC آن با بازپخش کاردکس نمی‌خواند (فقط گزارش؛ اصلاح با correctItemWacFromLedger) */
export interface KardexWacDifference {
  itemId: number;
  itemCode: string;
  itemName: string;
  stock: number;
  recordedWac: number;
  replayWac: number;
  /** موجودی × (WAC بازپخش − WAC ثبت‌شده) */
  valueDifference: number;
}

export interface KardexRebuildItemResult {
  itemId: number;
  itemCode: string;
  itemName: string;
  oldStock: number;
  newStock: number;
  oldWac: number;
  /** v9.0.84 (TD-487): بازسازی WAC را تغییر نمی‌دهد؛ همان oldWac */
  newWac: number;
  replayWac: number;
  wacDiffers: boolean;
  valueDifference: number;
  beforeStock: number;
  afterStock: number;
  whBreakdown: Record<string, number>;
  /** v9.0.85 (TD-491): موجودی انبارها با بازسازی تغییر کرد (فقط آن‌گاه نسخه، رویداد و ردیف ممیزی) */
  changed: boolean;
}

/** v9.0.85 (TD-491): دو نقشه موجودی انبار (کد → مقدار) برابرند؛ انبار بی ردیف یعنی صفر */
function sameWarehouseStocks(a: Record<string, number>, b: Record<string, number>): boolean {
  const codes = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const code of codes) {
    if (!fin(a[code] ?? 0).subtract(fin(b[code] ?? 0)).abs().lessThan(fin(0.0001))) return false;
  }
  return true;
}

export interface KardexWacCorrectionResult {
  itemId: number;
  itemCode: string;
  itemName: string;
  stock: number;
  oldWac: number;
  newWac: number;
  valueDifference: number;
  voucherId: number | null;
  voucherNumber: number | null;
}

export const WAC_ALREADY_MATCHES_CODE = 'WAC_ALREADY_MATCHES_KARDEX';
export const WAC_CORRECTION_STOCK_MISMATCH_CODE = 'WAC_CORRECTION_STOCK_NOT_REBUILT';

export class KardexWacRecalculatorService {
  /**
   * Rebuilds the per-warehouse stock of a single item from its Kardex ledger.
   * v9.0.84 (TD-487, decision t3): quantities only; the WAC is never changed here. The replayed WAC is reported and a
   * difference is corrected only by correctItemWacFromLedger (own permission, draft voucher against 7012).
   */
  static async rebuildItemFromLedger(
    itemId: number,
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ): Promise<KardexRebuildItemResult> {
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
      // v9.0.84 (TD-487): WAC بازپخش فقط گزارش می‌شود (replayKardexWac نتیجه غیرمثبت را با WAC کنونی جایگزین می‌کند، TD-136)
      const replayWac = replay.wac.round(4);

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

      const oldStock = fin(item.currentStock).toNumber();
      const oldWac = fin(item.weightedAverageCost).toNumber();
      const newWac = oldWac;
      const nowIso = new Date().toISOString();

      // جدول نرمال از دفتر کاردکس (موجودی کل را تریگر پایگاه‌داده از همین جدول می‌نویسد — TD-214)
      const stockBefore = await ItemWarehouseStockService.getStockSnapshot(txEngine, itemId);
      await ItemWarehouseStockService.setItemWarehouseStocks(txEngine, itemId, qtyByWarehouseId);
      const snapshot = await ItemWarehouseStockService.getStockSnapshot(txEngine, itemId);
      const whBreakdown = snapshot.byCode;
      const newStock = snapshot.total;

      // v9.0.85 (TD-491): کالای بی‌تغییر فقط زمان آخرین بازسازی را می‌گیرد؛ نسخه، رویداد outbox و ردیف ممیزی فقط برای
      // کالایی که موجودی انبارهایش واقعاً عوض شد (پیش‌تر هر اجرای «بازسازی همه کالاها» برای همه کالاها می‌نوشت)
      const changed = !sameWarehouseStocks(stockBefore.byCode, whBreakdown);
      await txEngine
        .update(items)
        .set(changed ? { lastKardexRebuildAt: nowIso, version: nextVersion(item.version) } : { lastKardexRebuildAt: nowIso })
        .where(eq(items.id, itemId));

      const wacDiffers = wacDiffersFromReplay(oldWac, replayWac, newStock);
      const valueDifference = wacDiffers ? fin(newStock).multiply(replayWac.subtract(fin(oldWac))).round(4).toNumber() : 0;

      const result: KardexRebuildItemResult = {
        itemId,
        itemCode: item.code,
        itemName: item.name,
        oldStock,
        newStock,
        oldWac,
        newWac,
        replayWac: replayWac.toNumber(),
        wacDiffers,
        valueDifference,
        beforeStock: oldStock,
        afterStock: newStock,
        whBreakdown,
        changed,
      };
      if (!changed) return result;

      logger.info(`[Kardex Rebuild] Item ${itemId}: stock ${oldStock} -> ${newStock}, WAC ${oldWac} kept (Kardex replay ${replayWac.toString()}), processed ${itemTxs.length} transactions`);

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
          reason: 'بازسازی موجودی انبارها از روی کاردکس'
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
        description: `بازسازی موجودی کالا ${item.name} (${item.code}) از روی کاردکس`,
        details: {
          before: {
            stock: oldStock,
            stocks: stockBefore.byCode
          },
          after: {
            stock: newStock,
            stocks: whBreakdown,
            lastKardexRebuildAt: nowIso
          },
          wac: oldWac,
          replayWac: replayWac.toNumber(),
          wacDiffers,
          transactionsProcessed: itemTxs.length
        }
      });

      return result;
    });
  }

  /**
   * Rebuilds the per-warehouse stock of ALL items from their Kardex ledgers (quantities only, v9.0.84 TD-487) and lists
   * the items whose WAC differs from the Kardex replay.
   */
  static async rebuildAllFromLedger(
    optsOrUserId?: number | KardexRebuildOptions,
    username?: string
  ): Promise<{
    rebuiltCount: number;
    totalItemsChecked: number;
    discrepanciesFixed: number;
    wacDifferenceCount: number;
    wacDifferences: KardexWacDifference[];
    results: Array<{ itemId: number; oldStock: number; newStock: number; oldWac: number; replayWac: number }>;
    failedItems: Array<{ itemId: number; error: string }>;
  }> {
    const allActiveItems = await orm
      .select({ id: items.id })
      .from(items)
      .where(eq(items.isDeleted, 0));

    const results: Array<{ itemId: number; oldStock: number; newStock: number; oldWac: number; replayWac: number }> = [];
    const wacDifferences: KardexWacDifference[] = [];
    let fixedCount = 0;
    // v7.0.45 (audit P2-1): کالایی که بازسازی آن رد می‌شود (محل نامعلوم یا مانده منفی) بقیه را متوقف نمی‌کند و گزارش می‌شود
    const failedItems: Array<{ itemId: number; error: string }> = [];

    for (const item of allActiveItems) {
      let res: KardexRebuildItemResult;
      try {
        res = await this.rebuildItemFromLedger(item.id, optsOrUserId, username);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[Kardex Rebuild] Item ${item.id} skipped: ${message}`);
        failedItems.push({ itemId: item.id, error: message });
        continue;
      }
      if (res.changed) fixedCount++;
      if (res.wacDiffers) {
        wacDifferences.push({
          itemId: res.itemId, itemCode: res.itemCode, itemName: res.itemName, stock: res.newStock,
          recordedWac: res.oldWac, replayWac: res.replayWac, valueDifference: res.valueDifference,
        });
      }
      results.push({ itemId: res.itemId, oldStock: res.oldStock, newStock: res.newStock, oldWac: res.oldWac, replayWac: res.replayWac });
    }

    return {
      rebuiltCount: results.length,
      totalItemsChecked: results.length,
      discrepanciesFixed: fixedCount,
      wacDifferenceCount: wacDifferences.length,
      wacDifferences,
      results,
      failedItems,
    };
  }

  /**
   * v9.0.84 (TD-487, decision t3): sets an item's WAC to its Kardex replay and, in the same transaction, issues a draft
   * voucher for the value difference (stock x (replay WAC - old WAC)) against «کسری و اضافات انبار» (7012), like a stock
   * count. Runs only when the stock already equals the Kardex balance (rebuild first) and the WAC really differs.
   */
  static async correctItemWacFromLedger(itemId: number, opts: KardexRebuildOptions = {}): Promise<KardexWacCorrectionResult> {
    const userName = opts.user || 'سیستم';
    return await orm.transaction(async (tx) => {
      await lockStockItems(tx, [itemId]);
      const [item] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0)));
      if (!item) throw new NotFoundError(`کالا با شناسه ${itemId} یافت نشد.`);

      const allItemTxs = await tx.select().from(transactions).where(eq(transactions.itemId, itemId)).orderBy(asc(transactions.id));
      const replay = replayKardexWac(allItemTxs, item.weightedAverageCost);
      if (replay.firstNegativeRowId !== null) {
        throw new ValidationError(
          `اصلاح بهای میانگین کالای «${item.name}» (${item.code}) انجام نشد: مانده کاردکس به ترتیب ثبت در ردیف #${replay.firstNegativeRowId} منفی می‌شود.`,
          { code: 'KARDEX_REBUILD_NEGATIVE_BALANCE', itemId, transactionId: replay.firstNegativeRowId }
        );
      }
      const stock = fin(item.currentStock);
      if (!stock.subtract(replay.balance).abs().lessThan(fin(0.0001))) {
        throw new ValidationError(
          `اصلاح بهای میانگین کالای «${item.name}» (${item.code}) انجام نشد: موجودی ثبت‌شده (${stock.toString()}) با مانده کاردکس ` +
          `(${replay.balance.toString()}) برابر نیست. ابتدا «بازسازی موجودی از کاردکس» را اجرا کنید.`,
          { code: WAC_CORRECTION_STOCK_MISMATCH_CODE, itemId }
        );
      }
      const oldWac = fin(item.weightedAverageCost);
      const newWac = replay.wac.round(4);
      if (!wacDiffersFromReplay(oldWac, newWac, stock)) {
        throw new ValidationError(
          `بهای میانگین کالای «${item.name}» (${item.code}) با بازپخش کاردکس می‌خواند و اصلاحی لازم نیست.`,
          { code: WAC_ALREADY_MATCHES_CODE, itemId }
        );
      }

      const valueDifference = stock.multiply(newWac.subtract(oldWac)).round(4);
      const voucher = await issueWacCorrectionVoucher({
        itemId, itemCode: item.code, itemName: item.name, itemType: item.type, valueDifference,
        date: await businessTodayIsoDate(),
        description: `اصلاح بهای میانگین کالای «${item.name}» (${item.code}) از ${oldWac.toString()} به ${newWac.toString()} بر پایه کاردکس`,
        userId: opts.userId, username: userName,
      }, tx);

      await tx.update(items)
        .set({ weightedAverageCost: money(newWac), version: nextVersion(item.version) })
        .where(eq(items.id, itemId));

      await logActivity({
        tx,
        userId: opts.userId,
        username: userName,
        action: 'UPDATE',
        entity: 'کالا',
        entityId: itemId,
        description: `اصلاح بهای میانگین کالای ${item.name} (${item.code}) از روی کاردکس با سند پیش‌نویس اختلاف ارزش`,
        details: {
          before: { wac: oldWac.toNumber(), stock: stock.toNumber() },
          after: { wac: newWac.toNumber(), stock: stock.toNumber() },
          valueDifference: valueDifference.toNumber(),
          voucherId: voucher?.id ?? null,
        },
      });

      return {
        itemId,
        itemCode: item.code,
        itemName: item.name,
        stock: stock.toNumber(),
        oldWac: oldWac.toNumber(),
        newWac: newWac.toNumber(),
        valueDifference: valueDifference.toNumber(),
        voucherId: voucher?.id ?? null,
        voucherNumber: voucher?.voucherNumber ?? null,
      };
    });
  }
}
