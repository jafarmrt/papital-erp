import { eq, and, inArray } from 'drizzle-orm';
import { assertProjectNotCancelled } from '../projects/projectCancelledGuard.js';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documents, documentItems, items, productionProjects } from '../../db/schema.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { requireDocumentTimestamp, resolveDocumentTimestamp } from '../../lib/storageDate.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType, type InvoiceEventPayload, type PurchaseEventPayload } from '../events/domainEvents.js';
import { documentEventAmounts } from './documentEventAmount.js';
import { OutboxService } from '../events/outboxService.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { syncStockAdjustmentVoucher } from '../accounting/stockAdjustmentVoucher.js';
import { createWarehouseResolver } from '../inventory/warehouseResolver.js';
import { assertBookStocksUnchanged, assertStockCountLines } from '../inventory/stockCountSheet.js';
import { sortIdsForLocking } from '../../lib/lockOrder.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { DocumentRefNumberService } from './documentRefNumber.service.js';
import { assertManualRefAllowed } from './documentRecordRule.js';
import { isAutoRefNumber } from '../../lib/documents/documentRefRules.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { DocumentStockEngine } from './documentStockEngine.service.js';
import { resolveDocumentVat, parseVatInput, VAT_DOC_TYPES } from './documentVat.js';
import { assertLineDiscountsWithinAmount } from './lineDiscount.js';
import { resolveDocumentExchangeRate, stockUnitPriceInIrr } from './documentExchangeRate.js';
import { netLineUnitPrice } from './purchaseLineCost.js';
import { assertIncomingLinesHaveCost } from './incomingLineCost.js';
import { assertReturnWithinSold, parseReturnOfDocumentId, resolveSalesReturnUnitCosts } from './salesReturnCost.js';
import { enforceReturnInvoiceTerms } from './salesReturnPrice.js';
import { resolveReturnVatFromInvoice } from './salesReturnVat.js';
import { applyDocumentLeadLink, documentLeadLinkOf, lockLeadsForDocumentLink, type LockedDocumentLeads } from '../crm/leadProforma.js';
import type { DbClient, CreateDocumentInput, UpdateDocumentInput } from './types.js';
import { releaseReservationsForDocument, type ProjectReservationRelease } from './projectReservationRelease.js';
import { AttachmentStorageService } from '../attachments/attachmentStorage.service.js';
import { money } from '../../lib/money.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { assertDocumentStatus, assertRecordableDocument, stockDirectionOf } from './documentRecordRule.js';
import { assertOutflowWithinSellable } from './documentSellableGate.js';
import { assertDocumentNotInReview } from './documentReviewLock.js';
import { assertReturnPartyOfInvoice, parseDocumentPartyId, resolveDocumentParty, returnInvoicePartyId } from './documentParty.js';
import { documentAuditSnapshot, type DocumentAuditChange } from './documentAudit.js';

type DocumentLineRow = typeof documentItems.$inferInsert;

/** v7.0.72 (audit P3-5): حداکثر ردیف در هر INSERT چندردیفی اقلام سند */
const DOCUMENT_LINE_INSERT_CHUNK = 500;

/** v7.0.72 (audit P3-5): اقلام سند با INSERT چندردیفی پس از حلقه (قبلاً یک INSERT برای هر قلم) */
async function insertDocumentLines(tx: DbClient, rows: DocumentLineRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += DOCUMENT_LINE_INSERT_CHUNK) {
    await tx.insert(documentItems).values(rows.slice(i, i + DOCUMENT_LINE_INSERT_CHUNK));
  }
}

