import { eq } from 'drizzle-orm';
import { items, transactions } from '../../db/schema.js';
import { normalizeDateToDbTimestamp } from '../../utils.js';
import { fin, FinancialMath, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
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
  /** v7.0.68 (P2-6): Money/Decimal بدون عبور از double پذیرفته می‌شود */
  price: DecimalValue;
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
  unitPrice: DecimalValue;
  location: string;
}

/** نوع سند انبارگردانی و اصلاح موجودی (شمارش، ورود اکسل، موجودی اولیه و افتتاحیه) در کاردکس */
export const STOCK_COUNT_DOCUMENT_TYPE = 'audit';

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
    const priceDec = fin(price);

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

    const currentItemWac = fin(itemData.weightedAverageCost);
    // P1-02 (H-01, F2 & INV-01): ثبت بهای تمام‌شده تاریخی خروج در تراکنش انبار جهت حفظ انضباط دفاتر دوبل
    // v7.0.46 (audit P2-4، تصمیم مالک محصول): پیش‌تر برای کالای بدون بهای تمام‌شده (WAC صفر) قیمت سند (قیمت فروش)
    // به‌عنوان بهای تمام‌شده خروج ثبت می‌شد و سود ناخالص صفر نشان داده می‌شد. اکنون خروج چنین کالایی رد می‌شود،
    // جز کسری انبارگردانی و کاهش موجودی از ورود اکسل (documentType = 'audit') که با بهای صفر ثبت می‌شوند تا
    // اصلاح شمارش قفل نشود.
    let txUnitPrice: FinancialDecimal = priceDec;
    if (inOut === 'out') {
      if (currentItemWac.isPositive()) {
        txUnitPrice = currentItemWac;
      } else if (documentType === STOCK_COUNT_DOCUMENT_TYPE) {
        txUnitPrice = fin(0);
      } else {
        throw new ValidationError(
          `کالای «${itemData.name}» (${itemData.code}) هنوز بهای تمام‌شده ندارد و خروج آن ثبت نمی‌شود. ` +
          'ابتدا رسید یا خرید این کالا را با قیمت ثبت کنید یا بهای تمام‌شده اولیه آن را در تعریف کالا وارد کنید.'
        );
      }
    }
    const txTotalPrice = txUnitPrice.multiply(qty).round(4);

    const [insertedTx] = await tx.insert(transactions).values({
      itemId,
      documentId: documentId ?? undefined,
      type: inOut,
      quantity: qty,
      unitPrice: money(txUnitPrice),
      totalPrice: money(txTotalPrice),
      date: normalizedTxDate,
      documentType,
      documentRef: String(documentRef),
      createdBy: user,
      notes: notes || (inOut === 'out' && !priceDec.equals(txUnitPrice) && priceDec.isPositive() ? `قیمت فروش: ${priceDec.toString()}` : ''),
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

    // v7.0.45 (audit P2-1): موجودی کل فقط از جدول نرمال؛ پیش‌تر از جمع کلیدهای JSONB حساب می‌شد
    const after = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const newTotalStock = after.total;

    let newWAC = currentItemWac;
    if (inOut === 'in') {
      newWAC = FinancialMath.calculateWAC(oldTotalStock, newWAC, qty, priceDec);
    }

    await tx
      .update(items)
      .set({
        // v7.0.48 (TD-214): current_stock را تریگر پایگاه‌داده از item_warehouse_stocks می‌نویسد
        weightedAverageCost: money(newWAC),
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
        unitPrice: priceDec.toNumber(),
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
    const newTotalStock = after.total;

    const oldWAC = fin(itemData.weightedAverageCost);
    let newWAC = oldWAC;
    if (originalDirection === 'in' && newTotalStock > 0) {
      const oldTotalVal = fin(oldTotalStock).multiply(oldWAC);
      const revertVal = fin(qty).multiply(unitPrice);
      const remainingVal = oldTotalVal.subtract(revertVal);
      if (!remainingVal.isNegative()) {
        newWAC = remainingVal.divide(newTotalStock).round(4);
      }
    }

    await tx
      .update(items)
      .set({
        // v7.0.48 (TD-214): current_stock را تریگر پایگاه‌داده از item_warehouse_stocks می‌نویسد
        weightedAverageCost: money(newWAC),
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
