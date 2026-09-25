import { sql, eq, and, desc, inArray, gte, lte, or, ilike } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { documents, documentItems, items, transactions, appSettings, documentRefCounters, journalVouchers, treasuryTransactions, productionProjects } from '../db/schema.js';
import { roundFinancial, getTodayJalaliDate, normalizeDateToDbTimestamp } from '../utils.js';
import { resolveJalaliFiscalYear, businessNowIsoDateTime, businessTodayIsoDate } from '../lib/businessClock.js';
import { fin, FinancialMath } from '../lib/financialDecimal.js';
import { checkOccVersion, nextVersion } from '../lib/occHelper.js';
import { MAX_PAGE_LIMIT } from '../lib/pagination.js';
import { NotFoundError, ValidationError, InsufficientStockError } from '../errors/customErrors.js';
import { domainEventBus } from './events/domainEventBus.js';
import { DomainEventType } from './events/domainEvents.js';
import { OutboxService } from './events/outboxService.js';
import { VoucherSyncService } from './accounting/voucherSync.service.js';
import { VoucherService } from './accounting/voucher.service.js';
import { NegativeStockPolicyService } from './inventory/negativeStockPolicy.service.js';
import { resolveWarehouseCode } from './inventory/warehouseResolver.js';
import { ItemStockReservationService } from './items/itemStockReservation.service.js';
import { logger } from '../middleware/logger.js';
import { logActivity } from '../lib/auditLogger.js';

export type DbClient = DbExecutor;

export interface GetDocumentsFilter {
  type?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  offset?: number;
  isExport?: boolean;
  projectId?: number | string;
}

export interface DocumentLineItemInput {
  itemId: number | string;
  quantity: number | string;
  unit_price?: number;
  unitPrice?: number;
  price?: number;
  discount?: number;
  location?: string;
  targetLoc?: string;
  physical_stock?: number;
  unit?: string;
  system_stock?: number;
}

export interface CreateDocumentInput {
  docType?: string;
  type?: string;
  refNumber?: string;
  date?: string;
  items: DocumentLineItemInput[];
  user?: string;
  inOut?: 'in' | 'out';
  buyer_name?: string;
  buyerName?: string;
  buyer_city?: string;
  buyerCity?: string;
  buyer_phone?: string;
  buyerPhone?: string;
  buyer_address?: string;
  buyerAddress?: string;
  status?: string;
  notes?: string;
  location?: string;
  currency?: string;
  skipVoucherSync?: boolean;
  strict?: boolean;
  externalTx?: DbClient;
  vat_percent?: number;
  vatPercent?: number;
  vat_amount?: number;
  vatAmount?: number;
  attachments?: any[];
  projectId?: number | string | null;
  project_id?: number | string | null;
}

export interface UpdateDocumentInput {
  refNumber?: string;
  date?: string;
  user?: string;
  buyer_name?: string;
  buyerName?: string;
  buyer_city?: string;
  buyerCity?: string;
  buyer_phone?: string;
  buyerPhone?: string;
  buyer_address?: string;
  buyerAddress?: string;
  status?: string;
  notes?: string;
  location?: string;
  currency?: string;
  attachments?: any[];
  items?: DocumentLineItemInput[];
  expectedVersion?: number;
  version?: number;
}

export interface FormattedDocumentItem {
  document_id: number;
  item_id: number;
  quantity: number;
  unit_price: number;
  unitPrice?: number;
  discount: number;
  location: string;
  name: string | null;
  item_name?: string | null;
  itemName?: string | null;
  code: string | null;
  unit: string | null;
  category: string | null;
  variance?: number;
  system_stock?: number;
}

export interface FormattedDocument {
  id: number;
  refNumber: string;
  ref_number: string;
  type: string;
  date: string;
  user: string;
  status: string;
  notes: string | null;
  buyerName: string | null;
  buyer_name: string | null;
  buyerCity: string | null;
  buyer_city: string | null;
  buyerPhone: string | null;
  buyer_phone: string | null;
  buyerAddress: string | null;
  buyer_address: string | null;
  currency: string;
  version: number;
  isDeleted: number;
  projectId?: number | null;
  project_id?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedBy?: string | null;
  itemsCount: number;
  totalQuantity: number;
  totalAmount: number;
  total_amount?: number;
  totalDiscount: number;
  grossAmount: number;
  paidAmount?: number;
  remainingAmount?: number;
  settlementStatus?: 'unpaid' | 'partially_paid' | 'fully_paid';
  settlements?: Array<{
    id: number;
    transactionNumber: string;
    type: string;
    method: string;
    amount: number;
    date: string;
    status: string;
    trackingNumber?: string | null;
    bankAccountId?: number | null;
    description?: string | null;
  }>;
  items: FormattedDocumentItem[];
}

