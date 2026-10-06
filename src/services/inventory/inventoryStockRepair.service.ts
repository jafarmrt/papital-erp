import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, items, transactions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { AppError, InsufficientStockError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { withOrderedLocks } from '../../lib/lockOrder.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { assertStockMovementDate } from './stockMovementDate.js';
import { DocumentRefNumberService } from '../documents/documentRefNumber.service.js';

/** نوع سند حواله انتقال بین انبارها (documents.type و transactions.document_type) */
export const TRANSFER_DOCUMENT_TYPE = 'transfer';

/** انبار فعال انتقال (کد، نام یا شناسه)؛ ناشناخته یا غیرفعال ۴۲۲ با نام طرف انتقال (v9.0.81، TD-494) */
async function resolveTransferWarehouse(tx: DbExecutor, raw: string, side: 'مبدأ' | 'مقصد') {
  try {
    return await ItemWarehouseStockService.resolveWarehouse(tx, raw);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 422) {
      throw new ValidationError(`انبار ${side} انتقال («${raw}») تعریف نشده یا غیرفعال است.`, { field: side === 'مبدأ' ? 'fromLocation' : 'toLocation', value: raw });
    }
    throw err;
  }
}

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
    /** شماره حواله دلخواه کاربر؛ خالی یا تکراری = شماره بعدی سری حواله انتقال (v9.0.80، TD-489) */
    refNumber?: string;
    createdBy?: string;
    user?: string;
    /** v8.0.4 (TD-257): کاربر مجوز «ثبت سند انبار با تاریخ گذشته» دارد (بررسی در مسیر) */
    allowBackdate?: boolean;
  }): Promise<{
    success: boolean;
    /** شناسه سند حواله انتقال (documents.id)؛ پیش از v9.0.80 شناسه ردیف خروج کاردکس بود */
    transferDocId: number;
    refNumber: string;
    quantity: number;
    fromLocation: string;
    toLocation: string;
    updatedStocks: Record<string, number>;
  }> {
    const qty = fin(params.quantity).toNumber();
    if (qty <= 0) {
      throw new ValidationError('مقدار انتقال باید بزرگتر از صفر باشد.');
    }
    if (params.fromLocation === params.toLocation) {
      throw new ValidationError('مبدأ و مقصد انتقال نمی‌توانند یکسان باشند.');
    }

    // v9.0.79 (TD-483): تاریخ شمسی یا میلادی به ISO؛ نامعتبر ۴۲۲ (پیش‌تر متن غیرتاریخ خطای ۵۰۰ پایگاه‌داده می‌داد)
    const txDate = params.date ? requireStorageDate(params.date, 'تاریخ انتقال') : await businessTodayIsoDate();
    const operatorName = params.user || params.createdBy || 'سیستم';

    return await orm.transaction(async (txEngine) => {
      await withOrderedLocks(txEngine, [
        { table: items, id: params.itemId, name: 'items' }
      ], async () => true);

      const [item] = await txEngine
        .select()
        .from(items)
        .where(and(eq(items.id, params.itemId), eq(items.isDeleted, 0)))
        .for('no key update'); // v8.0.67 (TD-320): هم‌حالت lockStockItems

      if (!item) {
        throw new NotFoundError(`کالا با شناسه ${params.itemId} یافت نشد.`);
      }

      // v9.0.81 (TD-494): انبار مبدأ و مقصد با resolver مشترک (کد یا نام، بی‌توجه به حروف بزرگ و کوچک، فقط انبار فعال)؛
      // ناشناخته ۴۲۲ و نه ۵۰۰. پیش‌تر فقط کد دقیق پذیرفته می‌شد و خطای کاری ۵۰۰ می‌داد.
      const fromWh = await resolveTransferWarehouse(txEngine, params.fromLocation, 'مبدأ');
      const toWh = await resolveTransferWarehouse(txEngine, params.toLocation, 'مقصد');
      if (fromWh.id === toWh.id) {
        throw new ValidationError(`مبدأ و مقصد انتقال یک انبار است («${fromWh.name || fromWh.code}»).`);
      }
      const before = await ItemWarehouseStockService.getStockSnapshot(txEngine, params.itemId);
      const currentFromQty = before.byCode[fromWh.code] ?? 0;

      if (currentFromQty < qty) {
        throw new InsufficientStockError(
          `موجودی انبار مبدأ («${fromWh.name || fromWh.code}») برای کالا کافی نیست. موجودی فعلی: ${currentFromQty}، درخواست: ${qty}`
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

      // v9.0.80 (TD-489، تصمیم ت۲ الف): هر انتقال یک سند «حواله انتقال» است — نوع transfer با شماره سری خودش (همان
      // قاعده شماره دستی و تکراری اسناد)، یک ردیف با بهای کاردکس و انبار مبدأ، و دو ردیف کاردکس با document_id؛ با
      // ابطال سند (deleteDocument) هر دو ردیف فقط از نظر مقدار برمی‌گردند. پیش‌تر دو ردیف کاردکس بی سند ثبت می‌شد و
      // شماره مرجع و توضیح فرم دور ریخته می‌شد. قفل‌ها: کالا (بالا) ← شمارنده شماره سند ← ردیف سند.
      const { refNumber, refFiscalYear } = await DocumentRefNumberService.assignDocumentRefNumber(
        txEngine, TRANSFER_DOCUMENT_TYPE, txDate, params.refNumber
      );
      const notes = params.notes?.trim() || `انتقال از «${fromWh.name || fromWh.code}» به «${toWh.name || toWh.code}»`;
      const [doc] = await txEngine.insert(documents).values({
        type: TRANSFER_DOCUMENT_TYPE,
        refNumber,
        refFiscalYear,
        date: txDate,
        user: operatorName,
        notes,
        status: 'final',
        currency: 'IRR',
        attachments: [],
        isDeleted: 0,
      }).returning({ id: documents.id });
      await txEngine.insert(documentItems).values({
        documentId: doc.id,
        itemId: params.itemId,
        quantity: qty,
        unitPrice: itemUnitPrice,
        discount: money(0),
        location: fromWh.code,
      });

      await txEngine.insert(transactions).values([
        {
          itemId: params.itemId,
          documentId: doc.id,
          type: 'out',
          quantity: qty,
          unitPrice: itemUnitPrice,
          totalPrice: itemTotalPrice,
          date: txDate,
          documentType: TRANSFER_DOCUMENT_TYPE,
          documentRef: refNumber,
          location: fromWh.code,
          notes,
          createdBy: operatorName,
          isDeleted: 0,
        },
        {
          itemId: params.itemId,
          documentId: doc.id,
          type: 'in',
          quantity: qty,
          unitPrice: itemUnitPrice,
          totalPrice: itemTotalPrice,
          date: txDate,
          documentType: TRANSFER_DOCUMENT_TYPE,
          documentRef: refNumber,
          location: toWh.code,
          notes,
          createdBy: operatorName,
          isDeleted: 0,
        },
      ]);

      return {
        success: true,
        transferDocId: doc.id,
        refNumber,
        quantity: qty,
        fromLocation: fromWh.code,
        toLocation: toWh.code,
        updatedStocks,
      };
    });
  }
}