export class DocumentCreationService {
  /**
   * Updates the notes of a specific document.
   * v9.0.337 (TD-785): در تراکنش فراخواننده و با سند پیش و پس از تغییر، تا ردیف ممیزی همان تراکنش نوشته شود
   * (پیش‌تر یادداشت سند قطعی بی هیچ ردیف ممیزی عوض می‌شد)
   */
  static async updateDocumentNotes(id: number, notes: string, externalTx?: DbExecutor): Promise<DocumentAuditChange> {
    const execute = async (tx: DbExecutor): Promise<DocumentAuditChange> => {
      const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0))).for('update');
      if (!doc) throw new NotFoundError('سند مورد نظر یافت نشد.');
      const before = await documentAuditSnapshot(tx, id);
      await tx.update(documents).set({ notes, version: nextVersion(doc.version) }).where(eq(documents.id, id));
      return { before, after: await documentAuditSnapshot(tx, id) };
    };
    return externalTx ? execute(externalTx) : orm.transaction(execute);
  }

  /**
   * Updates an existing document (proforma or draft) and its line items.
   * v9.0.337 (TD-785): در تراکنش فراخواننده؛ سند پیش از تغییر زیر قفل ردیف و پس از تغییر برای ردیف ممیزی برمی‌گردد
   */
  static async updateDocument(id: number, body: UpdateDocumentInput, externalTx?: DbExecutor): Promise<DocumentAuditChange> {
    const { 
      refNumber, date, user,
      buyer_name, buyer_city, buyer_phone, buyer_address,
      status, notes, location, currency, items: docLines
    } = body;

    // v8.0.103 (TD-380): تخفیف هر ردیف حداکثر برابر مبلغ همان ردیف
    if (Array.isArray(docLines)) assertLineDiscountsWithinAmount(docLines);

    const leadTarget = documentLeadLinkOf(body.crmLeadId);
    const requestedPartyId = parseDocumentPartyId(body.partyId);

    const execute = async (tx: DbExecutor): Promise<DocumentAuditChange> => {
      // v9.0.323 (TD-776): پیوند پرونده فروش درون همین تراکنش؛ پرونده‌ها پیش از ردیف سند قفل و سنجیده می‌شوند (۴۲۲ پیش از
      // هر نوشتن). پیش‌فاکتور بودن از نوع سند و وضعیت پس از این ویرایش است.
      let leadLock: LockedDocumentLeads | null = null;
      let leadDocIsProforma = false;
      if (leadTarget !== undefined) {
        const [stored] = await tx.select({ type: documents.type, status: documents.status }).from(documents)
          .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)));
        if (!stored) throw new NotFoundError('سند مورد نظر یافت نشد.');
        leadDocIsProforma = stored.type === 'proforma' || (status || stored.status) === 'proforma';
        leadLock = await lockLeadsForDocumentLink(tx, id, leadTarget, leadDocIsProforma);
      }

      // V6 Sub-phase 5.2 (TD-154): Read document under row lock (.for('update')) to prevent concurrent lost updates
      // and race conditions with concurrent finalizeDocument calls.
      const [existingDoc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.isDeleted, 0)))
        .for('update');

      if (!existingDoc) {
        throw new NotFoundError('سند مورد نظر یافت نشد.');
      }

      if (existingDoc.status === 'final') {
        throw new ValidationError('امکان ویرایش مستقیم سند نهایی‌شده وجود ندارد.');
      }
      // v10.0.86 (TD-1138، ت۱۳): سندی که در گام بازبینی گردش کار است تا پایان بازبینی ویرایش نمی‌شود
      await assertDocumentNotInReview(tx, id);
      const before = await documentAuditSnapshot(tx, id);

      if (status === 'final') {
        throw new ValidationError(
          'نهایی‌سازی سند از مسیر ویرایش مجاز نیست؛ عملیات نهایی‌سازی باید از مسیر «نهایی‌سازی و تایید» انجام شود تا کسر موجودی انبار، صدور سند حسابداری و گردش کار به‌درستی اجرا گردند.'
        );
      }

      // v10.0.108 (TD-972): مسیر ویرایش (`PUT /documents/:id`) بدون نسخه ۴۰۰ می‌دهد؛ نسخه کهنه اینجا ۴۰۹ می‌گیرد
      if (body.expectedVersion !== undefined || body.version !== undefined) {
        checkOccVersion(existingDoc, {
          entityType: 'Document',
          entityId: id,
          expectedVersion: Number(body.expectedVersion ?? body.version)
        });
      }

      const newVer = nextVersion(existingDoc.version);

      // v8.0.50 (TD-313، تصمیم مالک محصول — گزینه الف): تاریخ نامعتبر رد می‌شود؛ پیش‌نویس یا پیش‌فاکتوری که تاریخش به
      // سال مالی دیگری برود شماره بعدی همان سال را می‌گیرد (مگر شماره تازه‌ای داده شده باشد). پیش‌تر شماره و سال
      // شماره‌گذاری سال قبل می‌ماند.
      const newDocDate = date ? requireDocumentTimestamp(date, 'سند') : null;
      // v9.0.327 (TD-783، تصمیم ت۹ الف): شماره سند فروش (فاکتور، برگشت) فقط از سری سرور است و در ویرایش عوض نمی‌شود؛ شماره
      // دستی تازه سند انبار اگر در همان نوع و سال گرفته شده باشد ۴۰۹ با پیام فارسی (پیش‌تر خطای کلی «مقدار تکراری»)
      const requestedRef = isAutoRefNumber(refNumber) ? null : String(refNumber).trim();
      const refChanged = requestedRef !== null && requestedRef !== String(existingDoc.refNumber);
      if (refChanged) assertManualRefAllowed(existingDoc.type, requestedRef);
      let nextRefNumber = refChanged ? requestedRef : existingDoc.refNumber;
      let nextRefFiscalYear: number | undefined;
      const currentFiscalYear = existingDoc.refFiscalYear ?? resolveJalaliFiscalYear(existingDoc.date);
      if (newDocDate) {
        const newFiscalYear = resolveJalaliFiscalYear(newDocDate);
        if (newFiscalYear !== currentFiscalYear) {
          if (!refChanged) {
            nextRefNumber = await DocumentRefNumberService.getNextRef(existingDoc.type, newDocDate, tx);
          }
          nextRefFiscalYear = newFiscalYear;
        }
      }
      if (refChanged) {
        await DocumentRefNumberService.assertRefNumberFree(tx, {
          docType: existingDoc.type, refFiscalYear: nextRefFiscalYear ?? currentFiscalYear, refNumber: String(nextRefNumber), excludeDocumentId: id,
        });
      }

      // v9.0.273 (TD-788، تصمیم ت۱۰ الف): پیش‌نویس برگشتِ دارای فاکتور مرجع هم ارز، نرخ و قیمت خالص را از همان فاکتور می‌گیرد
      const returnTerms = existingDoc.type === 'return' && existingDoc.returnOfDocumentId
        ? await enforceReturnInvoiceTerms(tx, Number(existingDoc.returnOfDocumentId), {
          currency, rate: body, lines: Array.isArray(docLines) ? docLines : null,
        })
        : null;
      const lines = returnTerms?.lines ?? docLines;
      const docCurrency = returnTerms?.currency ?? (currency || existingDoc.currency);

      // v7.0.32 (TD-197 / audit P1-7): مالیات ساختاریافته پیش‌فاکتور/پیش‌نویس در ویرایش نیز ذخیره می‌شود؛
      // اگر فقط درصد داده شود یا اقلام تغییر کند، مبلغ از جمع خالص اقلام جدید (یا فعلی) دوباره محاسبه می‌شود.
      const vatInput = parseVatInput(body);
      const linesChanged = Array.isArray(lines);
      let vatLines: Array<{ quantity: unknown; unitPrice?: unknown; unit_price?: unknown; price?: unknown; discount?: unknown }> = linesChanged ? lines! : [];
      if (!linesChanged && vatInput.vatPercent !== undefined) {
        vatLines = await tx.select({ quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
          .from(documentItems)
          .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));
      }
      // v9.0.274 (TD-774): پیش‌نویس برگشتِ دارای فاکتور مرجع مالیات را به نسبت از فاکتور می‌گیرد (ردیف‌های تازه یا ذخیره‌شده)
      if (returnTerms && !linesChanged) {
        vatLines = await tx.select({ quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
          .from(documentItems)
          .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));
      }
      const docVat = returnTerms
        ? await resolveReturnVatFromInvoice(tx, {
          invoiceId: Number(existingDoc.returnOfDocumentId), returnId: id, lines: vatLines, input: body, currency: docCurrency,
        })
        : resolveDocumentVat({
          docType: existingDoc.type,
          input: body,
          lines: vatLines,
          existing: { vatPercent: Number(existingDoc.vatPercent) || 0, vatAmount: existingDoc.vatAmount },
          linesChanged,
          currency: docCurrency,
        });

      // v7.0.63 (TD-198): نرخ تسعیر ساختاریافته؛ برای ارز غیرریالی الزامی (ورودی یا نرخ ذخیره‌شده)
      const docExchangeRate = resolveDocumentExchangeRate({
        currency: docCurrency,
        input: returnTerms ? { exchangeRate: returnTerms.exchangeRate } : body,
        existing: existingDoc.exchangeRate,
      });

      // v9.0.336 (TD-778، تصمیم ت۶ الف): طرف حساب با شناسه؛ بی شناسه و با نام تازه دوباره یافته می‌شود، وگرنه همان می‌ماند.
      // برگشت با فاکتور مرجع طرف حساب همان فاکتور را نگه می‌دارد
      const returnInvoiceId = existingDoc.type === 'return' && existingDoc.returnOfDocumentId ? Number(existingDoc.returnOfDocumentId) : null;
      const nameChanged = buyer_name !== undefined && buyer_name !== existingDoc.buyerName;
      const party = requestedPartyId !== undefined || nameChanged
        ? await resolveDocumentParty(tx, {
          docType: existingDoc.type,
          partyId: requestedPartyId === undefined && returnInvoiceId !== null ? await returnInvoicePartyId(tx, returnInvoiceId) : requestedPartyId,
          // شناسه تازه بی نام: نام طرف حساب تازه، نه نام طرف حساب پیشین
          buyerName: buyer_name ?? (requestedPartyId ? '' : existingDoc.buyerName ?? ''),
        })
        : { partyId: existingDoc.partyId ?? null, buyerName: existingDoc.buyerName ?? '' };
      if (returnInvoiceId !== null && requestedPartyId !== undefined) await assertReturnPartyOfInvoice(tx, returnInvoiceId, party.partyId);

      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      const storedAttachments = body.attachments !== undefined
        ? await AttachmentStorageService.normalizeForRecord(tx, 'document', id, body.attachments, user || existingDoc.user || '')
        : (existingDoc.attachments || []);

      // Atomic update with OCC WHERE clause to guarantee no concurrent modification slipped through
      const [updatedDoc] = await tx.update(documents).set({
        refNumber: nextRefNumber,
        ...(nextRefFiscalYear !== undefined ? { refFiscalYear: nextRefFiscalYear } : {}),
        date: newDocDate ?? existingDoc.date,
        user: user || existingDoc.user,
        notes: notes !== undefined ? notes : existingDoc.notes,
        partyId: party.partyId,
        buyerName: party.buyerName,
        buyerCity: buyer_city !== undefined ? buyer_city : existingDoc.buyerCity,
        buyerPhone: buyer_phone !== undefined ? buyer_phone : existingDoc.buyerPhone,
        buyerAddress: buyer_address !== undefined ? buyer_address : existingDoc.buyerAddress,
        status: status || existingDoc.status,
        currency: docCurrency,
        exchangeRate: docExchangeRate,
        vatPercent: docVat.vatPercent,
        vatAmount: docVat.vatAmount,
        attachments: storedAttachments,
        version: newVer
      }).where(and(eq(documents.id, id), eq(documents.version, existingDoc.version)))
        .returning({ id: documents.id, version: documents.version });

      if (!updatedDoc) {
        throw new OptimisticLockError({
          entityType: 'Document',
          entityId: id,
          expectedVersion: existingDoc.version,
          message: `سند #${id} به دلیل ویرایش همزمان توسط کاربر دیگر تغییر یافته است.`
        });
      }

      if (Array.isArray(lines)) {
        // V6.0.21 (TD-157): Soft-delete old line items instead of physical hard delete (RULE 09)
        await tx.update(documentItems).set({ isDeleted: 1 }).where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));

        const docLocation = location ? String(location).trim() : '';
        const resolveWh = await createWarehouseResolver(tx);

        const lineRows: DocumentLineRow[] = [];
        for (const item of lines) {
          const { itemId, quantity, unit_price, unitPrice, discount, location: itemLoc } = item;
          const price = unit_price ?? unitPrice ?? 0;
          const disc = discount || 0;
          const qty = Number(quantity);
          const targetLoc = resolveWh(itemLoc || docLocation || '');

          if (!Number.isFinite(qty) || qty <= 0) {
            throw new ValidationError(`مقدار/تعداد برای کالای با شناسه ${itemId} باید عددی بزرگ‌تر از صفر باشد.`);
          }
          if (!Number.isFinite(Number(price)) || Number(price) < 0) {
            throw new ValidationError(`قیمت واحد برای کالای با شناسه ${itemId} نمی‌تواند منفی یا نامعتبر باشد.`);
          }

          lineRows.push({
            documentId: id,
            itemId: Number(itemId),
            quantity: qty,
            unitPrice: money(price),
            discount: money(disc),
            location: targetLoc
          });
        }
        await insertDocumentLines(tx, lineRows);
      }

      if (leadLock) {
        await applyDocumentLeadLink(tx, { id, refNumber: nextRefNumber, isProforma: leadDocIsProforma }, leadLock, user || existingDoc.user || 'سیستم');
      }
      return { before, after: await documentAuditSnapshot(tx, id) };
    };
    return externalTx ? execute(externalTx) : orm.transaction(execute);
  }

  /**
   * Creates a new document and applies associated inventory changes.
   */
  static async createDocument(body: CreateDocumentInput): Promise<number> {
    return (await DocumentCreationService.createDocumentWithDetails(body)).docId;
  }

  /**
   * همان createDocument به‌همراه نتیجه کسر رزرو پروژه. v7.0.102 (TD-233، تصمیم مالک محصول «کسر در سرور»): رزرو پروژه
   * در همان تراکنش حواله خروج نهایی کم می‌شود و اگر کسر شکست بخورد، سند ثبت نمی‌شود.
   */
  static async createDocumentWithDetails(
    body: CreateDocumentInput,
    actor: { userId?: number; allowBackdate?: boolean } = {}
  ): Promise<{ docId: number; projectReservation: ProjectReservationRelease | null }> {
    const { 
      docType: rawDocType, type: rawType, refNumber, date, items: docLines, user, inOut,
      buyer_name, buyerName, buyer_city, buyerCity, buyer_phone, buyerPhone, buyer_address, buyerAddress,
      status, notes, location, currency, externalTx
    } = body;

    const docType = rawDocType || rawType || 'invoice';
    // v9.0.238 (TD-770، تصمیم ت۲ الف): جهت گردش فقط از نوع سند؛ `inOut` ناسازگار ۴۲۲، انتقال پذیرفته نمی‌شود و نوع ناشناخته
    // ردیف نمی‌گیرد. پیش‌تر «رسید» با `inOut: out` کالا را خارج و سند حسابداری خرید صادر می‌کرد، و `transfer` بی ردیف مقصد خارج می‌کرد
    assertRecordableDocument(docType, inOut);
    // P0-02 (F17 & ACC-03): تعیین امن وضعیت سند؛ پیش‌فاکتور هرگز نباید به عنوان سند نهایی ثبت شود
    const docStatus = status || (docType === 'proforma' ? 'proforma' : 'final');
    assertDocumentStatus(docStatus);

    if (docType === 'proforma' && docStatus === 'final') {
      throw new ValidationError('پیش‌فاکتور نمی‌تواند مستقیماً با وضعیت نهایی (final) صادر شود. لطفاً پیش‌فاکتور را صادر کرده و سپس از طریق فرآیند نهایی‌سازی اقدام فرمایید.');
    }
    // v8.0.3 (TD-263): انبارگردانی موجودی را هنگام ثبت اصلاح می‌کند، پس فقط نهایی ثبت می‌شود. پیش‌تر انبارگردانی
    // «پیش‌نویس» هم موجودی را عوض می‌کرد و نهایی‌سازی بعدی کل مقدار شمارش‌شده را یک بار دیگر از انبار خارج می‌کرد.
    if (docType === 'audit' && docStatus !== 'final') {
      throw new ValidationError('سند انبارگردانی فقط با وضعیت نهایی ثبت می‌شود؛ پیش‌نویس یا پیش‌فاکتور انبارگردانی مجاز نیست.');
    }
    const docLocation = location ? String(location).trim() : '';
    // v8.0.50 (TD-313): تاریخ سند پیش از هر کاری نرمال و اعتبارسنجی می‌شود؛ سال شماره‌گذاری و گردش انبار از همین مقدار
    const normalizedDocDate = await resolveDocumentTimestamp(date, 'سند');

    // V3.1.46 (TD-070): لینک رسمی سند به پروژه — اعتبارسنجی وجود پروژه پیش از درج (FK انسانی)
    const rawProjectId = body.projectId ?? body.project_id;
    let finalProjectId: number | null = null;
    if (rawProjectId !== undefined && rawProjectId !== null && String(rawProjectId).trim() !== '') {
      finalProjectId = Number(rawProjectId);
      if (isNaN(finalProjectId) || finalProjectId <= 0) {
        throw new ValidationError(`شناسه پروژه (projectId) نامعتبر است: ${rawProjectId}`);
      }
    }

    // v7.0.81 (TD-230): پیوند برگشت از فروش به فاکتور فروش اصلی
    const returnOfDocumentId = parseReturnOfDocumentId(body.returnOfDocumentId ?? body.return_of_document_id);
    if (returnOfDocumentId !== null && docType !== 'return') {
      throw new ValidationError('فاکتور مرجع فقط برای سند برگشت از فروش قابل ثبت است.');
    }

    // v7.0.103 (TD-191): هزینه ارسال و کارمزد فقط روی فاکتور فروش، نامنفی
    const serviceChargeAmount = fin(body.serviceChargeAmount ?? 0);
    if (!serviceChargeAmount.isZero()) {
      if (!VAT_DOC_TYPES.has(docType)) {
        throw new ValidationError('هزینه ارسال و خدمات فقط روی فاکتور فروش ثبت می‌شود.');
      }
      if (serviceChargeAmount.isNegative()) {
        throw new ValidationError(`هزینه ارسال و خدمات نمی‌تواند منفی باشد (مقدار دریافتی: ${serviceChargeAmount.toString()}).`);
      }
    }

    // v8.0.103 (TD-380): تخفیف هر ردیف حداکثر برابر مبلغ همان ردیف
    assertLineDiscountsWithinAmount(docLines);

    const finalBuyerName = buyerName || buyer_name || '';
    const requestedPartyId = parseDocumentPartyId(body.partyId);
    const finalBuyerCity = buyerCity || buyer_city || '';
    const finalBuyerPhone = buyerPhone || buyer_phone || '';
    const finalBuyerAddress = buyerAddress || buyer_address || '';

    let projectReservation: ProjectReservationRelease | null = null;

    const execute = async (tx: DbClient): Promise<number> => {
      // v8.0.67 (TD-320): کالاهای سند نهایی پیش از شماره سند و هر نوشتن دیگر، یک‌جا و به ترتیب صعودی شناسه قفل می‌شوند
      // (همان ترتیب نهایی‌سازی و ابطال)؛ پیش‌تر رسید کالاها را به ترتیب سطرها قفل می‌کرد و با فاکتور یا ابطالِ همان
      // کالاها به ترتیب دیگر به بن‌بست می‌رسید
      if (docStatus === 'final') await lockStockItems(tx, (docLines || []).map(l => l.itemId));
      if (finalProjectId !== null) {
        const [projExists] = await tx
          .select({ id: productionProjects.id })
          .from(productionProjects)
          .where(and(eq(productionProjects.id, finalProjectId), eq(productionProjects.isDeleted, 0)));
        if (!projExists) {
          throw new NotFoundError(`پروژه با شناسه ${finalProjectId} یافت نشد.`);
        }
        // v10.0.184 (TD-921): سند تازه روی پروژه لغوشده ثبت نمی‌شود
        await assertProjectNotCancelled(tx, finalProjectId, 'سند');
      }
      // v7.0.21 (TD-178 / audit P0-2): شماره عطف و سال مالی پارتیشن شماره‌گذاری؛ از v9.0.80 (TD-489) در
      // DocumentRefNumberService.assignDocumentRefNumber، مشترک با حواله انتقال بین انبارها
      const { refNumber: finalRefNumber, refFiscalYear } = await DocumentRefNumberService.assignDocumentRefNumber(
        tx, docType, normalizedDocDate, refNumber
      );

      // v7.0.32 (TD-197 / audit P1-7): مالیات بر ارزش افزوده در ستون‌های ساختاریافته ذخیره می‌شود و دیگر در متن
      // یادداشت نوشته/از آن خوانده نمی‌شود (پیش‌تر سند حسابداری مبلغ مالیات را با Regex از یادداشت استخراج می‌کرد).
      const finalNotes = notes || '';
      // v9.0.273 (TD-788، تصمیم ت۱۰ الف): برگشت با فاکتور مرجع ارز، نرخ و قیمت خالص هر واحد را از همان فاکتور می‌گیرد؛
      // مقدار دیگر در بدنه ۴۲۲. فاکتور نهایی دیگر عوض نمی‌شود و ابطالش با برگشت زنده رد می‌شود (TD-773)، پس خواندن بی قفل بس است
      const returnTerms = returnOfDocumentId !== null
        ? await enforceReturnInvoiceTerms(tx, returnOfDocumentId, { currency, rate: body, lines: docLines || [] })
        : null;
      const docCurrency = returnTerms?.currency ?? (currency || 'IRR');
      const lines = returnTerms?.lines ?? docLines;
      // v8.0.8 (TD-253): برگشت نهایی با فاکتور مرجع از مانده قابل برگشت همان فاکتور بیشتر نمی‌شود؛ از v9.0.274 (TD-774) پیش از
      // مالیات، چون قفل فاکتور برگشت‌های هم‌زمان را پشت سر هم می‌گذارد و مالیات هر برگشت از خالص برگشت‌های نهایی قبلی است
      if (returnOfDocumentId !== null && docStatus === 'final') await assertReturnWithinSold(tx, returnOfDocumentId, lines);
      // v9.0.274 (TD-774، تصمیم ت۵ الف): مالیات برگشتِ دارای فاکتور مرجع به نسبت از مالیات همان فاکتور
      const docVat = returnOfDocumentId !== null
        ? await resolveReturnVatFromInvoice(tx, { invoiceId: returnOfDocumentId, returnId: null, lines, input: body, currency: docCurrency })
        : resolveDocumentVat({ docType, input: body, lines: lines || [], currency: docCurrency });
      const docExchangeRate = resolveDocumentExchangeRate({
        currency: docCurrency,
        input: returnTerms ? { exchangeRate: returnTerms.exchangeRate } : body,
      });
      // v9.0.336 (TD-778، تصمیم ت۶ الف): طرف حساب با شناسه؛ برگشت با فاکتور مرجع طرف حساب همان فاکتور را می‌گیرد
      const party = await resolveDocumentParty(tx, {
        docType,
        partyId: requestedPartyId === undefined && returnOfDocumentId !== null
          ? await returnInvoicePartyId(tx, returnOfDocumentId)
          : requestedPartyId,
        buyerName: finalBuyerName,
      });
      if (returnOfDocumentId !== null && requestedPartyId !== undefined) {
        await assertReturnPartyOfInvoice(tx, returnOfDocumentId, party.partyId);
      }

      const [insertedDoc] = await tx.insert(documents).values({
        type: docType,
        refNumber: String(finalRefNumber),
        refFiscalYear,
        date: normalizedDocDate,
        user,
        notes: finalNotes,
        partyId: party.partyId,
        buyerName: party.buyerName,
        buyerCity: finalBuyerCity,
        buyerPhone: finalBuyerPhone,
        buyerAddress: finalBuyerAddress,
        status: docStatus,
        currency: docCurrency,
        exchangeRate: docExchangeRate,
        vatPercent: docVat.vatPercent,
        vatAmount: docVat.vatAmount,
        serviceChargeAmount: money(serviceChargeAmount),
        attachments: [],
        projectId: finalProjectId ?? undefined,
        returnOfDocumentId,
        // v9.0.323 (TD-776): پیوند پرونده فروش همراه درج سند (route پرونده را پیش از سند قفل و سنجیده است)
        crmLeadId: documentLeadLinkOf(body.crmLeadId) ?? undefined,
        isDeleted: 0
      }).returning({ id: documents.id });
      const docId = insertedDoc.id;
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      await AttachmentStorageService.attachToNewRecord(tx, 'document', docId, body.attachments, user || '');

      if (docType === 'audit') {
        // H-06 & TD-159: اخذ قفل سطری ردیف‌های کالا بر اساس شناسه مرتب‌شده جهت جلوگیری از بن‌بست همروندی (Deadlock)
        const sortedAuditItemIds = sortIdsForLocking(docLines.map(l => Number(l.itemId)).filter(id => !isNaN(id) && id > 0));
        const lockedAuditItems = await tx
          .select({
            id: items.id,
            code: items.code,
            name: items.name,
            weightedAverageCost: items.weightedAverageCost,
            currentStock: items.currentStock,
          })
          .from(items)
          .where(and(inArray(items.id, sortedAuditItemIds), eq(items.isDeleted, 0)))
          .for('no key update');
        const auditItemMap = new Map(lockedAuditItems.map(it => [it.id, it]));
        // v7.0.45 (audit P2-1): موجودی ثبت‌شده هر انبار از جدول موجودی انبارها (منبع حقیقت)
        const auditStockMap = await ItemWarehouseStockService.getStocksForItems(tx, sortedAuditItemIds);

        // TD-164: حذف کوئری‌های تکراری N+1 انبار در حلقه انبارگردانی
        const resolveWh = await createWarehouseResolver(tx);

        // v9.0.324 (TD-777): هر ردیف شمارش دارد و هر (کالا، انبار) یک ردیف؛ پیش از هر گردش انبار
        assertStockCountLines(docLines.map(line => {
          const target = auditItemMap.get(Number(line.itemId));
          return {
            itemId: Number(line.itemId),
            code: target?.code ?? String(line.itemId),
            name: target?.name ?? String(line.itemId),
            location: resolveWh(line.location || docLocation || ''),
            physical: line.physical_stock,
          };
        }));

        // v9.0.55 (TD-480، تصمیم ت۷ الف): موجودی دفتری‌ای که برگه نشان داده (`system_stock`) زیر قفل کالاها با موجودی
        // همین لحظه سنجیده می‌شود؛ اگر فرق کند ثبت ۴۰۹ می‌گیرد و هیچ گردشی ثبت نمی‌شود
        assertBookStocksUnchanged(docLines.map(line => {
          const target = auditItemMap.get(Number(line.itemId));
          const loc = resolveWh(line.location || docLocation || '');
          return {
            itemId: Number(line.itemId),
            code: target?.code ?? String(line.itemId),
            name: target?.name ?? String(line.itemId),
            shown: line.system_stock,
            current: auditStockMap.get(Number(line.itemId))?.byCode[loc] ?? 0,
          };
        }));

        const auditLineRows: DocumentLineRow[] = [];
        for (const item of docLines) {
          const { itemId, physical_stock, location: itemLoc } = item;
          const targetLoc = resolveWh(itemLoc || docLocation || '');
          const targetItem = auditItemMap.get(Number(itemId));

          // P1-04 (H-05): محاسبه انحراف انبارگردانی در سمت سرور بر مبنای موجودی ثبت‌شده واقعی در پایگاه‌داده تحت قفل
          // v7.0.45 (audit P2-1): موجودی همین انبار از جدول نرمال؛ انبار بدون ردیف یعنی صفر. پیش‌تر اگر JSONB کلیدی
          // برای این انبار نداشت، موجودی کل کالا (همه انبارها) مبنای انحراف قرار می‌گرفت.
          const dbStock = auditStockMap.get(Number(itemId))?.byCode[targetLoc] ?? 0;

          const physicalQty = Number(physical_stock || 0);
          const variance = physicalQty - dbStock;

          auditLineRows.push({
            documentId: docId,
            itemId: Number(itemId),
            quantity: physicalQty,
            unitPrice: money(0),
            discount: money(0),
            location: targetLoc
          });

          if (variance !== 0) {
            const txType = variance > 0 ? 'in' : 'out';
            const absVariance = Math.abs(variance);
            const txNotes = variance > 0 ? 'اضافی انبارگردانی دوره‌ای' : 'کسری انبارگردانی دوره‌ای';

            // v8.0.3 (TD-255، تصمیم مالک محصول): کسری و اضافی با WAC کالا ارزش‌گذاری می‌شود؛ کالای بدون WAC با بهای صفر.
            // پیش‌تر اضافی کالای بدون WAC با قیمت فهرست فروش وارد انبار می‌شد و WAC را برابر قیمت فروش می‌کرد.
            const auditMovementPrice = fin(targetItem?.weightedAverageCost);

            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: Number(itemId),
              documentId: docId,
              inOut: txType,
              quantity: absVariance,
              price: auditMovementPrice.isPositive() ? auditMovementPrice : fin(0),
              date: normalizedDocDate,
              documentType: 'audit',
              documentRef: String(finalRefNumber),
              user: user || 'system',
              notes: txNotes,
              targetLoc,
              allowBackdate: actor.allowBackdate === true,
            });
          }
        }
        await insertDocumentLines(tx, auditLineRows);
      } else {
        // TD-164: ایجاد حل‌کننده انبار قبل از ورود به حلقه‌ها
        const resolveWh = await createWarehouseResolver(tx);

        // V6 Sub-phase 2.4 (TD-139) & P1-05 (H-02): گیت رزرویشن Fail-Closed در تراکنش خروج قطعی. v9.0.239 (TD-775): با جهت
        // نوع سند (نه `inOut` بدنه) و جمع مقدار هر (کالا، انبار)، همان تابع نهایی‌سازی (documentSellableGate.ts)
        const stockDirection = stockDirectionOf(docType);
        if (docStatus === 'final' && stockDirection === 'out') {
          await assertOutflowWithinSellable(tx, lines, {
            docLocation,
            excludeDocumentId: body.excludeDocumentId ? Number(body.excludeDocumentId) : null,
            projectId: finalProjectId,
          });
        }

        // v7.0.81 (TD-230، تصمیم مالک محصول): کالای برگشت از فروش با بهای خروج فاکتور اصلی (یا WAC جاری بدون فاکتور
        // مرجع) وارد انبار می‌شود، نه با قیمت فروش
        let returnUnitCosts: Map<number, FinancialDecimal> | null = null;
        if (docType === 'return' && docStatus === 'final') {
          returnUnitCosts = await resolveSalesReturnUnitCosts(tx, returnOfDocumentId, lines.map(l => Number(l.itemId)));
        }

        const linePriceOf = (item: (typeof lines)[number]) => {
          const { unit_price, price: directPrice, unitPrice: camelUnitPrice } = item;
          return unit_price !== undefined ? unit_price : (camelUnitPrice !== undefined ? camelUnitPrice : (directPrice || 0));
        };
        // v7.0.69 (TD-227): قیمت سند ارزی با نرخ تسعیر سند به ریال تبدیل می‌شود (WAC ریالی است)
        // v8.0.9 (TD-250): ورود با قیمت خالص پس از تخفیف ردیف (همان مبلغ سند حسابداری خرید)
        const stockUnitPriceOf = (item: (typeof lines)[number]) => {
          const price = linePriceOf(item);
          return returnUnitCosts?.get(Number(item.itemId)) ?? stockUnitPriceInIrr(
            stockDirection === 'in' ? netLineUnitPrice(price, Number(item.quantity), item.discount || 0) : price, docCurrency, docExchangeRate);
        };
        // v9.0.453 (TD-906 / TD-916، تصمیم ت۲ الف): کالای بی میانگین موزون بها با بهای صفر وارد انبار نمی‌شود
        if (docStatus === 'final' && stockDirection === 'in') {
          await assertIncomingLinesHaveCost(tx, docType, lines.map(item => ({ itemId: item.itemId, unitCostIrr: stockUnitPriceOf(item) })));
        }

        const lineRows: DocumentLineRow[] = [];
        for (const item of lines) {
          const { itemId, quantity, discount, location: itemLoc } = item;
          const price = linePriceOf(item);
          const disc = discount || 0;
          const qty = Number(quantity);
          const targetLoc = resolveWh(itemLoc || docLocation || '');

          if (docStatus === 'final') {
            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: Number(itemId),
              documentId: docId,
              inOut: stockDirection,
              quantity: qty,
              price: stockUnitPriceOf(item),
              date: normalizedDocDate,
              documentType: docType,
              documentRef: String(finalRefNumber || ''),
              user: user || '',
              targetLoc,
              // v8.0.4 (TD-257): مجوز تاریخ گذشته فقط از actor (بررسی مجوز در مسیر)، هرگز از بدنه درخواست
              allowBackdate: actor.allowBackdate === true,
            });
          }

          lineRows.push({
            documentId: docId,
            itemId: Number(itemId),
            quantity: qty,
            unitPrice: money(price),
            discount: money(disc),
            location: targetLoc
          });
        }
        await insertDocumentLines(tx, lineRows);

        // v7.0.102 (TD-233): کسر رزرو پروژه در همان تراکنش خروج قطعی؛ خطا کل سند را برمی‌گرداند
        if (docStatus === 'final' && stockDirection === 'out' && finalProjectId !== null) {
          projectReservation = await releaseReservationsForDocument(tx, finalProjectId, docId, lines, user, actor.userId);
        }
      }

      // Phase 12 - Transactional Outbox (Guarantees atomic event persistence with document creation)
      const isApproved = docStatus === 'final';
      if (docType === 'invoice' || docType === 'proforma') {
        const invEvent = domainEventBus.createEvent<InvoiceEventPayload>(
          isApproved ? DomainEventType.INVOICE_APPROVED : DomainEventType.INVOICE_CREATED,
          'Document',
          String(docId),
          {
            documentId: docId,
            refNumber: String(finalRefNumber),
            docType,
            // v9.0.407 (TD-713): the payable amount of the stored document (the event used to carry no amount)
            ...await documentEventAmounts(tx, docId),
            // v9.0.337 (TD-785): نام ذخیره‌شده خریدار (پیش‌تر فقط `buyer_name`؛ با `buyerName` یا شناسه طرف حساب خالی بود)
            buyerName: party.buyerName || '',
            currency: docCurrency,
            itemCount: docLines?.length || 0,
            status: docStatus
          },
          { userName: user }
        );
        await OutboxService.saveToOutbox(tx, invEvent);
      } else if (docType === 'receipt' || docType === 'purchase') {
        // v10.0.29 (TD-942): a production receipt (project delivery) is not a purchase and publishes no purchase event with an
        // empty supplier; its stock entry is published as StockReceived by the stock engine
        const purchEvent = domainEventBus.createEvent<PurchaseEventPayload>(
          isApproved ? DomainEventType.PURCHASE_APPROVED : DomainEventType.PURCHASE_CREATED,
          'Document',
          String(docId),
          {
            documentId: docId,
            refNumber: String(finalRefNumber),
            ...await documentEventAmounts(tx, docId),
            supplierName: party.buyerName || '',
            currency: docCurrency,
            itemCount: docLines?.length || 0,
            status: docStatus
          },
          { userName: user }
        );
        await OutboxService.saveToOutbox(tx, purchEvent);
      }

      if (docStatus === 'final' && !body.skipVoucherSync) {
        const isStrict = body.strict !== false;
        if (docType === 'invoice' || docType === 'proforma') {
          // مبلغ مالیات از ستون ذخیره‌شده vat_amount همین سند خوانده می‌شود (TD-197)
          await VoucherSyncService.syncSalesInvoiceVoucher(docId, {
            username: user,
            strict: isStrict,
          }, tx);
        } else if (['receipt', 'production_receipt', 'purchase'].includes(docType)) {
          await VoucherSyncService.syncPurchaseInvoiceVoucher(docId, { username: user, strict: isStrict }, tx);
        } else if (['remittance', 'waste', 'return'].includes(docType)) {
          await VoucherSyncService.syncWarehouseDocumentVoucher(docId, { username: user, strict: isStrict }, tx);
        } else if (docType === 'audit') {
          // v8.0.3 (TD-255): کسری/اضافی انبارگردانی با بهای کاردکس به «کسری و اضافات انبار» (سند پیش‌نویس)
          await syncStockAdjustmentVoucher({
            documentId: docId,
            date: normalizedDocDate.slice(0, 10),
            refNumber: String(finalRefNumber),
            description: `انبارگردانی شماره ${finalRefNumber}`,
            userId: actor.userId,
            username: user,
          }, tx);
        }
      }

      return docId;
    };

    // V9-P0: پشتیبانی از تراکنش خارجی (externalTx) برای اجرای اتمیک در تراکنش فراخواننده
    const docId = externalTx ? await execute(externalTx) : await orm.transaction(execute);
    return { docId, projectReservation };
  }
}
