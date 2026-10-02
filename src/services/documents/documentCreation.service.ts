import { eq, and, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, documentItems, items, itemPrices, documentRefCounters, productionProjects } from '../../db/schema.js';
import { normalizeDateToDbTimestamp } from '../../utils.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { createWarehouseResolver } from '../inventory/warehouseResolver.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { sortIdsForLocking } from '../../lib/lockOrder.js';
import { DocumentRefNumberService, MAX_REF_COUNTER_VALUE, extractRefSerial } from './documentRefNumber.service.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';
import { DocumentStockEngine } from './documentStockEngine.service.js';
import { resolveDocumentVat, parseVatInput } from './documentVat.js';
import type { DbClient, CreateDocumentInput, UpdateDocumentInput } from './types.js';
import { AttachmentStorageService } from '../attachments/attachmentStorage.service.js';

export class DocumentCreationService {
  /**
   * Updates the notes of a specific document.
   */
  static async updateDocumentNotes(id: number, notes: string): Promise<void> {
    await orm.transaction(async (tx) => {
      const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.isDeleted, 0))).for('update');
      if (!doc) throw new NotFoundError('سند مورد نظر یافت نشد.');
      await tx.update(documents).set({ notes, version: nextVersion(doc.version) }).where(eq(documents.id, id));
    });
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

    await orm.transaction(async (tx) => {
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

      const newVer = nextVersion(existingDoc.version);

      // v7.0.32 (TD-197 / audit P1-7): مالیات ساختاریافته پیش‌فاکتور/پیش‌نویس در ویرایش نیز ذخیره می‌شود؛
      // اگر فقط درصد داده شود یا اقلام تغییر کند، مبلغ از جمع خالص اقلام جدید (یا فعلی) دوباره محاسبه می‌شود.
      const vatInput = parseVatInput(body);
      const linesChanged = Array.isArray(docLines);
      let vatLines: Array<{ quantity: unknown; unitPrice?: unknown; unit_price?: unknown; price?: unknown; discount?: unknown }> = linesChanged ? docLines! : [];
      if (!linesChanged && vatInput.vatAmount === undefined && vatInput.vatPercent !== undefined) {
        vatLines = await tx.select({ quantity: documentItems.quantity, unitPrice: documentItems.unitPrice, discount: documentItems.discount })
          .from(documentItems)
          .where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));
      }
      const docVat = resolveDocumentVat({
        docType: existingDoc.type,
        input: body,
        lines: vatLines,
        existing: { vatPercent: Number(existingDoc.vatPercent) || 0, vatAmount: Number(existingDoc.vatAmount) || 0 },
        linesChanged,
      });

      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      const storedAttachments = body.attachments !== undefined
        ? await AttachmentStorageService.normalizeForRecord(tx, 'document', id, body.attachments, user || existingDoc.user || '')
        : (existingDoc.attachments || []);

      // Atomic update with OCC WHERE clause to guarantee no concurrent modification slipped through
      const [updatedDoc] = await tx.update(documents).set({
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

      if (Array.isArray(docLines)) {
        // V6.0.21 (TD-157): Soft-delete old line items instead of physical hard delete (RULE 09)
        await tx.update(documentItems).set({ isDeleted: 1 }).where(and(eq(documentItems.documentId, id), eq(documentItems.isDeleted, 0)));

        const docLocation = location ? String(location).trim() : '';
        const resolveWh = await createWarehouseResolver(tx);

        for (const item of docLines) {
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
   * Creates a new document and applies associated inventory changes.
   */
  static async createDocument(body: CreateDocumentInput): Promise<number> {
    const { 
      docType: rawDocType, type: rawType, refNumber, date, items: docLines, user, inOut,
      buyer_name, buyerName, buyer_city, buyerCity, buyer_phone, buyerPhone, buyer_address, buyerAddress,
      status, notes, location, currency, externalTx
    } = body;

    const docType = rawDocType || rawType || 'invoice';
    // P0-02 (F17 & ACC-03): تعیین امن وضعیت سند؛ پیش‌فاکتور هرگز نباید به عنوان سند نهایی ثبت شود
    const docStatus = status || (docType === 'proforma' ? 'proforma' : 'final');

    if (docType === 'proforma' && docStatus === 'final') {
      throw new ValidationError('پیش‌فاکتور نمی‌تواند مستقیماً با وضعیت نهایی (final) صادر شود. لطفاً پیش‌فاکتور را صادر کرده و سپس از طریق فرآیند نهایی‌سازی اقدام فرمایید.');
    }
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
      // v7.0.21 (TD-178 / audit P0-2): سال مالی پارتیشن شماره‌گذاری — دقیقاً همان مقداری که
      // DocumentRefNumberService.getNextRef برای همین `date` استفاده می‌کند؛ یکتایی شماره عطف در این دامنه است.
      const refFiscalYear = resolveJalaliFiscalYear(date ?? null);
      let finalRefNumber = refNumber;
      if (!finalRefNumber || finalRefNumber === 'auto' || String(finalRefNumber).trim() === '') {
        finalRefNumber = await DocumentRefNumberService.getNextRef(docType, date, tx);
      } else {
        // V7 Collision Prevention: If custom refNumber already exists in documents, auto-resolve to next valid atomic number
        // v7.0.21 (TD-178): بررسی تکرار فقط در دامنه یکتایی واقعی (نوع سند + سال مالی شماره‌گذاری)
        const [existingDoc] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(
            eq(documents.type, docType),
            eq(documents.refFiscalYear, refFiscalYear),
            eq(documents.refNumber, String(finalRefNumber)),
            eq(documents.isDeleted, 0)
          ));
        if (existingDoc) {
          finalRefNumber = await DocumentRefNumberService.getNextRef(docType, date, tx);
          if (docType === 'audit' && !String(finalRefNumber).startsWith('AUD-')) {
            finalRefNumber = `AUD-${finalRefNumber}`;
          }
        }

        // Sync document_ref_counters with the numeric suffix of a custom refNumber (P3-10)
        const val = extractRefSerial(finalRefNumber);
        if (val !== null) {
          if (val > 0 && val <= MAX_REF_COUNTER_VALUE) {
            // V3.0.6 (BUG-07): کلید شمارنده دستی نیز باید «سال جلالی» باشد؛
            // قبلاً سال میلادی (new Date().getFullYear) استفاده می‌شد و شمارنده
            // دستی روی ردیفی متفاوت از شماره‌گذاری خودکار sync می‌شد.
            const year = refFiscalYear;
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
              const inserted = await tx
                .insert(documentRefCounters)
                .values({ docType, fiscalYear: year, lastRefNumber: val })
                .onConflictDoNothing({
                  target: [documentRefCounters.docType, documentRefCounters.fiscalYear]
                })
                .returning({ lastRefNumber: documentRefCounters.lastRefNumber });
              if (inserted.length === 0) {
                const [retryCounter] = await tx
                  .select()
                  .from(documentRefCounters)
                  .where(and(eq(documentRefCounters.docType, docType), eq(documentRefCounters.fiscalYear, year)))
                  .for('update');
                if (retryCounter && val > retryCounter.lastRefNumber) {
                  await tx
                    .update(documentRefCounters)
                    .set({ lastRefNumber: val })
                    .where(and(eq(documentRefCounters.docType, docType), eq(documentRefCounters.fiscalYear, year)));
                }
              }
            }
          }
        }
      }

      const normalizedDocDate = normalizeDateToDbTimestamp(date);

      // v7.0.32 (TD-197 / audit P1-7): مالیات بر ارزش افزوده در ستون‌های ساختاریافته ذخیره می‌شود و دیگر در متن
      // یادداشت نوشته/از آن خوانده نمی‌شود (پیش‌تر سند حسابداری مبلغ مالیات را با Regex از یادداشت استخراج می‌کرد).
      const finalNotes = notes || '';
      const docVat = resolveDocumentVat({ docType, input: body, lines: docLines || [] });

      const [insertedDoc] = await tx.insert(documents).values({
        type: docType,
        refNumber: String(finalRefNumber),
        refFiscalYear,
        date: normalizedDocDate,
        user,
        notes: finalNotes,
        buyerName: finalBuyerName,
        buyerCity: finalBuyerCity,
        buyerPhone: finalBuyerPhone,
        buyerAddress: finalBuyerAddress,
        status: docStatus,
        currency: currency || 'IRR',
        vatPercent: docVat.vatPercent,
        vatAmount: docVat.vatAmount,
        attachments: [],
        projectId: finalProjectId ?? undefined,
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
            weightedAverageCost: items.weightedAverageCost,
            currentStock: items.currentStock,
          })
          .from(items)
          .where(and(inArray(items.id, sortedAuditItemIds), eq(items.isDeleted, 0)))
          .for('update');
        const auditItemMap = new Map(lockedAuditItems.map(it => [it.id, it]));
        // v7.0.45 (audit P2-1): موجودی ثبت‌شده هر انبار از جدول موجودی انبارها (منبع حقیقت)
        const auditStockMap = await ItemWarehouseStockService.getStocksForItems(tx, sortedAuditItemIds);

        // TD-164: حذف کوئری‌های تکراری N+1 انبار و قیمت در حلقه انبارگردانی
        const resolveWh = await createWarehouseResolver(tx);

        // واکشی دسته‌ای قیمت‌ها برای اقلامی که میانگین موزون ندارند با یک کوئری یکتا
        const missingPriceItemIds = lockedAuditItems
          .filter(it => Number(it.weightedAverageCost || 0) <= 0)
          .map(it => it.id);
        const auditPriceMap = new Map<number, number>();
        if (missingPriceItemIds.length > 0) {
          const priceRows = await tx
            .select({ itemId: itemPrices.itemId, price: itemPrices.price })
            .from(itemPrices)
            .where(and(inArray(itemPrices.itemId, missingPriceItemIds), eq(itemPrices.isDeleted, 0)));
          for (const pr of priceRows) {
            if (!auditPriceMap.has(pr.itemId)) {
              auditPriceMap.set(pr.itemId, Number(pr.price || 0));
            }
          }
        }

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

          await tx.insert(documentItems).values({
            documentId: docId,
            itemId: Number(itemId),
            quantity: physicalQty,
            unitPrice: 0,
            discount: 0,
            location: targetLoc
          });

          if (variance !== 0) {
            const txType = variance > 0 ? 'in' : 'out';
            const absVariance = Math.abs(variance);
            const txNotes = variance > 0 ? 'اضافی انبارگردانی دوره‌ای' : 'کسری انبارگردانی دوره‌ای';

            let auditMovementPrice = Number(targetItem?.weightedAverageCost || 0);
            if (auditMovementPrice <= 0) {
              auditMovementPrice = auditPriceMap.get(Number(itemId)) || 0;
            }

            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: Number(itemId),
              documentId: docId,
              inOut: txType,
              quantity: absVariance,
              price: auditMovementPrice,
              date: normalizedDocDate,
              documentType: 'audit',
              documentRef: String(finalRefNumber),
              user: user || 'system',
              notes: txNotes,
              targetLoc
            });
          }
        }
      } else {
        // TD-164: ایجاد حل‌کننده انبار قبل از ورود به حلقه‌ها
        const resolveWh = await createWarehouseResolver(tx);

        // V6 Sub-phase 2.4 (TD-139) & P1-05 (H-02): گیت رزرویشن Fail-Closed در تراکنش خروج قطعی
        if (docStatus === 'final' && inOut === 'out') {
          const reservationReport = await ItemStockReservationService.getReservedStockDetailsOrThrow(tx);
          const excludeDocId = body.excludeDocumentId ? Number(body.excludeDocumentId) : undefined;

          // H-06 & TD-159: اخذ قفل سطری اقلام خروجی بر اساس ترتیب اکید شناسه‌ها برای ممانعت از Deadlock
          const distinctSortedIds = sortIdsForLocking(
            Array.from(new Set(docLines.map(l => Number(l.itemId)).filter(id => !isNaN(id) && id > 0)))
          );
          const lockedDbItems = await tx
            .select({
              id: items.id,
              code: items.code,
              name: items.name,
              unit: items.unit,
              currentStock: items.currentStock,
            })
            .from(items)
            .where(and(inArray(items.id, distinctSortedIds), eq(items.isDeleted, 0)))
            .for('update');
          const dbItemMap = new Map(lockedDbItems.map(it => [it.id, it]));
          // v7.0.45 (audit P2-1): موجودی انبارها از جدول نرمال (منبع حقیقت)، نه کش JSONB
          const tableStockMap = await ItemWarehouseStockService.getStocksForItems(tx, distinctSortedIds);

          for (const item of docLines) {
            const itId = Number(item.itemId);
            const reqQty = Number(item.quantity || 0);
            if (reqQty <= 0) continue;

            const targetLoc = resolveWh(item.location ? String(item.location).trim() : (docLocation || ''));
            const dbItem = dbItemMap.get(itId);

            if (!dbItem) {
              throw new NotFoundError(`کالا با شناسه ${itId} در سیستم یافت نشد.`);
            }

            const summary = reservationReport.itemSummaries.find(s => s.itemId === itId);
            const sellableInfo = ItemStockReservationService.computeSellable(
              summary,
              tableStockMap.get(itId)?.byCode ?? {},
              {
                location: targetLoc,
                excludeDocumentId: excludeDocId,
                projectId: finalProjectId,
              }
            );

            if (reqQty > sellableInfo.sellable) {
              const otherReservations = (summary?.reservations || []).filter(
                r => !(r.sourceType === 'proforma' && excludeDocId && Number(r.sourceId) === excludeDocId) &&
                     !(r.sourceType === 'project' && finalProjectId && Number(r.sourceId) === finalProjectId)
              );
              const otherNames = otherReservations.length > 0
                ? ` (${otherReservations.map(r => `«${r.sourceRef || r.sourceTitle}» [${r.reservedQty} ${r.unit}]`).join('، ')})`
                : '';

              throw new ValidationError(
                `امکان خروج بیش از ${sellableInfo.sellable} ${dbItem.unit || 'عدد'} برای کالا «${dbItem.name}» (${dbItem.code}) وجود ندارد. موجودی انبار «${targetLoc}»: ${sellableInfo.locationStock}، رزرو سایر مصارف: ${sellableInfo.reservedForOthers}${otherNames}، قابل فروش: ${sellableInfo.sellable}.`
              );
            }
          }
        }

        for (const item of docLines) {
          const { itemId, quantity, unit_price, discount, location: itemLoc, price: directPrice, unitPrice: camelUnitPrice } = item;
          const price = unit_price !== undefined ? unit_price : (camelUnitPrice !== undefined ? camelUnitPrice : (directPrice || 0));
          const disc = discount || 0;
          const qty = Number(quantity);
          const targetLoc = resolveWh(itemLoc || docLocation || '');

          if (docStatus === 'final') {
            await DocumentStockEngine.applyStockMovement(tx, {
              itemId: Number(itemId),
              documentId: docId,
              inOut: inOut || (docType === 'purchase' || docType === 'receipt' ? 'in' : 'out'),
              quantity: qty,
              price,
              date: date || normalizedDocDate,
              documentType: docType,
              documentRef: String(finalRefNumber || ''),
              user: user || '',
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
}
