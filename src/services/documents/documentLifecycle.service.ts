import { terminateOpenWorkflows } from '../workflow/workflowTermination.js';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documents, documentItems, items, transactions, journalVouchers, productionProjects } from '../../db/schema.js';
import { businessNowIsoDateTime, businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { resolveDocumentVat } from './documentVat.js';
import { resolveDocumentExchangeRate, stockUnitPriceInIrr } from './documentExchangeRate.js';
import { netLineUnitPrice } from './purchaseLineCost.js';
import { assertReturnWithinSold, resolveSalesReturnUnitCosts } from './salesReturnCost.js';
import { enforceReturnInvoiceTerms } from './salesReturnPrice.js';
import { resolveReturnVatFromInvoice } from './salesReturnVat.js';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { resolveWarehouseCode } from '../inventory/warehouseResolver.js';
import { LockHierarchyLevel, sortIdsForLocking, withOrderedLocks } from '../../lib/lockOrder.js';
import { logger } from '../../middleware/logger.js';
import { logActivity } from '../../lib/auditLogger.js';
import { DocumentStockEngine } from './documentStockEngine.service.js';
import { money } from '../../lib/money.js';
import { releaseReservationsForDocument, restoreReservationsForDocument } from './projectReservationRelease.js';
import { assertVoidKeepsStockHistory } from '../inventory/voidStockHistory.js';
import { assertVoidHasNoReturns, assertVoidHasNoTreasuryRows } from './voidDependents.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { proformaInvoiceTarget } from './proformaInvoice.js';
import { assertNotProjectDelivery, stockDirectionOf } from './documentRecordRule.js';
import { assertOutflowWithinSellable } from './documentSellableGate.js';

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
    options?: { strict?: boolean; vatAmount?: number; vatPercent?: number; exchangeRate?: number; allowBackdate?: boolean }
  ): Promise<void> {
    const isStrict = options?.strict !== false;

    const execute = async (tx: DbExecutor): Promise<void> => {
      // Step 1: Pre-flight lookup & validation without holding locks
      const [docPeek] = await tx.select({
        id: documents.id,
        status: documents.status,
        type: documents.type,
        refNumber: documents.refNumber,
        projectId: documents.projectId,
      }).from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));

      if (!docPeek) throw new NotFoundError(`سند با شناسه ${id} یافت نشد`);
      if (docPeek.status === 'final') {
        logger.info({ message: `[DocumentLifecycleService.finalizeDocument] Document #${id} already finalized — skipping (concurrent call prevention)`, documentId: id });
        return;
      }
      // v8.0.3 (TD-263): انبارگردانی هنگام ثبت موجودی را اصلاح کرده است؛ نهایی‌سازی آن کل مقدار شمارش‌شده را
      // دوباره از انبار خارج می‌کرد. انبارگردانی پیش‌نویسِ پیش از v8.0.3 نهایی نمی‌شود (ابطال و ثبت دوباره).
      if (docPeek.type === 'audit') {
        throw new ValidationError(`سند انبارگردانی «${docPeek.refNumber || id}» نهایی‌سازی نمی‌شود؛ انبارگردانی هنگام ثبت اعمال شده است. برای اصلاح، آن را ابطال و دوباره ثبت کنید.`);
      }
      // v9.0.256 (TD-780، تصمیم ت۷ الف): رسید تولید پیش‌نویس (از پیش از این نسخه) قطعی نمی‌شود؛ تحویل فقط از مسیر پروژه
      assertNotProjectDelivery(docPeek.type, docPeek.refNumber || String(id));

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
          // v7.0.102 (TD-233): پروژه حواله خروج پیش از سند قفل می‌شود (کسر رزرو در همین تراکنش)
          ...(docPeek.projectId ? [{ table: productionProjects, id: Number(docPeek.projectId), level: LockHierarchyLevel.PRODUCTION, name: 'production_projects' }] : []),
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
          // v8.0.51 / v8.0.119 (TD-317 / TD-410، تصمیم مالک محصول): فاکتورِ حاصل از پیش‌فاکتور شماره بعدی سری فاکتور و
          // تاریخ روز نهایی‌سازی را می‌گیرد؛ شماره و تاریخ پیش‌فاکتور در یادداشت می‌ماند (proformaInvoice.ts)
          const isProformaToInvoice = doc.type === 'proforma';
          const proformaTarget = isProformaToInvoice ? await proformaInvoiceTarget(doc, tx) : null;
          const finalDate = proformaTarget?.date ?? doc.date;
          const finalRefNumber = proformaTarget?.refNumber ?? doc.refNumber;
          // v8.0.10 (TD-267): سند خرید (purchase) هم ورودی است، همان قاعده ثبت سند (documentCreation)
          const inOut = stockDirectionOf(targetType);

          // Pre-flight stock availability & reservation check for exit documents (TD-118). v9.0.239 (TD-775): جمع مقدار هر
          // (کالا، انبار)، موجودی و رزرو یک‌جا و fail-closed، همان تابع ثبت سند (documentSellableGate.ts)
          if (inOut === 'out') {
            await assertOutflowWithinSellable(tx, docLines, {
              excludeDocumentId: id,
              projectId: doc.projectId ? Number(doc.projectId) : null,
            });
          }

          // v9.0.246 (TD-788، تصمیم ت۱۰ الف): پیش‌نویس برگشتِ دارای فاکتور مرجع فقط با ارز، نرخ و قیمت خالص همان فاکتور نهایی
          // می‌شود؛ پیش‌نویس قدیمی که با آن نمی‌خواند ۴۲۲ می‌گیرد و باید ویرایش شود
          const returnTerms = targetType === 'return' && doc.returnOfDocumentId
            ? await enforceReturnInvoiceTerms(tx, Number(doc.returnOfDocumentId), {
              currency: doc.currency,
              rate: { exchangeRate: options?.exchangeRate ?? doc.exchangeRate?.toString() },
              lines: docLines.map(l => ({ itemId: l.itemId, quantity: l.quantity, unit_price: fin(l.unitPrice).toString(), discount: fin(l.discount).toString() })),
              stage: 'finalize',
            })
            : null;

          // v7.0.63 (TD-198): سند ارزی بدون نرخ تسعیر نهایی نمی‌شود (پیش از گردش انبار، چون قیمت ورود با آن به ریال می‌رود)؛ نرخ ارسالی روی خود سند ذخیره می‌شود
          const finalExchangeRate = resolveDocumentExchangeRate({
            currency: doc.currency,
            input: { exchangeRate: returnTerms ? returnTerms.exchangeRate : options?.exchangeRate },
            existing: doc.exchangeRate,
          });

          // Step 2: Inventory & Kardex Stock Movement (WAC preserved)
          // v7.0.81 (TD-230): برگشت از فروش با بهای خروج فاکتور اصلی (یا WAC جاری بدون فاکتور مرجع)، نه قیمت فروش
          // v8.0.8 (TD-253): نهایی‌سازی برگشت با فاکتور مرجع از مانده قابل برگشت همان فاکتور بیشتر نمی‌شود
          if (targetType === 'return' && doc.returnOfDocumentId) {
            await assertReturnWithinSold(tx, Number(doc.returnOfDocumentId), docLines);
          }
          const returnUnitCosts = targetType === 'return'
            ? await resolveSalesReturnUnitCosts(tx, doc.returnOfDocumentId ?? null, docLines.map(l => l.itemId))
            : null;
          for (const item of docLines) {
            const targetLoc = await resolveWarehouseCode(tx, item.location ? String(item.location).trim() : '');
            const qty = Number(item.quantity);
            // v7.0.69 (TD-227): قیمت سند ارزی با نرخ تسعیر سند به ریال تبدیل می‌شود (WAC ریالی است)
            // v8.0.9 (TD-250): ورود با قیمت خالص پس از تخفیف ردیف (همان مبلغ سند حسابداری خرید)
            const linePrice = inOut === 'in' ? netLineUnitPrice(item.unitPrice ?? 0, qty, item.discount) : (item.unitPrice ?? 0);
            const price = returnUnitCosts?.get(item.itemId) ?? stockUnitPriceInIrr(linePrice, doc.currency, finalExchangeRate);

            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: item.itemId,
              documentId: id,
              inOut,
              quantity: qty,
              price,
              date: finalDate,
              documentType: targetType,
              documentRef: finalRefNumber,
              user: user || doc.user || 'system',
              targetLoc,
              // v8.0.4 (TD-257): پیش‌نویسی که تاریخش از آخرین گردش کالا عقب‌تر است فقط با مجوز نهایی می‌شود
              allowBackdate: options?.allowBackdate === true,
            });
          }

          // v7.0.102 (TD-233): کسر رزرو پروژه حواله خروج در همان تراکنش نهایی‌سازی؛ خطا نهایی‌سازی را برمی‌گرداند
          if (inOut === 'out' && doc.projectId) {
            await releaseReservationsForDocument(tx, Number(doc.projectId), id, docLines, user || doc.user || undefined);
          }

          // Step 3: Document Status Commitment & Domain Event Outbox
          // v7.0.32 (TD-197 / audit P1-7): مالیاتی که هنگام نهایی‌سازی ارسال شود روی خود سند ذخیره می‌شود تا
          // فاکتور و سند حسابداری همیشه از یک مقدار (documents.vat_amount) استفاده کنند.
          // v9.0.247 (TD-774، تصمیم ت۵ الف): برگشتِ دارای فاکتور مرجع مالیات را زیر قفل فاکتور (assertReturnWithinSold) به نسبت
          // از مالیات همان فاکتور می‌گیرد، با برگشت‌های نهایی همین لحظه
          const vatInput = { vatPercent: options?.vatPercent, vatAmount: options?.vatAmount };
          const finalVat = targetType === 'return' && doc.returnOfDocumentId
            ? await resolveReturnVatFromInvoice(tx, {
              invoiceId: Number(doc.returnOfDocumentId), returnId: id, lines: docLines, input: vatInput, currency: doc.currency, stage: 'finalize',
            })
            : resolveDocumentVat({
              docType: targetType,
              input: vatInput,
              lines: docLines,
              existing: { vatPercent: Number(doc.vatPercent) || 0, vatAmount: doc.vatAmount },
              currency: doc.currency,
            });
          await tx.update(documents).set({ 
            status: 'final',
            type: targetType,
            ...(isProformaToInvoice ? {
              date: finalDate,
              refNumber: finalRefNumber,
              refFiscalYear: resolveJalaliFiscalYear(finalDate),
              notes: [doc.notes, proformaTarget?.note].filter(Boolean).join('\n'),
            } : {}),
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
                refNumber: finalRefNumber,
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
      const [peek] = await tx.select({ projectId: documents.projectId }).from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
      if (!peek) return;

      // v8.0.67 (TD-320): قفل‌ها به همان ترتیب نهایی‌سازی — کالاها (یک‌جا، به ترتیب شناسه) ← پروژه ← سند — و پیش از درج
      // ردیف کاردکس معکوس. پیش‌تر سند اول قفل می‌شد، ردیف معکوس درج می‌شد و کالاها به ترتیب ردیف‌های کاردکس قفل می‌شدند؛
      // دو ابطال هم‌کالا یا ابطال و فاکتوری با ترتیب دیگر کالاها به بن‌بست (40P01) می‌رسیدند.
      const kardexItems = await tx.select({ itemId: transactions.itemId }).from(transactions)
        .where(and(eq(transactions.documentId, id), eq(transactions.isDeleted, 0)));
      const lineItems = await tx.select({ itemId: documentItems.itemId }).from(documentItems)
        .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));
      await lockStockItems(tx, [...kardexItems, ...lineItems].map(r => r.itemId));
      // v7.0.105 (TD-237): پروژه پیش از سند قفل می‌شود (سلسله‌مراتب PRODUCTION → DOCUMENTS)، چون رزرو کسرشده حواله نهایی
      // در همین تراکنش برمی‌گردد؛ از v8.0.67 بی‌توجه به وضعیت پیش از قفل، چون نهایی‌سازی هم‌زمان می‌تواند آن را نهایی کند
      if (peek.projectId) {
        await tx.select({ id: productionProjects.id }).from(productionProjects)
          .where(eq(productionProjects.id, Number(peek.projectId)))
          .for('update');
      }

      const [doc] = await tx.select().from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)))
        .for('update');
      if (!doc) return;

      // v8.0.6 (TD-265، تصمیم مالک محصول): ابطال سند ورودی‌ای که موجودی‌اش با خروجِ تاریخ‌دار بعدی مصرف شده رد می‌شود
      // (پیش از هر نوشتن)؛ پیش‌تر فقط موجودی لحظه ابطال سنجیده می‌شد و کاردکس به ترتیب تاریخ منفی می‌ماند
      await assertVoidKeepsStockHistory(tx, { id: doc.id, refNumber: doc.refNumber });
      // v9.0.244 (TD-773، ت۴ الف): فاکتوری که برگشت ابطال‌نشده دارد باطل نمی‌شود (۴۰۹ با فهرست برگشت‌ها)
      await assertVoidHasNoReturns(tx, { id: doc.id, refNumber: doc.refNumber });
      // v9.0.245 (TD-779، ت۴ الف): و نه سندی که دریافت یا پرداخت زنده خزانه دارد (۴۰۹ با فهرست آن‌ها)
      await assertVoidHasNoTreasuryRows(tx, { id: doc.id, refNumber: doc.refNumber });

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

      // v9.0.40 (TD-447، ت۵): فرایند تأیید در جریان سند در همان تراکنش ابطال بسته می‌شود (سند پیش از نمونه قفل شده است)
      await terminateOpenWorkflows(tx, { entityType: 'document', entityId: id, actionKey: 'terminate', actionTitle: 'بستن فرایند با ابطال سند', comment: 'ابطال سند', userName: deletedByUser });

      // 2. Cascade soft-delete document_items
      await tx.update(documentItems).set({
        isDeleted: 1,
      }).where(eq(documentItems.documentId, id));

      // 3. Cascade soft-delete transactions + ثبت تراکنش‌های معکوس مطابق الگوی DB-009
      const originalTxs = await tx.select().from(transactions)
        .where(and(eq(transactions.documentId, doc.id), eq(transactions.isDeleted, 0)));
      // ردیف کاردکسی که پس از خواندن بالا (پیش از قفل سند) ثبت شده باشد هم پیش از درج معکوس قفل می‌شود (بی‌اثر اگر قفل باشد)
      await lockStockItems(tx, originalTxs.map(t => t.itemId));

      await tx.update(transactions).set({
        isDeleted: 1,
      }).where(eq(transactions.documentId, doc.id));

      // v9.0.110 (TD-482): a reversal of a row without a warehouse names the warehouse its stock comes back to (the
      // default one, as in step 4), never the ledger alias 'default' that a warehouse code could also be
      const unlocatedDefaultWh = originalTxs.some(t => !(t.location || '').trim()) ? await resolveWarehouseCode(tx, '') : '';
      for (const orig of originalTxs) {
        const origQty = Number(orig.quantity) || 0;
        if (origQty > 0) {
          await tx.insert(transactions).values({
            itemId: orig.itemId,
            documentId: doc.id,
            type: orig.type === 'in' ? 'out' : 'in',
            quantity: origQty,
            unitPrice: money(orig.unitPrice),
            totalPrice: money(orig.totalPrice),
            date: nowIso,
            documentType: orig.documentType || doc.type,
            documentRef: `REV-${orig.documentRef || doc.refNumber || id}`,
            createdBy: deletedByUser,
            notes: `تراکنش معکوس حذف سند ${doc.refNumber || id} (معکوس تراکنش #${orig.id})`,
            location: (orig.location || '').trim() ? orig.location : unlocatedDefaultWh,
            reversalOfId: orig.id,
            isDeleted: 0, // V9 (DB-009): تراکنش معکوس فعال جهت تراز کردن کاردکس و ثبت عطف معکوس
          });
        }
      }

      // 4. Revert stock for final documents
      // v8.0.3 (TD-263): انبارگردانی پیش‌نویسِ پیش از v8.0.3 هم موجودی را عوض کرده بود؛ ابطال آن گردش‌هایش را برمی‌گرداند
      // (پیش‌تر فقط کاردکس معکوس می‌شد و موجودی انبار با کاردکس ناهمخوان می‌ماند)
      if (doc.status === 'final' || (doc.type === 'audit' && originalTxs.length > 0)) {
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
                unitPrice: orig.unitPrice ?? 0,
                location: targetLoc,
                // v9.0.80 (TD-489): حواله انتقال بین انبارها فقط مقدار را جابه‌جا کرده بود؛ ابطالش هم WAC را تغییر نمی‌دهد
                quantityOnly: orig.documentType === 'transfer',
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
              // v7.0.69 (TD-227): سند قدیمی ارزی بدون نرخ با همان قیمت ثبت‌شده برگردانده می‌شود
              // v8.0.11 (TD-254): خروجِ سند قدیمی بی‌ردیف کاردکس بهای ثبت‌شده ندارد (قیمت ردیف قیمت فروش است)؛ با بهای صفر
              // برمی‌گردد تا WAC مثل قبل بی‌تغییر بماند
              unitPrice: docDirection === 'out' ? 0
                : (fin(doc.exchangeRate).isPositive() ? stockUnitPriceInIrr(item.unitPrice ?? 0, doc.currency, doc.exchangeRate) : (item.unitPrice ?? 0)),
              location: targetLoc
            });
          }
        }

        // v7.0.105 (TD-237، تصمیم «برگردد»): رزرو پروژه‌ای که همین حواله کسر کرده بود دوباره برای همان پروژه رزرو می‌شود
        await restoreReservationsForDocument(tx, id, deletedByUser);

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

        // v8.0.2 (TD-251، تصمیم مالک محصول): سند حسابداری پیش‌نویس حذف نرم می‌شود؛ تأییدشده یا دائم سند معکوس می‌گیرد
        for (const lv of linkedVouchers) {
          await VoucherService.voidSourceVoucher({
            voucherId: lv.id,
            date: await businessTodayIsoDate(),
            reason: `حذف سند انبار شماره ${doc.refNumber || id} (${doc.type || ''})`,
            username: deletedByUser,
            externalTx: tx,
          });
        }
      }

      // 5. Audit log — v8.0.77 (TD-324): در همان تراکنش (پیش‌تر اتصال دوم استخر و ردیف ممیزی ماندگار حتی با برگشت ابطال)
      await logActivity({
        tx,
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
