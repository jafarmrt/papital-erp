import { sql, eq, and, desc, inArray, gte, lte, or, ilike } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, documentItems, items, transactions, treasuryTransactions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { MAX_PAGE_LIMIT } from '../../lib/pagination.js';
import { NotFoundError } from '../../errors/customErrors.js';
import type { 
  GetDocumentsFilter, 
  FormattedDocument, 
  FormattedDocumentItem, 
  PaginatedDocumentsResult 
} from './types.js';

export class DocumentQueryService {
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
      unit_price: number | null;
      discount: number | null;
      location: string | null;
      name: string | null;
      code: string | null;
      unit: string | null;
      category: string | null;
    }> = [];
    let treasurySettlements: Array<{
      documentId: number | null;
      amount: number;
      type: string;
      status: string | null;
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

      // v7.0.32 (TD-197): مبلغ قابل وصول = جمع خالص اقلام + مالیات ساختاریافته (همان بدهکار مشتری در سند حسابداری)
      const vatAmount = Number(d.vatAmount) || 0;
      const payableAmount = fin(totalAmount).add(vatAmount).toNumber();
      const safePaidAmount = Math.max(0, paidAmount);
      const remainingAmount = Math.max(0, fin(payableAmount).subtract(safePaidAmount).toNumber());
      let settlementStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';

      if (payableAmount > 0 && safePaidAmount >= payableAmount - 0.01) {
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
        vatPercent: Number(d.vatPercent) || 0,
        vatAmount,
        payableAmount,
        paidAmount: safePaidAmount,
        remainingAmount,
        settlementStatus,
        items: dItems.map(i => ({
          ...i,
          unit_price: Number(i.unit_price || 0),
          discount: Number(i.discount || 0),
          location: i.location || ''
        }))
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

    // v7.0.32 (TD-197): مبلغ قابل وصول = جمع خالص اقلام + مالیات ساختاریافته
    const vatAmount = Number(doc.vatAmount) || 0;
    const payableAmount = fin(totalCalculated).add(vatAmount).toNumber();
    const safePaidAmount = Math.max(0, paidAmount);
    const remainingAmount = Math.max(0, fin(payableAmount).subtract(safePaidAmount).toNumber());
    let settlementStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';

    if (payableAmount > 0 && safePaidAmount >= payableAmount - 0.01) {
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
      vatPercent: Number(doc.vatPercent) || 0,
      vat_percent: Number(doc.vatPercent) || 0,
      vatAmount,
      vat_amount: vatAmount,
      payableAmount,
      payable_amount: payableAmount,
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
      vatAmount: doc.vatAmount ?? 0,
      payableAmount: doc.payableAmount ?? doc.totalAmount,
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
}
