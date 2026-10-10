import { sql, eq, and, desc, inArray, gte, lte, or, ilike, isNull } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents, documentItems, items, transactions, treasuryTransactions, warehouses } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { Money } from '../../lib/money.js';
import type { DecimalValue, FinancialDecimal } from '../../lib/financialDecimal.js';
import { MAX_PAGE_LIMIT } from '../../lib/pagination.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { transferLocationsByDocument } from '../inventory/transferDocumentLocations.js';
import { stockCountVariances } from '../inventory/stockCountSheet.js';
import { createLedgerLocationResolver } from '../inventory/warehouseResolver.js';
import { fetchSettlementRows, settledAmount } from './documentSettlement.js';
import type { SettlementRow } from './documentSettlement.js';
import { documentPartyCondition } from './documentParty.js';
import { rejectedWorkflowDocumentIds } from './rejectedDraftDocuments.js';
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
    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(documents.type, filter.types));
    }
    if (filter.buyerName !== undefined) {
      conditions.push(sql`btrim(${documents.buyerName}) = ${filter.buyerName.trim()}::text`);
    }
    if (filter.party) {
      conditions.push(documentPartyCondition(filter.party));
    }
    if (filter.status && filter.status !== 'all') {
      conditions.push(eq(documents.status, filter.status));
    }
    // v10.0.96 (TD-1197): چند وضعیت با هم (پیش‌فاکتورها و پیش‌نویس‌های فروش جعبه «پیش فاکتورهای باز»)
    if (filter.statuses && filter.statuses.length > 0) conditions.push(inArray(documents.status, filter.statuses));
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
      const s = containsLikePattern(filter.search.trim());
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
      unit_price: Money | null;
      discount: Money | null;
      location: string | null;
      name: string | null;
      code: string | null;
      unit: string | null;
      category: string | null;
    }> = [];
    let treasurySettlements: SettlementRow[] = [];

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

      treasurySettlements = await fetchSettlementRows(docIds);
    }

    const formattedDocs: FormattedDocument[] = docs.map(d => {
      const dItems = allItems.filter(i => i.document_id === d.id);
      const itemsCount = dItems.length;
      // V3.0.0 Phase 1: وضعیت تسویه فاکتور و تجمیع تراکنش‌های خزانه
      const docSettlements = treasurySettlements.filter(t => t.documentId === d.id);
      const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(d.type);
      // v7.0.32 (TD-197): مبلغ قابل وصول = جمع خالص اقلام + مالیات ساختاریافته (همان بدهکار مشتری در سند حسابداری)
      // v7.0.68 (P2-6): همه جمع‌ها با Decimal؛ خروجی عدد
      const amounts = documentAmounts(
        dItems.map(i => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount })),
        d.vatAmount,
        settledAmount(docSettlements, isPurchase),
        d.serviceChargeAmount
      );

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
        totalQuantity: amounts.totalQuantity,
        totalAmount: amounts.totalAmount,
        totalDiscount: amounts.totalDiscount,
        grossAmount: amounts.grossAmount,
        vatPercent: Number(d.vatPercent) || 0,
        vatAmount: amounts.vatAmount,
        serviceChargeAmount: amounts.serviceChargeAmount,
        exchangeRate: d.exchangeRate?.toNumber() ?? null,
        payableAmount: amounts.payableAmount,
        paidAmount: amounts.paidAmount,
        remainingAmount: amounts.remainingAmount,
        settlementStatus: amounts.settlementStatus,
        items: dItems.map(i => ({
          ...i,
          unit_price: fin(i.unit_price).toNumber(),
          discount: fin(i.discount).toNumber(),
          location: i.location || ''
        }))
      };
    });

    // v9.0.80 (TD-489): انبار مبدأ و مقصد حواله‌های انتقال
    const transferLocations = await transferLocationsByDocument(docs.filter(d => d.type === 'transfer').map(d => d.id));
    for (const d of formattedDocs) {
      const loc = transferLocations.get(d.id);
      if (loc) Object.assign(d, loc);
    }
    const rejected = await rejectedWorkflowDocumentIds(docs.filter(d => d.status === 'draft').map(d => d.id));
    for (const d of formattedDocs) if (rejected.has(d.id)) d.workflowRejected = true;

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

    // v9.0.324 (TD-777): انحراف ردیف انبارگردانی با کلید (کالا، انبار) از ردیف‌های فعال و غیرمعکوس کاردکس همین سند
    let auditVarianceOf: (itemId: number, location: unknown) => number = () => 0;
    if (doc.type === 'audit') {
      const ledgerRows = await orm.select({ itemId: transactions.itemId, type: transactions.type, quantity: transactions.quantity, location: transactions.location })
        .from(transactions)
        .where(and(eq(transactions.documentId, doc.id), eq(transactions.isDeleted, 0), isNull(transactions.reversalOfId)));
      const resolveLocation = createLedgerLocationResolver(
        await orm.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive }).from(warehouses),
      );
      const keyOf = (location: unknown) => {
        const wh = resolveLocation(location);
        return wh ? `wh:${wh.id}` : `raw:${String(location ?? '').trim().toLowerCase()}`;
      };
      const variances = stockCountVariances(ledgerRows.map(r => ({ ...r, itemId: Number(r.itemId) })), keyOf);
      auditVarianceOf = (itemId, location) => variances.get(`${itemId}|${keyOf(location)}`) ?? 0;
    }

    const rows = (itemsResult.rows || []) as Array<Record<string, unknown>>;

    const formattedItems: FormattedDocumentItem[] = rows.map((row: Record<string, unknown>) => {
      const variance = auditVarianceOf(Number(row.item_id), row.location);
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
    // v9.0.68 (TD-500): جمع تسویه ردیف باطلِ معکوس‌شده را هم می‌خواند؛ فهرست نمایش همان ردیف‌های کامل است
    const settlementRows = await fetchSettlementRows([doc.id]);

    const isPurchase = ['receipt', 'production_receipt', 'purchase'].includes(doc.type);
    // v7.0.32 (TD-197): مبلغ قابل وصول = جمع خالص اقلام + مالیات ساختاریافته
    // v7.0.68 (P2-6): جمع‌ها با Decimal از مقدار رشته‌ای پایگاه‌داده؛ خروجی عدد
    const amounts = documentAmounts(
      rows.map(row => ({ quantity: row.quantity as DecimalValue, unitPrice: row.unit_price as DecimalValue, discount: row.discount as DecimalValue })),
      doc.vatAmount,
      settledAmount(settlementRows, isPurchase),
      doc.serviceChargeAmount
    );

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
      totalQuantity: amounts.totalQuantity,
      totalDiscount: amounts.totalDiscount,
      grossAmount: amounts.grossAmount,
      total_amount: amounts.totalAmount,
      totalAmount: amounts.totalAmount,
      vatPercent: Number(doc.vatPercent) || 0,
      vat_percent: Number(doc.vatPercent) || 0,
      vatAmount: amounts.vatAmount,
      vat_amount: amounts.vatAmount,
      serviceChargeAmount: amounts.serviceChargeAmount,
      service_charge_amount: amounts.serviceChargeAmount,
      exchangeRate: doc.exchangeRate?.toNumber() ?? null,
      returnOfDocumentId: doc.returnOfDocumentId ?? null,
      payableAmount: amounts.payableAmount,
      payable_amount: amounts.payableAmount,
      paidAmount: amounts.paidAmount,
      remainingAmount: amounts.remainingAmount,
      settlementStatus: amounts.settlementStatus,
      // قرارداد API: مبلغ عدد (P2-6)
      settlements: settlements.map(t => ({ ...t, amount: t.amount.toNumber() })),
      // v9.0.80 (TD-489): انبار مبدأ و مقصد حواله انتقال
      ...(doc.type === 'transfer' ? (await transferLocationsByDocument([doc.id])).get(doc.id) : {}),
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

}

/**
 * v7.0.68 (P2-6): جمع‌های سند (ناخالص، تخفیف، خالص، قابل پرداخت، پرداخت‌شده، مانده) با Decimal؛ خروجی عدد برای API.
 * پرداخت منفی صفر و مانده منفی صفر حساب می‌شود؛ تسویه کامل با آستانه ۰٫۰۱.
 */
function documentAmounts(
  lines: Array<{ quantity: DecimalValue; unitPrice: DecimalValue; discount: DecimalValue }>,
  vatAmount: DecimalValue,
  paid: FinancialDecimal,
  serviceChargeAmount: DecimalValue | null | undefined = 0
) {
  let quantity = fin(0);
  let gross = fin(0);
  let discount = fin(0);
  for (const line of lines) {
    quantity = quantity.add(line.quantity);
    gross = gross.add(fin(line.quantity).multiply(line.unitPrice));
    discount = discount.add(line.discount);
  }
  const total = gross.subtract(discount);
  // v7.0.103 (TD-191): هزینه ارسال و کارمزد ساختاریافته فاکتور جزء مبلغ قابل وصول است
  const payable = total.add(vatAmount).add(serviceChargeAmount ?? 0);
  const safePaid = paid.isNegative() ? fin(0) : paid;
  const remaining = payable.subtract(safePaid);
  const settlementStatus: 'unpaid' | 'partially_paid' | 'fully_paid' =
    payable.isPositive() && safePaid.greaterThanOrEqual(payable.subtract(0.01)) ? 'fully_paid'
      : safePaid.isPositive() ? 'partially_paid' : 'unpaid';
  return {
    totalQuantity: quantity.toNumber(),
    grossAmount: gross.toNumber(),
    totalDiscount: discount.toNumber(),
    totalAmount: total.toNumber(),
    vatAmount: fin(vatAmount).toNumber(),
    serviceChargeAmount: fin(serviceChargeAmount ?? 0).toNumber(),
    payableAmount: payable.toNumber(),
    paidAmount: safePaid.toNumber(),
    remainingAmount: remaining.isNegative() ? 0 : remaining.toNumber(),
    settlementStatus,
  };
}