export interface PaginatedDocumentsResult {
  data: FormattedDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class DocumentService {
  /**
   * Updates the notes of a specific document.
   */
  static async updateDocumentNotes(id: number, notes: string): Promise<void> {
    await orm.update(documents).set({ notes }).where(eq(documents.id, id));
  }

  /**
   * Updates an existing document (proforma or draft) and its line items.
   */
  static async updateDocument(id: number, body: UpdateDocumentInput): Promise<void> {
    const { 
      refNumber, date, user,
      buyer_name, buyer_city, buyer_phone, buyer_address,
      status, notes, location, currency, items: docLines
    } = body;

    const [existingDoc] = await orm.select().from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
    if (!existingDoc) {
      throw new NotFoundError('سند مورد نظر یافت نشد.');
    }

    if (existingDoc.status === 'final') {
      throw new ValidationError('امکان ویرایش مستقیم سند نهایی‌شده وجود ندارد.');
    }

    if (status === 'final') {
      throw new ValidationError(
        'نهایی‌سازی سند از مسیر ویرایش مجاز نیست؛ عملیات نهایی‌سازی باید از مسیر «نهایی‌سازی و تایید» انجام شود تا کسر موجودی انبار، صدور سند حسابداری و گردش کار به‌درستی اجرا گردند.'
      );
    }

    if (body.expectedVersion !== undefined || body.version !== undefined) {
      checkOccVersion(existingDoc, {
        entityType: 'Document',
        entityId: id,
        expectedVersion: Number(body.expectedVersion ?? body.version)
      });
    }

    await orm.transaction(async (tx) => {
      await tx.update(documents).set({
        refNumber: refNumber ? String(refNumber) : existingDoc.refNumber,
        date: date ? normalizeDateToDbTimestamp(date) : existingDoc.date,
        user: user || existingDoc.user,
        notes: notes !== undefined ? notes : existingDoc.notes,
        buyerName: buyer_name !== undefined ? buyer_name : existingDoc.buyerName,
        buyerCity: buyer_city !== undefined ? buyer_city : existingDoc.buyerCity,
        buyerPhone: buyer_phone !== undefined ? buyer_phone : existingDoc.buyerPhone,
        buyerAddress: buyer_address !== undefined ? buyer_address : existingDoc.buyerAddress,
        status: status || existingDoc.status,
        currency: currency || existingDoc.currency,
        attachments: body.attachments !== undefined ? body.attachments : (existingDoc.attachments || []),
        version: nextVersion(existingDoc.version)
      }).where(eq(documents.id, id));

      if (Array.isArray(docLines)) {
        await tx.delete(documentItems).where(eq(documentItems.documentId, id));

        const docLocation = location ? String(location).trim() : '';

        for (const item of docLines) {
          const { itemId, quantity, unit_price, unitPrice, discount, location: itemLoc } = item;
          const price = unit_price ?? unitPrice ?? 0;
          const disc = discount || 0;
          const qty = Number(quantity);
          const targetLoc = await resolveWarehouseCode(tx, itemLoc || docLocation || '');

          if (!Number.isFinite(qty) || qty <= 0) {
            throw new ValidationError(`مقدار/تعداد برای کالای با شناسه ${itemId} باید عددی بزرگ‌تر از صفر باشد.`);
          }
          if (!Number.isFinite(Number(price)) || Number(price) < 0) {
            throw new ValidationError(`قیمت واحد برای کالای با شناسه ${itemId} نمی‌تواند منفی یا نامعتبر باشد.`);
          }

          await tx.insert(documentItems).values({
            documentId: id,
            itemId: Number(itemId),
            quantity: qty,
            unitPrice: price,
            discount: disc,
            location: targetLoc
          });
        }
      }
    });
  }

  /**
   * Resolves fiscal year from a date string/number and the invoice start-number setting.
   */
  private static async resolveRefContext(
    tx: DbClient,
    type: string,
    dateOrFiscalYear?: string | number
  ): Promise<{ fiscalYear: number; startNumber: number }> {
    // V10-1.1: قاعده صریح و واحد — partition key شمارنده‌ها همیشه «سال جلالی» است،
    // نه پرش بین ۱۴۰۵/۲۰۲۶ بسته به فرمت رشته تاریخ.
    let fiscalYear = resolveJalaliFiscalYear(dateOrFiscalYear ?? null);

    let startNumber = 1;
    if (type === 'invoice') {
      const startSetting = await tx.select().from(appSettings).where(eq(appSettings.key, 'invoice_start_number'));
      if (startSetting.length > 0 && !isNaN(parseInt(startSetting[0].value, 10))) {
        startNumber = parseInt(startSetting[0].value, 10);
      }
    }

    return { fiscalYear, startNumber };
  }

  /**
   * Scans existing documents of the given type and returns the maximum numeric refNumber suffix.
   */
  private static async getMaxExistingRefNumber(tx: DbClient, type: string): Promise<number> {
    const existingDocs = await tx
      .select({ refNumber: documents.refNumber })
      .from(documents)
      .where(and(
        eq(documents.type, type),
        eq(documents.isDeleted, 0)
      ));

    let maxNum = 0;
    for (const doc of existingDocs) {
      if (doc.refNumber) {
        const numStr = String(doc.refNumber).replace(/\D/g, '');
        if (numStr) {
          const val = parseInt(numStr, 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
      }
    }
    return maxNum;
  }

  /**
   * Peeks the next reference number for a document type WITHOUT incrementing any counter.
   * Used by form prefill endpoints so that abandoned forms / page loads never burn document numbers.
   */
  static async peekNextRef(type: string, dateOrFiscalYear?: string | number): Promise<string> {
    const { fiscalYear, startNumber } = await DocumentService.resolveRefContext(orm, type, dateOrFiscalYear);

    const [counter] = await orm
      .select()
      .from(documentRefCounters)
      .where(and(
        eq(documentRefCounters.docType, type),
        eq(documentRefCounters.fiscalYear, fiscalYear)
      ));

    if (counter) {
      return String(Math.max(counter.lastRefNumber + 1, startNumber));
    }

    // Cold start: peek from max existing document number (read-only, no counter write)
    const maxNum = await DocumentService.getMaxExistingRefNumber(orm, type);
    return String(Math.max(maxNum + 1, startNumber));
  }

  /**
   * Calculates the next reference number for a given document type using the atomic document_ref_counters table.
   * Lock contention on the documents table is completely avoided by locking only the target counter row.
   */
  static async getNextRef(type: string, dateOrFiscalYear?: string | number, externalTx?: DbClient): Promise<string> {
    const execute = async (tx: DbClient) => {
      const { fiscalYear, startNumber } = await DocumentService.resolveRefContext(tx, type, dateOrFiscalYear);

      // Lock only the specific counter row for (docType, fiscalYear)
      const [counter] = await tx
        .select()
        .from(documentRefCounters)
        .where(and(
          eq(documentRefCounters.docType, type),
          eq(documentRefCounters.fiscalYear, fiscalYear)
        ))
        .for('update');

      let nextNum: number;
      if (counter) {
        nextNum = Math.max(counter.lastRefNumber + 1, startNumber);
        await tx
          .update(documentRefCounters)
          .set({ lastRefNumber: nextNum })
          .where(and(
            eq(documentRefCounters.docType, type),
            eq(documentRefCounters.fiscalYear, fiscalYear)
          ));
      } else {
        // V9-1.2: cold-start atomic seeding — INSERT ... ON CONFLICT DO NOTHING eliminates the
        // MAX()+1 race where two concurrent first calls computed the same number.
        const maxNum = await DocumentService.getMaxExistingRefNumber(tx, type);
        const seedNum = Math.max(maxNum + 1, startNumber);

        const inserted = await tx
          .insert(documentRefCounters)
          .values({
            docType: type,
            fiscalYear,
            lastRefNumber: seedNum,
          })
          .onConflictDoNothing({
            target: [documentRefCounters.docType, documentRefCounters.fiscalYear]
          })
          .returning({ lastRefNumber: documentRefCounters.lastRefNumber });

        if (inserted.length > 0) {
          // This transaction won the seeding race — the seeded value is ours to consume
          nextNum = seedNum;
        } else {
          // A concurrent transaction seeded the counter first — lock and increment atomically
          const [retryCounter] = await tx
            .select()
            .from(documentRefCounters)
            .where(and(
              eq(documentRefCounters.docType, type),
              eq(documentRefCounters.fiscalYear, fiscalYear)
            ))
            .for('update');

          nextNum = Math.max((retryCounter?.lastRefNumber || 0) + 1, startNumber);
          await tx
            .update(documentRefCounters)
            .set({ lastRefNumber: nextNum })
            .where(and(
              eq(documentRefCounters.docType, type),
              eq(documentRefCounters.fiscalYear, fiscalYear)
            ));
        }
      }

      return String(nextNum);
    };

    if (externalTx) {
      return await execute(externalTx);
    }
    return await orm.transaction(async (tx) => execute(tx));
  }

  /**
   * Creates a new document and applies associated inventory changes.
   */
  static async createDocument(body: CreateDocumentInput): Promise<number> {
    const { 
      docType: rawDocType, type: rawType, refNumber, date, items: docLines, user, inOut,
      buyer_name, buyerName, buyer_city, buyerCity, buyer_phone, buyerPhone, buyer_address, buyerAddress,
      status, notes, location, currency, externalTx
    } = body;

    const docType = rawDocType || rawType || 'invoice';
    const docStatus = status || 'final';
    const docLocation = location ? String(location).trim() : '';

    // V3.1.46 (TD-070): لینک رسمی سند به پروژه — اعتبارسنجی وجود پروژه پیش از درج (FK انسانی)
    const rawProjectId = body.projectId ?? body.project_id;
    let finalProjectId: number | null = null;
    if (rawProjectId !== undefined && rawProjectId !== null && String(rawProjectId).trim() !== '') {
      finalProjectId = Number(rawProjectId);
      if (isNaN(finalProjectId) || finalProjectId <= 0) {
        throw new ValidationError(`شناسه پروژه (projectId) نامعتبر است: ${rawProjectId}`);
      }
    }

    const finalBuyerName = buyerName || buyer_name || '';
    const finalBuyerCity = buyerCity || buyer_city || '';
    const finalBuyerPhone = buyerPhone || buyer_phone || '';
    const finalBuyerAddress = buyerAddress || buyer_address || '';

    const execute = async (tx: DbClient): Promise<number> => {
      if (finalProjectId !== null) {
        const [projExists] = await tx
          .select({ id: productionProjects.id })
          .from(productionProjects)
          .where(and(eq(productionProjects.id, finalProjectId), eq(productionProjects.isDeleted, 0)));
        if (!projExists) {
          throw new NotFoundError(`پروژه با شناسه ${finalProjectId} یافت نشد.`);
        }
      }
      let finalRefNumber = refNumber;
      if (!finalRefNumber || finalRefNumber === 'auto' || String(finalRefNumber).trim() === '') {
        finalRefNumber = await DocumentService.getNextRef(docType, date, tx);
      } else {
        // Sync document_ref_counters with custom refNumber if it has numeric digits
        const digits = String(finalRefNumber).replace(/\D/g, '');
        if (digits) {
          const val = parseInt(digits, 10);
          if (!isNaN(val) && val > 0 && val <= 2147483647) {
            // V3.0.6 (BUG-07): کلید شمارنده دستی نیز باید «سال جلالی» باشد؛
            // قبلاً سال میلادی (new Date().getFullYear) استفاده می‌شد و شمارنده
            // دستی روی ردیفی متفاوت از شماره‌گذاری خودکار sync می‌شد.
            const year = resolveJalaliFiscalYear(date ?? null);
            const [existingCounter] = await tx
              .select()
              .from(documentRefCounters)
              .where(and(eq(documentRefCounters.docType, docType), eq(documentRefCounters.fiscalYear, year)))
              .for('update');
            if (existingCounter) {
              if (val > existingCounter.lastRefNumber) {
                await tx
                  .update(documentRefCounters)
                  .set({ lastRefNumber: val })
                  .where(and(eq(documentRefCounters.docType, docType), eq(documentRefCounters.fiscalYear, year)));
              }
            } else {
              await tx
                .insert(documentRefCounters)
                .values({ docType, fiscalYear: year, lastRefNumber: val })
                .onConflictDoUpdate({
                  target: [documentRefCounters.docType, documentRefCounters.fiscalYear],
                  set: { lastRefNumber: sql`GREATEST(${documentRefCounters.lastRefNumber}, ${val})` }
                });
            }
          }
        }
      }

      const normalizedDocDate = normalizeDateToDbTimestamp(date);

      const [insertedDoc] = await tx.insert(documents).values({
        type: docType,
        refNumber: String(finalRefNumber),
        date: normalizedDocDate,
        user,
        notes: notes || '',
        buyerName: finalBuyerName,
        buyerCity: finalBuyerCity,
        buyerPhone: finalBuyerPhone,
        buyerAddress: finalBuyerAddress,
        status: docStatus,
        currency: currency || 'IRR',
        attachments: body.attachments || [],
        projectId: finalProjectId ?? undefined,
        isDeleted: 0
      }).returning({ id: documents.id });
      const docId = insertedDoc.id;

      if (docType === 'audit') {
        for (const item of docLines) {
          const { itemId, system_stock, physical_stock, location: itemLoc } = item;
          const targetLoc = await resolveWarehouseCode(tx, itemLoc || docLocation || '');
          const variance = Number(physical_stock) - Number(system_stock);

          await tx.insert(documentItems).values({
            documentId: docId,
            itemId: Number(itemId),
            quantity: Number(physical_stock || 0),
            unitPrice: 0,
            discount: 0,
            location: targetLoc
          });

          if (variance !== 0) {
            const txType = variance > 0 ? 'in' : 'out';
            const absVariance = Math.abs(variance);
            const txNotes = variance > 0 ? 'اضافی انبارگردانی دوره‌ای' : 'کسری انبارگردانی دوره‌ای';

            await tx.insert(transactions).values({
              itemId: Number(itemId),
              documentId: docId,
              type: txType,
              quantity: absVariance,
              date: normalizedDocDate,
              documentType: 'audit',
              documentRef: String(finalRefNumber),
              createdBy: user,
              notes: txNotes,
              location: targetLoc,
              isDeleted: 0
            });

            const [itemData] = await tx
              .select({ stocks: items.stocks, currentStock: items.currentStock })
              .from(items)
              .where(eq(items.id, Number(itemId)))
              .for('update');

            const currentStocks = (itemData?.stocks as Record<string, number>) || {};
            currentStocks[targetLoc] = fin(physical_stock).round(4).toNumber();
            
            const newTotalStock = Object.values(currentStocks)
              .reduce((sum, val) => sum.add(Number(val) || 0), fin(0))
              .round(4)
              .toNumber();

            await tx.update(items).set({
              stocks: currentStocks,
              currentStock: newTotalStock
            }).where(eq(items.id, Number(itemId)));
          }
        }
      } else {
        for (const item of docLines) {
          const { itemId, quantity, unit_price, discount, location: itemLoc, price: directPrice, unitPrice: camelUnitPrice } = item;
          const price = unit_price !== undefined ? unit_price : (camelUnitPrice !== undefined ? camelUnitPrice : (directPrice || 0));
          const disc = discount || 0;
          const qty = Number(quantity);
          const targetLoc = await resolveWarehouseCode(tx, itemLoc || docLocation || '');

          if (docStatus === 'final') {
            await DocumentService.applyStockMovement(tx, {
              itemId: Number(itemId),
              documentId: docId,
              inOut,
              quantity: qty,
              price,
              date,
              documentType: docType,
              documentRef: String(finalRefNumber),
              user,
              targetLoc,
            });
          }

          await tx.insert(documentItems).values({
            documentId: docId,
            itemId: Number(itemId),
            quantity: qty,
            unitPrice: price,
            discount: disc,
            location: targetLoc
          });
        }
      }

      // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with document creation)
      const isApproved = docStatus === 'final';
      if (docType === 'invoice' || docType === 'proforma') {
        const invEvent = domainEventBus.createEvent(
          isApproved ? DomainEventType.INVOICE_APPROVED : DomainEventType.INVOICE_CREATED,
          'Document',
          String(docId),
          {
            documentId: docId,
            refNumber: String(finalRefNumber),
            docType,
            buyerName: buyer_name || '',
            currency: currency || 'IRR',
            itemCount: docLines?.length || 0,
            status: docStatus
          },
          { userName: user }
        );
        await OutboxService.saveToOutbox(tx, invEvent);
      } else if (docType === 'receipt' || docType === 'production_receipt' || docType === 'purchase') {
        const purchEvent = domainEventBus.createEvent(
          isApproved ? DomainEventType.PURCHASE_APPROVED : DomainEventType.PURCHASE_CREATED,
          'Document',
          String(docId),
          {
            documentId: docId,
            refNumber: String(finalRefNumber),
            supplierName: buyer_name || '',
            currency: currency || 'IRR',
            itemCount: docLines?.length || 0,
            status: docStatus
          },
          { userName: user }
        );
        await OutboxService.saveToOutbox(tx, purchEvent);
      }

      if (docStatus === 'final' && !body.skipVoucherSync) {
        const vatPercent = body.vat_percent !== undefined ? body.vat_percent : body.vatPercent;
        const vatAmount = body.vat_amount !== undefined ? body.vat_amount : body.vatAmount;
        const isStrict = body.strict;
        if (docType === 'invoice' || docType === 'proforma') {
          await VoucherSyncService.syncSalesInvoiceVoucher(docId, {
            username: user,
            vatPercent: vatPercent !== undefined && vatPercent !== null ? Number(vatPercent) : undefined,
            vatAmount: vatAmount !== undefined && vatAmount !== null ? Number(vatAmount) : undefined,
            strict: isStrict,
          }, tx);
        } else if (['receipt', 'production_receipt', 'purchase'].includes(docType)) {
          await VoucherSyncService.syncPurchaseInvoiceVoucher(docId, { username: user, strict: isStrict }, tx);
        } else if (['remittance', 'waste', 'return'].includes(docType)) {
          await VoucherSyncService.syncWarehouseDocumentVoucher(docId, { username: user, strict: isStrict }, tx);
        }
      }

      return docId;
    };

    // V9-P0: پشتیبانی از تراکنش خارجی (externalTx) برای اجرای اتمیک در تراکنش فراخواننده
    if (externalTx) {
      return await execute(externalTx);
    }
    return await orm.transaction(execute);
  }

  /**
   * Retrieves a list of documents, optionally filtered by type, status, date range, search query, and pagination.
   */
  static async getDocuments(
    typeOrFilter?: string | GetDocumentsFilter
  ): Promise<FormattedDocument[] | PaginatedDocumentsResult> {
    const filter: GetDocumentsFilter = typeof typeOrFilter === 'string'
      ? { type: typeOrFilter }
      : (typeOrFilter || {});

    const conditions = [eq(documents.isDeleted, 0)];

    if (filter.type && filter.type !== 'all') {
      conditions.push(eq(documents.type, filter.type));
    }
    if (filter.status && filter.status !== 'all') {
      conditions.push(eq(documents.status, filter.status));
    }
    // V3.1.46 (TD-070): فیلتر پروژه‌محور اسناد
    if (filter.projectId !== undefined && filter.projectId !== null && String(filter.projectId).trim() !== '' && String(filter.projectId) !== 'all') {
      const projId = Number(filter.projectId);
      if (!isNaN(projId) && projId > 0) {
        conditions.push(eq(documents.projectId, projId));
      }
    }
    if (filter.startDate) {
      conditions.push(gte(documents.date, filter.startDate));
    }
    if (filter.endDate) {
      const endCondition = filter.endDate.length <= 10 ? filter.endDate + 'T23:59:59.999Z' : filter.endDate;
      conditions.push(lte(documents.date, endCondition));
    }
    if (filter.search && filter.search.trim() !== '') {
      const s = `%${filter.search.trim()}%`;
      conditions.push(or(
        ilike(documents.refNumber, s),
        ilike(documents.buyerName, s),
        ilike(documents.notes, s),
        ilike(documents.user, s),
        ilike(documents.buyerPhone, s),
        ilike(documents.buyerCity, s)
      )!);
    }

    const whereClause = and(...conditions);

    let query = orm.select().from(documents).where(whereClause).orderBy(desc(documents.id));

    // V9-1.3: گارد دفاعی — مقدار NaN/منفی در page/limit هرگز نباید LIMIT را حذف کند
    const safePage = Number.isFinite(filter.page) && (filter.page as number) > 0 ? (filter.page as number) : 1;
    const rawLimit = filter.limit;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit as number, 0), MAX_PAGE_LIMIT) : ((typeof typeOrFilter === 'object' && filter.page) ? 50 : 0);
    const page = safePage;
    const offset = filter.offset !== undefined && Number.isFinite(filter.offset) ? filter.offset : (page - 1) * limit;

    if (!filter.isExport && limit > 0) {
      query = query.limit(limit).offset(offset) as typeof query;
    }

    const docs = await query;

    // Fetch items ONLY for these retrieved docs to calculate totals efficiently
    const docIds = docs.map(d => d.id);
    let allItems: Array<{
      document_id: number;
      item_id: number;
      quantity: number;
      unit_price: number;
      discount: number;
      location: string;
      name: string | null;
      code: string | null;
      unit: string | null;
      category: string | null;
    }> = [];
    let treasurySettlements: Array<{
      documentId: number | null;
      amount: number;
      type: string;
      status: string;
    }> = [];

    if (docIds.length > 0) {
      allItems = await orm.select({
        document_id: documentItems.documentId,
        item_id: documentItems.itemId,
        quantity: documentItems.quantity,
        unit_price: documentItems.unitPrice,
        discount: documentItems.discount,
        location: documentItems.location,
        name: items.name,
        code: items.code,
        unit: items.unit,
        category: items.category
      })
      .from(documentItems)
      .leftJoin(items, eq(documentItems.itemId, items.id))
      .where(and(inArray(documentItems.documentId, docIds), eq(documentItems.isDeleted, 0)));

      treasurySettlements = await orm.select({
        documentId: treasuryTransactions.documentId,
        amount: treasuryTransactions.amount,
        type: treasuryTransactions.type,
        status: treasuryTransactions.status,
      })
      .from(treasuryTransactions)
      .where(and(
        inArray(treasuryTransactions.documentId, docIds),
        eq(treasuryTransactions.isDeleted, 0),
        eq(treasuryTransactions.status, 'completed')
      ));
    }

    const formattedDocs: FormattedDocument[] = docs.map(d => {
      const dItems = allItems.filter(i => i.document_id === d.id);
      const itemsCount = dItems.length;
      // V9-1.3: جمع‌های مالی با FinancialDecimal — حذف خطای شناور float
      const totalQuantity = dItems.reduce((acc, i) => fin(acc).add(Number(i.quantity || 0)).toNumber(), 0);
      const totalAmount = dItems.reduce(
        (acc, i) => fin(acc).add(fin(Number(i.quantity || 0)).multiply(Number(i.unit_price || 0)).subtract(Number(i.discount || 0))).toNumber(),
        0
      );
      const totalDiscount = dItems.reduce((acc, i) => fin(acc).add(Number(i.discount || 0)).toNumber(), 0);
      const grossAmount = dItems.reduce(
        (acc, i) => fin(acc).add(fin(Number(i.quantity || 0)).multiply(Number(i.unit_price || 0))).toNumber(),
        0
      );

      // V3.0.0 Phase 1: وضعیت تسویه فاکتور و تجمیع تراکنش‌های خزانه
      const docSettlements = treasurySettlements.filter(t => t.documentId === d.id);
      const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(d.type);
      const paidAmount = docSettlements.reduce((sum, t) => {
        const amt = Number(t.amount || 0);
        if (isPurchase) {
          return sum + (t.type === 'payment' ? amt : -amt);
        } else {
          return sum + (t.type === 'receipt' ? amt : -amt);
        }
      }, 0);

      const safePaidAmount = Math.max(0, paidAmount);
      const remainingAmount = Math.max(0, fin(totalAmount).subtract(safePaidAmount).toNumber());
      let settlementStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';

      if (totalAmount > 0 && safePaidAmount >= totalAmount - 0.01) {
        settlementStatus = 'fully_paid';
      } else if (safePaidAmount > 0) {
        settlementStatus = 'partially_paid';
      } else {
        settlementStatus = 'unpaid';
      }

      return {
        ...d,
        buyer_name: d.buyerName,
        buyer_city: d.buyerCity,
        buyer_phone: d.buyerPhone,
        buyer_address: d.buyerAddress,
        ref_number: d.refNumber,
        projectId: d.projectId ?? null,
        project_id: d.projectId ?? null,
        itemsCount,
        totalQuantity,
        totalAmount,
        totalDiscount,
        grossAmount,
        paidAmount: safePaidAmount,
        remainingAmount,
        settlementStatus,
        items: dItems
      };
    });

    if (filter.isExport || (filter.limit === undefined && filter.page === undefined && typeof typeOrFilter === 'string')) {
      return formattedDocs;
    }

    // Calculate total count using SQL COUNT
    const [countResult] = await orm.select({ count: sql`count(*)`.mapWith(Number) })
      .from(documents)
      .where(whereClause);
    
    const total = countResult?.count || 0;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

    return {
      data: formattedDocs,
      total,
      page,
      limit: limit > 0 ? limit : total,
      totalPages: totalPages > 0 ? totalPages : 1
    };
  }

  /**
   * Retrieves a document by its ID, with its associated items.
   */
  static async getDocumentById(id: number): Promise<FormattedDocument | null> {
    const [doc] = await orm.select().from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
    if (!doc) return null;

    const itemsResult = await orm.execute(sql`
      SELECT di.*, i.name, i.code, i.unit, i.category
      FROM ${documentItems} di
      LEFT JOIN ${items} i ON di.item_id = i.id
      WHERE di.document_id = ${doc.id} AND (di.is_deleted IS NULL OR di.is_deleted = 0)
    `);

    const txs = doc.type === 'audit'
      ? await orm.select().from(transactions).where(eq(transactions.documentId, doc.id))
      : [];

    const rows = (itemsResult.rows || []) as Array<Record<string, unknown>>;

    const totalCalculated = rows.reduce((sum: number, row: Record<string, unknown>) => {
      const qty = Number(row.quantity || 0);
      const price = Number(row.unit_price || 0);
      const discount = Number(row.discount || 0);
      return fin(sum).add(fin(qty).multiply(price).subtract(discount)).toNumber();
    }, 0);

    const formattedItems: FormattedDocumentItem[] = rows.map((row: Record<string, unknown>) => {
      const matchingTx = txs.find(t => t.itemId === Number(row.item_id));
      const variance = matchingTx 
        ? (matchingTx.type === 'in' ? matchingTx.quantity : -matchingTx.quantity)
        : 0;
      const itemName = (row.name as string) || (row.item_name as string) || (row.code as string) || 'کالا';
      return {
        document_id: Number(row.document_id),
        item_id: Number(row.item_id),
        quantity: Number(row.quantity || 0),
        unit_price: Number(row.unit_price || 0),
        unitPrice: Number(row.unit_price || 0),
        discount: Number(row.discount || 0),
        location: String(row.location || 'main'),
        name: itemName,
        item_name: itemName,
        itemName: itemName,
        code: (row.code as string) || null,
        unit: (row.unit as string) || null,
        category: (row.category as string) || null,
        variance,
        system_stock: Number(row.quantity || 0) - variance
      };
    });

    const totalQuantity = formattedItems.reduce((acc, i) => acc + Number(i.quantity || 0), 0);
    const totalDiscount = formattedItems.reduce((acc, i) => acc + Number(i.discount || 0), 0);
    const grossAmount = formattedItems.reduce((acc, i) => acc + (Number(i.quantity || 0) * Number(i.unit_price || 0)), 0);

    // V3.0.0 Phase 1: بازیابی تراکنش‌های تسویه متصل به این سند
    const settlements = await orm.select({
      id: treasuryTransactions.id,
      transactionNumber: treasuryTransactions.transactionNumber,
      type: treasuryTransactions.type,
      method: treasuryTransactions.method,
      amount: treasuryTransactions.amount,
      date: treasuryTransactions.date,
      status: treasuryTransactions.status,
      trackingNumber: treasuryTransactions.trackingNumber,
      bankAccountId: treasuryTransactions.bankAccountId,
      description: treasuryTransactions.description,
    })
    .from(treasuryTransactions)
    .where(and(
      eq(treasuryTransactions.documentId, doc.id),
      eq(treasuryTransactions.isDeleted, 0),
      eq(treasuryTransactions.status, 'completed')
    ));

    const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(doc.type);
    const paidAmount = settlements.reduce((sum, t) => {
      const amt = Number(t.amount || 0);
      if (isPurchase) {
        return sum + (t.type === 'payment' ? amt : -amt);
      } else {
        return sum + (t.type === 'receipt' ? amt : -amt);
      }
    }, 0);

    const safePaidAmount = Math.max(0, paidAmount);
    const remainingAmount = Math.max(0, fin(totalCalculated).subtract(safePaidAmount).toNumber());
    let settlementStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';

    if (totalCalculated > 0 && safePaidAmount >= totalCalculated - 0.01) {
      settlementStatus = 'fully_paid';
    } else if (safePaidAmount > 0) {
      settlementStatus = 'partially_paid';
    } else {
      settlementStatus = 'unpaid';
    }

    return {
      ...doc,
      buyer_name: doc.buyerName,
      buyerName: doc.buyerName,
      buyer_city: doc.buyerCity,
      buyerCity: doc.buyerCity,
      buyer_phone: doc.buyerPhone,
      buyerPhone: doc.buyerPhone,
      buyer_address: doc.buyerAddress,
      buyerAddress: doc.buyerAddress,
      ref_number: doc.refNumber,
      refNumber: doc.refNumber,
      projectId: doc.projectId ?? null,
      project_id: doc.projectId ?? null,
      itemsCount: formattedItems.length,
      totalQuantity,
      totalDiscount,
      grossAmount,
      total_amount: totalCalculated,
      totalAmount: totalCalculated,
      paidAmount: safePaidAmount,
      remainingAmount,
      settlementStatus,
      settlements,
      items: formattedItems
    };
  }

  /**
   * V3.0.0 Phase 1: Retrieves detailed invoice settlement status with payment breakdown.
   */
  static async getInvoiceSettlementStatus(documentId: number) {
    const doc = await this.getDocumentById(documentId);
    if (!doc) throw new NotFoundError('سند یافت نشد');
    return {
      documentId: doc.id,
      refNumber: doc.refNumber,
      type: doc.type,
      status: doc.status,
      buyerName: doc.buyerName,
      buyerPhone: doc.buyerPhone,
      currency: doc.currency,
      totalAmount: doc.totalAmount,
      paidAmount: doc.paidAmount || 0,
      remainingAmount: doc.remainingAmount || 0,
      settlementStatus: doc.settlementStatus || 'unpaid',
      settlements: doc.settlements || []
    };
  }

  /**
   * Retrieves a document by its ID or reference number (refNumber).
   */
  static async getDocumentByIdOrRef(idOrRef: string | number): Promise<FormattedDocument | null> {
    const numericId = Number(idOrRef);
    if (!isNaN(numericId) && numericId > 0) {
      const doc = await this.getDocumentById(numericId);
      if (doc) return doc;
    }
    const [docByRef] = await orm.select().from(documents).where(eq(documents.refNumber, String(idOrRef)));
    if (docByRef) {
      return await this.getDocumentById(docByRef.id);
    }
    return null;
  }

  /**
   * Applies stock movement for a single document item (creates transaction and updates item stocks/WAC).
   */
  public static async applyStockMovement(
    tx: DbClient,
    params: {
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
  ): Promise<void> {
    const { itemId, documentId, inOut, quantity, price, date, documentType, documentRef, user, targetLoc, notes } = params;
    const qty = Number(quantity);
    const priceNum = Number(price);

    const finalTargetLoc = await resolveWarehouseCode(tx, targetLoc);

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
        stocks: items.stocks,
        currentStock: items.currentStock,
        weightedAverageCost: items.weightedAverageCost,
        version: items.version
      })
      .from(items)
      .where(eq(items.id, itemId))
      .for('update');

    if (!itemData) {
      throw new NotFoundError(`کالای مورد نظر با شناسه ${itemId} در سیستم یافت نشد.`);
    }

    const currentStocks = (itemData.stocks as Record<string, number>) || {};
    const currentLocStock = Number(currentStocks[finalTargetLoc] || 0);

    if (inOut === 'out') {
      if (currentLocStock < qty) {
        const policy = await NegativeStockPolicyService.getPolicy(tx);

        switch (policy) {
          case 'forbidden':
            throw new InsufficientStockError(
              `موجودی کافی در انبار ${finalTargetLoc} نیست. موجودی: ${currentLocStock}, درخواست: ${qty}`
            );

          case 'warning':
            logger.warn(
              `[Stock Warning] Negative stock applied for item ${itemId} (${itemData.name}) at ${finalTargetLoc}: ` +
              `current=${currentLocStock}, requested=${qty}`
            );
            // ادامه عملیات — کسر به مقدار منفی می‌رسد
            break;

          case 'allowed':
            // ادامه عملیات بدون هشدار
            break;

          default:
            // default = forbidden
            throw new InsufficientStockError(
              `موجودی کافی در انبار ${finalTargetLoc} نیست. موجودی: ${currentLocStock}, درخواست: ${qty}`
            );
        }
      }
    }

    const normalizedTxDate = normalizeDateToDbTimestamp(date);

    await tx.insert(transactions).values({
      itemId,
      documentId: documentId ?? undefined,
      type: inOut,
      quantity: qty,
      unitPrice: price,
      totalPrice: fin(price).multiply(qty).round(4).toNumber(),
      date: normalizedTxDate,
      documentType,
      documentRef: String(documentRef),
      createdBy: user,
      notes: notes || '',
      location: finalTargetLoc,
      isDeleted: 0,
    });

    const updatedLocStock = inOut === 'in'
      ? fin(currentLocStock).add(qty).round(4).toNumber()
      : fin(currentLocStock).subtract(qty).round(4).toNumber();
    currentStocks[finalTargetLoc] = updatedLocStock;

    // Single source of truth: total currentStock is strictly the sum of all location stocks
    const newTotalStock = Object.values(currentStocks)
      .reduce((sum, val) => sum.add(Number(val) || 0), fin(0))
      .round(4)
      .toNumber();
    const oldTotalStock = Number(itemData.currentStock || 0);

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
      }

