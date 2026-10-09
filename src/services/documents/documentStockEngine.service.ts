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
import { assertStockMovementDate } from '../inventory/stockMovementDate.js';
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
  /**
   * v8.0.4 (TD-257): کاربر مجوز «ثبت سند انبار با تاریخ گذشته» (`warehouse.backdate`) دارد. فقط مسیرهایی که مجوز
   * کاربر را بررسی کرده‌اند true می‌دهند؛ هرگز از بدنه درخواست خوانده نمی‌شود.
   */
  allowBackdate?: boolean;
}

export interface ApplyStockReversalParams {
  itemId: number;
  quantity: number;
  originalDirection: 'in' | 'out';
  unitPrice: DecimalValue;
  location: string;
  /** v9.0.80 (TD-489): ردیف حواله انتقال بین انبارها فقط مقدار را برمی‌گرداند و WAC را تغییر نمی‌دهد (مثل ثبت آن) */
  quantityOnly?: boolean;
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
    const { itemId, documentId, inOut, quantity, price, date, documentType, documentRef, user, targetLoc, notes, allowBackdate } = params;
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
      .for('no key update'); // v8.0.67 (TD-320): هم‌حالت lockStockItems، بی ارتقای قفل

    if (!itemData) {
      throw new NotFoundError(`کالای مورد نظر با شناسه ${itemId} در سیستم یافت نشد.`);
    }

    // v7.0.45 (audit P2-1): موجودی پیش از حرکت از جدول نرمال (منبع حقیقت)، نه از کش JSONB
    const before = await ItemWarehouseStockService.getStockSnapshot(tx, itemId);
    const oldTotalStock = before.total;

    const normalizedTxDate = normalizeDateToDbTimestamp(date);

    // v8.0.4 (TD-257): تاریخ گردش نه پیش از آخرین گردش همین کالا، مگر با مجوز و موجودی کافی تا آن تاریخ و پس از آن
    await assertStockMovementDate(tx, {
      itemId,
      itemLabel: `«${itemData.name}» (${itemData.code})`,
      date: normalizedTxDate,
      inOut,
      quantity: qty,
      warehouseId: whInfo.id,
      warehouseCode: whInfo.code,
      allowBackdate,
    });

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
    } else if (!priceDec.isPositive() && currentItemWac.isPositive()) {
      // v8.0.12 (TD-256): ورود با قیمت صفر WAC را تغییر نمی‌دهد (calculateWAC، TD-135)، یعنی کالا به WAC جاری ارزش‌گذاری
      // می‌شود؛ ردیف کاردکس همان بها را ثبت می‌کند تا ابطال (applyStockReversal) و بازسازی کاردکس همان ارزش را برگردانند.
      // پیش‌تر ردیف با قیمت صفر ثبت می‌شد و ابطال آن WAC را بالا می‌برد و ارزش انبار از دفتر کل جدا می‌شد.
      txUnitPrice = currentItemWac;
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
    const { itemId, quantity: qty, originalDirection, unitPrice, location: targetLoc, quantityOnly } = params;

    const [itemData] = await tx
      .select({ weightedAverageCost: items.weightedAverageCost, version: items.version })
      .from(items)
      .where(eq(items.id, itemId))
      .for('no key update'); // v8.0.67 (TD-320): هم‌حالت lockStockItems، بی ارتقای قفل
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
    if (quantityOnly) {
      // v9.0.80 (TD-489): ابطال حواله انتقال — همان قاعده بازپخش کاردکس (replayKardexWac)
    } else if (originalDirection === 'in' && newTotalStock > 0) {
      const oldTotalVal = fin(oldTotalStock).multiply(oldWAC);
      const revertVal = fin(qty).multiply(unitPrice);
      const remainingVal = oldTotalVal.subtract(revertVal);
      if (!remainingVal.isNegative()) {
        newWAC = remainingVal.divide(newTotalStock).round(4);
      }
    } else if (originalDirection === 'out') {
      // v8.0.11 (TD-254): کالای خروجِ ابطال‌شده با بهای کاردکس همان خروج برمی‌گردد و WAC بازمحاسبه می‌شود (همان قاعده
      // ورود و برگشت از فروش TD-230)؛ سند معکوس هم همان بها را برمی‌گرداند. پیش‌تر WAC بی‌تغییر می‌ماند و کالا با WAC
      // جاری برمی‌گشت، پس پس از تغییر WAC ارزش انبار از دفتر کل جدا می‌شد. بهای صفر (بی‌بها) WAC را تغییر نمی‌دهد.
      newWAC = FinancialMath.calculateWAC(oldTotalStock, oldWAC, qty, unitPrice);
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
}
