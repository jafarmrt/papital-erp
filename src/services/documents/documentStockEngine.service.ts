import { eq } from 'drizzle-orm';
import { items, transactions } from '../../db/schema.js';
import { normalizeDateToDbTimestamp } from '../../utils.js';
import { fin, FinancialMath } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { KardexWacRecalculatorService } from '../inventory/kardexWacRecalculator.service.js';
import type { DbClient } from './types.js';

export interface ApplyStockMovementParams {
  itemId: number;
  documentId?: number | null;
  inOut: 'in' | 'out';
  quantity: number;
  price: number;
  date: string;
  documentType: string;
  documentRef: string;
  user: string;
  targetLoc: string;
  notes?: string;
}

export interface ApplyStockReversalParams {
  itemId: number;
  quantity: number;
  originalDirection: 'in' | 'out';
  unitPrice: number;
  location: string;
}

export class DocumentStockEngine {
  /**
   * Applies stock movement for a single document item (creates transaction and updates item stocks/WAC).
   */
  static async applyStockMovement(
    tx: DbClient,
    params: ApplyStockMovementParams
  ): Promise<{ transactionId: number }> {
    const { itemId, documentId, inOut, quantity, price, date, documentType, documentRef, user, targetLoc, notes } = params;
    const qty = Number(quantity);
    const priceNum = Number(price);

    const whInfo = await ItemWarehouseStockService.resolveWarehouse(tx, targetLoc);
    const finalTargetLoc = whInfo.code;

    // V9-P0: گارد دفاعی — مقدار منفی/نامعتبر جهت in/out را برعکس می‌کند و WAC را خراب می‌کند
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError(
        `مقدار گردش انبار باید عددی بزرگ‌تر از صفر باشد (مقدار دریافتی: ${String(quantity)}).`
      );
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      throw new ValidationError(
        `قیمت واحد در گردش انبار نمی‌تواند منفی یا نامعتبر باشد (مقدار دریافتی: ${String(price)}).`
      );
    }

    // Atomically fetch and lock the item row before performing any inventory calculation
    const [itemData] = await tx
      .select({
        id: items.id,
        name: items.name,
        code: items.code,
        unit: items.unit,
        weightedAverageCost: items.weightedAverageCost,
        version: items.version
      })
      .from(items)
      .where(eq(items.id, itemId))
      .for('update');

    if (!itemData) {
      throw new NotFoundError(`کالای مورد نظر با شناسه ${itemId} در سیستم یافت نشد.`);
    }

    // v7.0.45 (audit P2-1): موجودی پیش از حرکت از جدول نرمال (منبع حقیقت)، نه از کش JSONB
    const before = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const oldTotalStock = before.total;

    const normalizedTxDate = normalizeDateToDbTimestamp(date);

    const currentItemWac = Number(itemData.weightedAverageCost) || 0;
    // P1-02 (H-01, F2 & INV-01): ثبت بهای تمام‌شده تاریخی خروج در تراکنش انبار جهت حفظ انضباط دفاتر دوبل
    const txUnitPrice = inOut === 'out' ? (currentItemWac > 0 ? currentItemWac : price) : price;
    const txTotalPrice = fin(txUnitPrice).multiply(qty).round(4).toNumber();

    const [insertedTx] = await tx.insert(transactions).values({
      itemId,
      documentId: documentId ?? undefined,
      type: inOut,
      quantity: qty,
      unitPrice: txUnitPrice,
      totalPrice: txTotalPrice,
      date: normalizedTxDate,
      documentType,
      documentRef: String(documentRef),
      createdBy: user,
      notes: notes || (inOut === 'out' && price !== txUnitPrice && price > 0 ? `قیمت فروش: ${price}` : ''),
      location: finalTargetLoc,
      isDeleted: 0,
    }).returning({ id: transactions.id });

    // V7 Phase 4.1 (TD-165): به‌روزرسانی جدول رابطه‌ای نرمال‌سازی‌شده item_warehouse_stocks تحت قفل سطری
    await ItemWarehouseStockService.applyMovement(tx, {
      itemId,
      warehouse: whInfo,
      inOut,
      quantity: qty,
    });

    // v7.0.45 (audit P2-1): کش JSONB و موجودی کل فقط از جدول نرمال ساخته می‌شوند. پیش‌تر موجودی کل از جمع کلیدهای
    // JSONB حساب می‌شد و کلیدهای قدیمی (نام انبار به‌جای کد) یا انتقال‌هایی که فقط JSONB را تغییر داده بودند،
    // موجودی را دوبار می‌شمردند یا مقدار کهنه جدول را دوباره در JSONB می‌نوشتند.
    const after = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const currentStocks = after.byCode;
    const newTotalStock = after.total;

