import { eq, and, inArray, isNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documents, documentItems, items, transactions, journalVouchers } from '../../db/schema.js';
import { businessNowIsoDateTime, businessTodayIsoDate } from '../../lib/businessClock.js';
import { resolveDocumentVat } from './documentVat.js';
import { resolveDocumentExchangeRate } from './documentExchangeRate.js';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { NotFoundError, ValidationError, InsufficientStockError } from '../../errors/customErrors.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { resolveWarehouseCode } from '../inventory/warehouseResolver.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { LockHierarchyLevel, sortIdsForLocking, withOrderedLocks } from '../../lib/lockOrder.js';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { DocumentStockEngine } from './documentStockEngine.service.js';

export class DocumentLifecycleService {
  /**
   * Finalizes a draft or proforma document in a strict 4-step atomic orchestration:
   * 1. Pre-flight validation & hierarchical row-level locking (ITEMS_STOCK: 40 -> DOCUMENTS: 60)
   * 2. Inventory & Kardex Stock Movement (WAC preserved via applyStockMovement)
   * 3. Document status commitment (draft/proforma -> final) & Domain Event outbox
   * 4. Double-entry accounting voucher generation (strict mode by default, Rule DB-008)
   *
   * If any step fails (e.g. insufficient inventory or accounting error), the entire
   * transaction rolls back and the document status remains unchanged.
   */
  static async finalizeDocument(
    id: number,
    user?: string,
    externalTx?: DbExecutor,
    options?: { strict?: boolean; vatAmount?: number; vatPercent?: number; exchangeRate?: number }
  ): Promise<void> {
    const isStrict = options?.strict !== false;

    const execute = async (tx: DbExecutor): Promise<void> => {
      // Step 1: Pre-flight lookup & validation without holding locks
      const [docPeek] = await tx.select({
        id: documents.id,
        status: documents.status,
        type: documents.type,
        refNumber: documents.refNumber,
      }).from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));

      if (!docPeek) {
        throw new NotFoundError(`سند با شناسه ${id} یافت نشد`);
      }
      if (docPeek.status === 'final') {
        logger.info({ message: `[DocumentLifecycleService.finalizeDocument] Document #${id} already finalized — skipping (concurrent call prevention)`, documentId: id });
        return;
      }