  /**
   * V3.1.45 (TD-076): معکوس‌سازی متمرکز موجودی برای ابطال اسناد (DB-009) —
   * دوگانه انبار + WAC بازگشتی + bump نسخه OCC در یک نقطه تا invariantهای آینده یک‌جا اعمال شوند.
   */
  static async applyStockReversal(
    tx: DbClient,
    params: {
      itemId: number;
      quantity: number;
      originalDirection: 'in' | 'out';
      unitPrice: number;
      location: string;
    }
  ): Promise<void> {
    const { itemId, quantity: qty, originalDirection, unitPrice, location: targetLoc } = params;

    const [itemData] = await tx
      .select({ stocks: items.stocks, currentStock: items.currentStock, weightedAverageCost: items.weightedAverageCost, version: items.version })
      .from(items)
      .where(eq(items.id, itemId))
      .for('update');
    if (!itemData) return;

    const currentStocks = (itemData.stocks as Record<string, number>) || {};
    const currentLocStock = Number(currentStocks[targetLoc] || 0);

    currentStocks[targetLoc] = originalDirection === 'in'
      ? fin(currentLocStock).subtract(qty).round(4).toNumber()
      : fin(currentLocStock).add(qty).round(4).toNumber();

    const oldTotalStock = Number(itemData.currentStock || 0);
    const newTotalStock = Object.values(currentStocks)
      .reduce((sum, val) => sum.add(Number(val) || 0), fin(0))
      .round(4)
      .toNumber();

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
   * Finalizes a draft or proforma document in a strict 4-step atomic orchestration:
   * 1. Pre-flight validation & row-level locking (.for('update'))
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
    options?: { strict?: boolean }
  ): Promise<void> {
    const isStrict = options?.strict !== false;

    const execute = async (tx: DbExecutor): Promise<void> => {
      // Step 1: Pre-flight validation & row-level locking
      const [doc] = await tx.select().from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)))
        .for('update');

      if (!doc) {
        throw new NotFoundError(`سند با شناسه ${id} یافت نشد`);
      }
      if (doc.status === 'final') {
        logger.info({ message: `[DocumentService.finalizeDocument] Document #${id} already finalized — skipping (concurrent call prevention)`, documentId: id });
        return;
      }

      // Pre-flight: verify line items existence and validity
      const docLines = await tx.select().from(documentItems).where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));
      if (!docLines || docLines.length === 0) {
        throw new ValidationError(`سند شماره «${doc.refNumber || id}» فاقد هرگونه قلم کالا برای نهایی‌سازی است.`);
      }

      for (const item of docLines) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ValidationError(`مقدار قلم کالا (شناسه ${item.itemId}) در سند شماره «${doc.refNumber || id}» باید عددی بزرگ‌تر از صفر باشد.`);
        }
        const price = Number(item.unitPrice || 0);
        if (!Number.isFinite(price) || price < 0) {
          throw new ValidationError(`قیمت واحد قلم کالا (شناسه ${item.itemId}) در سند شماره «${doc.refNumber || id}» نمی‌تواند منفی باشد.`);
        }
      }

      const targetType = doc.type === 'proforma' ? 'invoice' : doc.type;
      const inOut: 'in' | 'out' = (targetType === 'receipt' || targetType === 'production_receipt' || targetType === 'return') ? 'in' : 'out';

      // Pre-flight stock availability & reservation check for exit documents (TD-118)
      if (inOut === 'out') {
        const reservationReport = await ItemStockReservationService.getReservedStockDetails();
        for (const item of docLines) {
          const qty = fin(item.quantity).toNumber();
          const targetLoc = await resolveWarehouseCode(tx, item.location ? String(item.location).trim() : '');

          const [dbItem] = await tx.select({
            id: items.id,
            code: items.code,
            name: items.name,
            unit: items.unit,
            stocks: items.stocks,
            currentStock: items.currentStock,
          }).from(items).where(eq(items.id, item.itemId)).for('update');

          if (!dbItem) {
            throw new NotFoundError(`کالا با شناسه ${item.itemId} یافت نشد`);
          }

          const summary = reservationReport.itemSummaries.find(s => s.itemId === item.itemId);
          const sellableInfo = ItemStockReservationService.computeSellable(
            summary,
            (dbItem.stocks as Record<string, number>) || {},
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

        await DocumentService.applyStockMovement(tx, {
          itemId: item.itemId,
          documentId: id,
          inOut,
          quantity: qty,
          price,
          date: doc.date,
          documentType: targetType,
          documentRef: doc.refNumber,
          user: user || doc.user,
          targetLoc,
        });
      }

      // Step 3: Document Status Commitment & Domain Event Outbox
      await tx.update(documents).set({ 
        status: 'final',
        type: targetType,
        version: nextVersion(doc.version)
      }).where(eq(documents.id, id));

      const isSales = targetType === 'invoice' || targetType === 'proforma';
      const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(targetType);

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
          { userName: user || doc.user }
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
          { userName: user || doc.user }
        );
        await OutboxService.saveToOutbox(tx, purchEvent);
      }

      // Step 4: Auto-generate double-entry accounting voucher (Rule DB-008, Strict Mode)
      if (isSales) {
        await VoucherSyncService.syncSalesInvoiceVoucher(id, {
          username: user || doc.user,
          strict: isStrict,
        }, tx);
      } else if (isPurchase) {
        await VoucherSyncService.syncPurchaseInvoiceVoucher(id, {
          username: user || doc.user,
          strict: isStrict,
        }, tx);
      } else if (['remittance', 'waste', 'return'].includes(targetType)) {
        await VoucherSyncService.syncWarehouseDocumentVoucher(id, {
          username: user || doc.user,
          strict: isStrict,
        }, tx);
      }
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
            isDeleted: 0,
          });
        }
      }

      // 4. Revert stock for final documents
      const docLines = await tx.select().from(documentItems).where(eq(documentItems.documentId, id));
      const docDirection: 'in' | 'out' = (doc.type === 'receipt' || doc.type === 'production_receipt' || doc.type === 'return') ? 'in' : 'out';

      if (doc.status === 'final') {
        for (const item of docLines) {
          // V3.0.7 (TD-061): انبار برگشتی = انبار واقعی ردیف اصلی از ledger
          // (transactions نسخه‌های قبلی سند)؛ نه کلید 'default' که باعث به‌روزرسانی
          // گره اشتباه در stocks.jsonb و واگرایی سه‌طرفه می‌شد.
          const origTxForItem = originalTxs.find(t => t.itemId === item.itemId && (t.location || '') === (item.location || ''))
            || originalTxs.find(t => t.itemId === item.itemId);
          const targetLoc = (origTxForItem?.location || item.location || '').trim() || 'default';

          await DocumentService.applyStockReversal(tx, {
            itemId: item.itemId,
            quantity: item.quantity,
            originalDirection: docDirection,
            unitPrice: Number(item.unitPrice || 0),
            location: targetLoc
          });
        }

        // V9-1.1: برگشت سند حسابداری متناظر (صدور سند معکوس) در همان تراکنش
        const linkedVouchers = await tx.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber })
          .from(journalVouchers)
          .where(and(
            eq(journalVouchers.referenceModule, 'invoice'),
            eq(journalVouchers.referenceId, id),
            eq(journalVouchers.isDeleted, 0)
          ));

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

  /**
   * Reconciles and rebuilds inventory stocks directly from the transaction ledger (Event Sourcing).
   * Ensures 100% mathematical consistency between location breakdown (stocks) and current_stock.
   */
  static async reconcileAndRebuildStock(targetItemId?: number): Promise<{
    reconciledCount: number;
    discrepanciesFixed: number;
  }> {
    return await orm.transaction(async (tx) => {
      // Fetch all items or specific item
      const condition = targetItemId 
        ? and(eq(items.id, targetItemId), eq(items.isDeleted, 0)) 
        : eq(items.isDeleted, 0);
      const allActiveItems = await tx.select().from(items).where(condition).for('update');

      let discrepanciesFixed = 0;

      for (const it of allActiveItems) {
        // Fetch all active transactions for this item
        const txList = await tx
          .select({
            type: transactions.type,
            quantity: transactions.quantity,
            location: transactions.location
          })
          .from(transactions)
          .where(and(eq(transactions.itemId, it.id), eq(transactions.isDeleted, 0)));

        const locationStocks: Record<string, number> = {};
        for (const t of txList) {
          const loc = t.location || 'default';
          const q = Number(t.quantity) || 0;
          const current = locationStocks[loc] || 0;
          locationStocks[loc] = roundFinancial(t.type === 'in' ? current + q : current - q);
        }

        const totalRebuiltStock = roundFinancial(
          Object.values(locationStocks).reduce((sum, val) => sum + (Number(val) || 0), 0)
        );

        const oldCurrentStock = Number(it.currentStock || 0);
        const oldStocksObj = (it.stocks as Record<string, number>) || {};

        // Check if there was any discrepancy
        const hasDiff = oldCurrentStock !== totalRebuiltStock || 
          JSON.stringify(oldStocksObj) !== JSON.stringify(locationStocks);

        if (hasDiff) {
          discrepanciesFixed++;
          await tx.update(items).set({
            stocks: locationStocks,
            currentStock: totalRebuiltStock
          }).where(eq(items.id, it.id));
        }
      }

      return {
        reconciledCount: allActiveItems.length,
        discrepanciesFixed
      };
    });
  }
}