    let newWAC = Number(itemData.weightedAverageCost || 0);
    if (inOut === 'in') {
      newWAC = FinancialMath.calculateWAC(oldTotalStock, newWAC, qty, price).toNumber();
    }

    await tx
      .update(items)
      .set({
        stocks: currentStocks,
        currentStock: newTotalStock,
        weightedAverageCost: newWAC,
        version: nextVersion(itemData.version)
      })
      .where(eq(items.id, itemId));

    // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with stock updates)
    const eventType = inOut === 'in' ? DomainEventType.STOCK_RECEIVED : DomainEventType.STOCK_ISSUED;
    const stockEvent = domainEventBus.createEvent(
      eventType,
      'Item',
      String(itemId),
      {
        itemId,
        itemCode: itemData.code,
        itemName: itemData.name,
        movementType: inOut,
        quantity: qty,
        unitPrice: price,
        warehouseLocation: finalTargetLoc,
        previousStock: oldTotalStock,
        newStock: newTotalStock,
        referenceDocType: documentType,
        referenceDocNumber: documentRef
      },
      { userName: user }
    );
    await OutboxService.saveToOutbox(tx, stockEvent);

    return { transactionId: insertedTx.id };
  }

  /**
   * V3.1.45 (TD-076): معکوس‌سازی متمرکز موجودی برای ابطال اسناد (DB-009) —
   * دوگانه انبار + WAC بازگشتی + bump نسخه OCC در یک نقطه تا invariantهای آینده یک‌جا اعمال شوند.
   */
  static async applyStockReversal(
    tx: DbClient,
    params: ApplyStockReversalParams
  ): Promise<void> {
    const { itemId, quantity: qty, originalDirection, unitPrice, location: targetLoc } = params;

    const [itemData] = await tx
      .select({ weightedAverageCost: items.weightedAverageCost, version: items.version })
      .from(items)
      .where(eq(items.id, itemId))
      .for('update');
    if (!itemData) return;
    const whInfo = await ItemWarehouseStockService.resolveWarehouse(tx, targetLoc);
    const revMovement: 'in' | 'out' = originalDirection === 'in' ? 'out' : 'in';

    // v7.0.45 (audit P2-1): موجودی کل قبل و بعد از جدول نرمال
    const before = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const oldTotalStock = before.total;

    // V7 Phase 4.1 (TD-165): به‌روزرسانی جدول رابطه‌ای نرمال‌سازی‌شده item_warehouse_stocks تحت قفل سطری
    await ItemWarehouseStockService.applyMovement(tx, {
      itemId,
      warehouse: whInfo,
      inOut: revMovement,
      quantity: qty,
    });

    const after = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const currentStocks = after.byCode;
    const newTotalStock = after.total;

    let newWAC = Number(itemData.weightedAverageCost || 0);
    if (originalDirection === 'in') {
      if (newTotalStock <= 0) {
        newWAC = Number(itemData.weightedAverageCost || 0);
      } else {
        const oldTotalVal = fin(oldTotalStock).multiply(newWAC);
        const revertVal = fin(qty).multiply(unitPrice);
        const remainingVal = oldTotalVal.subtract(revertVal);
        if (remainingVal.isNegative() || newTotalStock <= 0) {
          newWAC = Number(itemData.weightedAverageCost || 0);
        } else {
          newWAC = remainingVal.divide(newTotalStock).round(4).toNumber();
        }
      }
    }

    await tx
      .update(items)
      .set({
        stocks: currentStocks,
        currentStock: newTotalStock,
        weightedAverageCost: newWAC,
        version: nextVersion(itemData.version)
      })
      .where(eq(items.id, itemId));
  }

  /**
   * Reconciles and rebuilds inventory stocks directly from the transaction ledger (Event Sourcing).
   * V6.0.5: Unified with KardexWacRecalculatorService to eliminate divergence and preserve WAC.
   */
  static async reconcileAndRebuildStock(targetItemId?: number): Promise<{
    reconciledCount: number;
    discrepanciesFixed: number;
  }> {
    if (targetItemId) {
      const result = await KardexWacRecalculatorService.rebuildItemFromLedger(targetItemId);
      const isFixed = result.beforeStock !== result.afterStock || result.oldWac !== result.newWac;
      return {
        reconciledCount: 1,
        discrepanciesFixed: isFixed ? 1 : 0
      };
    }
    const rebuildSummary = await KardexWacRecalculatorService.rebuildAllFromLedger();
    return {
      reconciledCount: rebuildSummary.totalItemsChecked || rebuildSummary.rebuiltCount,
      discrepanciesFixed: rebuildSummary.discrepanciesFixed
    };
  }
}