      // Pre-flight: verify line items existence and validity
      const rawLines = await tx.select({
        id: documentItems.id,
        itemId: documentItems.itemId,
        quantity: documentItems.quantity,
        unitPrice: documentItems.unitPrice,
        location: documentItems.location,
      }).from(documentItems)
        .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));

      if (!rawLines || rawLines.length === 0) {
        throw new ValidationError(`سند شماره «${docPeek.refNumber || id}» فاقد هرگونه قلم کالا برای نهایی‌سازی است.`);
      }

      for (const item of rawLines) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ValidationError(`مقدار قلم کالا (شناسه ${item.itemId}) در سند شماره «${docPeek.refNumber || id}» باید عددی بزرگ‌تر از صفر باشد.`);
        }
        const price = Number(item.unitPrice || 0);
        if (!Number.isFinite(price) || price < 0) {
          throw new ValidationError(`قیمت واحد قلم کالا (شناسه ${item.itemId}) در سند شماره «${docPeek.refNumber || id}» نمی‌تواند منفی باشد.`);
        }
      }

      // V6 Sub-phase 5.1 (TD-159): Enforce strict LockHierarchyLevel (ITEMS_STOCK: 40 -> DOCUMENTS: 60)
      // Sort item IDs in ascending order to prevent deadlocks when concurrent documents share items
      const sortedItemIds = sortIdsForLocking(rawLines.map(line => line.itemId));

      // Acquire ordered locks strictly: Items (Level 40) -> Documents (Level 60)
      await withOrderedLocks(
        tx,
        [
          { table: items, ids: sortedItemIds, level: LockHierarchyLevel.ITEMS_STOCK, name: 'items' },
          { table: documents, id, level: LockHierarchyLevel.DOCUMENTS, name: 'documents' }
        ],
        async () => {
          // Re-fetch document with locks held
          const [doc] = await tx.select().from(documents)
            .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));

          if (!doc) {
            throw new NotFoundError(`سند با شناسه ${id} یافت نشد`);
          }
          if (doc.status === 'final') {
            logger.info({ message: `[DocumentLifecycleService.finalizeDocument] Document #${id} already finalized — skipping (concurrent call prevention)`, documentId: id });
            return;
          }

          const docLines = await tx.select().from(documentItems)
            .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));

          const targetType = doc.type === 'proforma' ? 'invoice' : doc.type;
          const inOut: 'in' | 'out' = (targetType === 'receipt' || targetType === 'production_receipt' || targetType === 'return') ? 'in' : 'out';

          // Pre-flight stock availability & reservation check for exit documents (TD-118)
          if (inOut === 'out') {
            const reservationReport = await ItemStockReservationService.getReservedStockDetails(tx);
            for (const item of docLines) {
              const qty = fin(item.quantity).toNumber();
              const targetLoc = await resolveWarehouseCode(tx, item.location ? String(item.location).trim() : '');

              const [dbItem] = await tx.select({
                id: items.id,
                code: items.code,
                name: items.name,
                unit: items.unit,
                currentStock: items.currentStock,
              }).from(items).where(eq(items.id, item.itemId)).for('update');

              if (!dbItem) {
                throw new NotFoundError(`کالا با شناسه ${item.itemId} یافت نشد`);
              }

              const summary = reservationReport.itemSummaries.find(s => s.itemId === item.itemId);
              // v7.0.45 (audit P2-1): موجودی انبارها از جدول نرمال (منبع حقیقت)، نه کش JSONB
              const tableStock = await ItemWarehouseStockService.getStockSnapshot(tx, item.itemId);
              const sellableInfo = ItemStockReservationService.computeSellable(
                summary,
                tableStock.byCode,
                {
                  location: targetLoc,
                  excludeDocumentId: id,
                  projectId: doc.projectId ? Number(doc.projectId) : null,
                }
              );

              if (qty > sellableInfo.sellable) {
                throw new InsufficientStockError(
                  `امکان خروج بیش از ${sellableInfo.sellable} ${dbItem.unit || 'عدد'} برای کالا «${dbItem.name}» (${dbItem.code}) وجود ندارد. موجودی انبار «${targetLoc}»: ${sellableInfo.locationStock}، رزرو سایر مصارف: ${sellableInfo.reservedForOthers}، قابل فروش: ${sellableInfo.sellable}.`
                );
              }
            }
          }

          // Step 2: Inventory & Kardex Stock Movement (WAC preserved)
          for (const item of docLines) {
            const targetLoc = await resolveWarehouseCode(tx, item.location ? String(item.location).trim() : '');
            const qty = Number(item.quantity);
            const price = Number(item.unitPrice || 0);

            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: item.itemId,
              documentId: id,
              inOut,
              quantity: qty,
              price,
              date: doc.date,
              documentType: targetType,
              documentRef: doc.refNumber,
              user: user || doc.user || 'system',
              targetLoc,
            });
          }

          // Step 3: Document Status Commitment & Domain Event Outbox
          // v7.0.32 (TD-197 / audit P1-7): مالیاتی که هنگام نهایی‌سازی ارسال شود روی خود سند ذخیره می‌شود تا
          // فاکتور و سند حسابداری همیشه از یک مقدار (documents.vat_amount) استفاده کنند.
          const finalVat = resolveDocumentVat({
            docType: targetType,
            input: { vatPercent: options?.vatPercent, vatAmount: options?.vatAmount },
            lines: docLines,
            existing: { vatPercent: Number(doc.vatPercent) || 0, vatAmount: Number(doc.vatAmount) || 0 },
          });
          // v7.0.63 (TD-198): سند ارزی بدون نرخ تسعیر نهایی نمی‌شود؛ نرخ ارسالی روی خود سند ذخیره می‌شود
          const finalExchangeRate = resolveDocumentExchangeRate({
            currency: doc.currency,
            input: { exchangeRate: options?.exchangeRate },
            existing: doc.exchangeRate,
          });
          await tx.update(documents).set({ 
            status: 'final',
            type: targetType,
            vatPercent: finalVat.vatPercent,
            vatAmount: finalVat.vatAmount,
            exchangeRate: finalExchangeRate,
            version: nextVersion(doc.version)
          }).where(eq(documents.id, id));

          const isSales = targetType === 'invoice' || targetType === 'proforma';
          const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(targetType);
          const safeUser = user || doc.user || 'system';

          if (isSales) {
            const invEvent = domainEventBus.createEvent(
              DomainEventType.INVOICE_APPROVED,
              'Document',
              String(id),
              {
                documentId: id,
                refNumber: doc.refNumber,
                docType: targetType,
                buyerName: doc.buyerName || '',
                currency: doc.currency || 'IRR',
                itemCount: docLines.length,
                status: 'final'
              },
              { userName: safeUser }
            );
            await OutboxService.saveToOutbox(tx, invEvent);
          } else if (isPurchase) {
            const purchEvent = domainEventBus.createEvent(
              DomainEventType.PURCHASE_APPROVED,
              'Document',
              String(id),
              {
                documentId: id,
                refNumber: doc.refNumber,
                supplierName: doc.buyerName || '',
                currency: doc.currency || 'IRR',
                itemCount: docLines.length,
                status: 'final'
              },
              { userName: safeUser }
            );
            await OutboxService.saveToOutbox(tx, purchEvent);
          }

          // Step 4: Auto-generate double-entry accounting voucher (Rule DB-008, Strict Mode)
          if (isSales) {
            await VoucherSyncService.syncSalesInvoiceVoucher(id, {
              username: safeUser,
              strict: isStrict,
              exchangeRate: options?.exchangeRate,
            }, tx);
          } else if (isPurchase) {
            await VoucherSyncService.syncPurchaseInvoiceVoucher(id, {
              username: safeUser,
              strict: isStrict,
            }, tx);
          } else if (['remittance', 'waste', 'return'].includes(targetType)) {
            await VoucherSyncService.syncWarehouseDocumentVoucher(id, {
              username: safeUser,
              strict: isStrict,
            }, tx);
          }
        }
      );
    };

    if (externalTx) {
      await execute(externalTx);
    } else {
      await orm.transaction(execute);
    }
  }

  /**
   * Soft deletes a document and performs a cascade soft-delete on associated documentItems and transactions,
   * reverting any finalized inventory changes and recording audit logs.
   */
  static async deleteDocument(id: number, user?: string, externalTx?: DbExecutor): Promise<void> {
    const execute = async (tx: DbExecutor): Promise<void> => {
      const [doc] = await tx.select().from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)))
        .for('update');
      if (!doc) return;

      const deletedByUser = user || doc.user || 'system';
      // V10-1.1: زمان حذف/برگشت‌ها از ساعت توافقی (بدون Z تا مقایسه لغوی ستون date سازگار بماند)
      const nowIso = await businessNowIsoDateTime();

      // Fetch active document items before soft-deleting
      const docLines = await tx.select().from(documentItems).where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));

      // 1. Soft-delete document with deletedAt & deletedBy
      await tx.update(documents).set({
        isDeleted: 1,
        deletedAt: nowIso,
        deletedBy: deletedByUser,
      }).where(eq(documents.id, id));

      // 2. Cascade soft-delete document_items
      await tx.update(documentItems).set({
        isDeleted: 1,
      }).where(eq(documentItems.documentId, id));

      // 3. Cascade soft-delete transactions + ثبت تراکنش‌های معکوس مطابق الگوی DB-009
      const originalTxs = await tx.select().from(transactions)
        .where(and(eq(transactions.documentId, doc.id), eq(transactions.isDeleted, 0)));

      await tx.update(transactions).set({
        isDeleted: 1,
      }).where(eq(transactions.documentId, doc.id));

      for (const orig of originalTxs) {
        const origQty = Number(orig.quantity) || 0;
        if (origQty > 0) {
          await tx.insert(transactions).values({
            itemId: orig.itemId,
            documentId: doc.id,
            type: orig.type === 'in' ? 'out' : 'in',
            quantity: origQty,
            unitPrice: Number(orig.unitPrice) || 0,
            totalPrice: Number(orig.totalPrice) || 0,
            date: nowIso,
            documentType: orig.documentType || doc.type,
            documentRef: `REV-${orig.documentRef || doc.refNumber || id}`,
            createdBy: deletedByUser,
            notes: `تراکنش معکوس حذف سند ${doc.refNumber || id} (معکوس تراکنش #${orig.id})`,
            location: orig.location || 'default',
            reversalOfId: orig.id,
            isDeleted: 0, // V9 (DB-009): تراکنش معکوس فعال جهت تراز کردن کاردکس و ثبت عطف معکوس
          });
        }
      }

      // 4. Revert stock for final documents
      if (doc.status === 'final') {
        const defaultWh = await resolveWarehouseCode(tx, '');

        // C-01 & F3: موجودی انبار منحصراً بر اساس گردش واقعی تراکنش‌های ثبت‌شده (originalTxs) معکوس می‌شود؛
        // در اسناد انبارگردانی فقط انحراف (variance) ثبت شده بود و نباید کل physical_stock برگشت داده شود.
        if (originalTxs.length > 0) {
          for (const orig of originalTxs) {
            const origQty = Number(orig.quantity) || 0;
            if (origQty > 0) {
              const targetLoc = (orig.location || '').trim() || defaultWh;
              await DocumentStockEngine.applyStockReversal(tx, {
                itemId: orig.itemId,
                quantity: origQty,
                originalDirection: orig.type as 'in' | 'out',
                unitPrice: Number(orig.unitPrice || 0),
                location: targetLoc
              });
            }
          }
        } else if (doc.type !== 'audit') {
          const docDirection: 'in' | 'out' = (doc.type === 'receipt' || doc.type === 'production_receipt' || doc.type === 'return') ? 'in' : 'out';
          for (const item of docLines) {
            const targetLoc = (item.location || '').trim() || defaultWh;
            await DocumentStockEngine.applyStockReversal(tx, {
              itemId: item.itemId,
              quantity: item.quantity,
              originalDirection: docDirection,
              unitPrice: Number(item.unitPrice || 0),
              location: targetLoc
            });
          }
        }

        // V9-1.1 & V6.0.5: برگشت اسناد حسابداری متناظر (صدور سند معکوس) در همان تراکنش برای کلیه انواع اسناد
        // v7.0.31 (TD-193 / audit P1-8): سند حسابداری اصلی از پیوند صریح source_document_id؛ اسناد تکراری قدیمی
        // بدون پیوند (هم‌شماره با سند) نیز معکوس می‌شوند مگر حسابدار قبلاً معکوسشان کرده باشد. اسناد معکوس/اصلاحی که
        // reference_id آن‌ها شناسه «سند حسابداری مبدأ» است دیگر به‌اشتباه به‌عنوان سند این فاکتور انتخاب نمی‌شوند.
        const primaryVouchers = await tx.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber })
          .from(journalVouchers)
          .where(and(eq(journalVouchers.sourceDocumentId, id), eq(journalVouchers.isDeleted, 0)));
        const legacyVouchers = await tx.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber })
          .from(journalVouchers)
          .where(and(
            inArray(journalVouchers.referenceModule, ['invoice', 'purchase', 'inventory', 'warehouse', 'document', 'production']),
            eq(journalVouchers.referenceId, id),
            eq(journalVouchers.referenceNumber, doc.refNumber),
            isNull(journalVouchers.sourceDocumentId),
            eq(journalVouchers.isDeleted, 0)
          ));
        const linkedVouchers = [...primaryVouchers];
        for (const lv of legacyVouchers) {
          const [alreadyReversed] = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
            .where(and(
              eq(journalVouchers.referenceId, lv.id),
              eq(journalVouchers.referenceNumber, `REV-V${lv.voucherNumber}`),
              eq(journalVouchers.isDeleted, 0)
            ));
          if (!alreadyReversed) linkedVouchers.push(lv);
        }

        for (const lv of linkedVouchers) {
          await VoucherService.reverseVoucher({
            voucherId: lv.id,
            date: await businessTodayIsoDate(),
            reason: `حذف سند انبار شماره ${doc.refNumber || id} (${doc.type || ''})`,
            username: deletedByUser,
            externalTx: tx,
          });
        }
      }

      // 5. Audit log
      await logActivity({
        username: deletedByUser,
        action: 'DELETE',
        entity: 'اسناد انبار',
        entityId: id,
        description: `حذف (Soft-Delete Cascade) سند انبار شماره "${doc.refNumber || id}" (نوع: ${doc.type || ''})`,
        details: {
          documentId: id,
          refNumber: doc.refNumber,
          docType: doc.type,
          deletedAt: nowIso,
          deletedBy: deletedByUser
        }
      });
    };

    if (externalTx) {
      await execute(externalTx);
    } else {
      await orm.transaction(execute);
    }
  }
}
