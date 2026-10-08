import { and, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, items, purchaseRequisitions } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { procurementListPage } from '../../lib/procurement/procurementLists.js';
import type { ProcurementOrder } from '../../types.js';

export interface ProcurementOrderListParams {
  /** 'all' | 'draft' | 'pending_delivery' | 'final' | 'delivered' */
  status?: string;
  requisitionId?: number;
  search?: string;
  page?: number;
  limit?: number;
}

/** سفارش تدارکات: سند زنده‌ای که ستون پیوندش به درخواست خرید پر است (v9.0.320، TD-691، ت۲) */
const linkedOrder = and(isNotNull(documents.procurementRequisitionId), eq(documents.isDeleted, 0));

function orderListConditions(params: ProcurementOrderListParams): SQL | undefined {
  const conditions: SQL[] = [linkedOrder as SQL];
  if (params.requisitionId) conditions.push(eq(documents.procurementRequisitionId, params.requisitionId));
  if (params.status === 'pending_delivery' || params.status === 'draft') {
    conditions.push(or(ne(documents.status, 'final'), sql`${documents.status} IS NULL`) as SQL);
  } else if (params.status === 'delivered' || params.status === 'final') {
    conditions.push(eq(documents.status, 'final'));
  }
  const search = params.search?.trim();
  if (search) {
    const pattern = containsLikePattern(search);
    conditions.push(or(
      ilike(documents.refNumber, pattern),
      ilike(documents.buyerName, pattern),
      ilike(documents.notes, pattern),
      ilike(purchaseRequisitions.code, pattern),
      ilike(purchaseRequisitions.title, pattern),
    ) as SQL);
  }
  return and(...conditions);
}

/**
 * v9.0.320 (TD-691 / TD-698، B10-04 و B10-11، ت۲): فهرست سفارش‌های تدارکات فقط سندهای دارای پیوند درخواست است، و
 * فیلتر، شمارش و صفحه‌بندی در SQL انجام می‌شود. پیش‌تر برای هر صفحه همه رسیدها، پیش‌فاکتورها و درخواست‌ها در حافظه
 * خوانده و با `slice` صفحه‌بندی می‌شد، و هر رسید عادی انبار سفارش تدارکات شمرده می‌شد.
 */
export async function listProcurementOrders(
  params: ProcurementOrderListParams,
  db: DbExecutor = orm,
): Promise<{ data: ProcurementOrder[]; total: number; page: number; limit: number }> {
  const { page, limit } = procurementListPage(params.page, params.limit);
  const where = orderListConditions(params);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(documents)
    .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, documents.procurementRequisitionId))
    .where(where);
  const pageRows = await db.select({
    doc: documents,
    requisitionId: purchaseRequisitions.id,
    requisitionCode: purchaseRequisitions.code,
    requisitionProject: purchaseRequisitions.projectName,
  })
    .from(documents)
    .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, documents.procurementRequisitionId))
    .where(where)
    .orderBy(desc(documents.id))
    .limit(limit)
    .offset((page - 1) * limit);
  if (pageRows.length === 0) return { data: [], total: Number(total), page, limit };

  const lines = await db.select().from(documentItems).where(and(
    inArray(documentItems.documentId, pageRows.map(row => row.doc.id)),
    eq(documentItems.isDeleted, 0),
  ));
  const itemIds = [...new Set(lines.map(line => line.itemId))];
  const catalog = itemIds.length === 0 ? [] : await db.select({ id: items.id, code: items.code, name: items.name, unit: items.unit })
    .from(items).where(inArray(items.id, itemIds));
  const catalogById = new Map(catalog.map(item => [item.id, item]));

  const data = pageRows.map(({ doc, requisitionId, requisitionCode, requisitionProject }): ProcurementOrder => {
    const docLines = lines.filter(line => line.documentId === doc.id);
    // v7.0.113 (TD-239): جمع مبلغ سفارش خرید با FinancialDecimal؛ خروجی API عددی می‌ماند
    let totalAmount = fin(0);
    const orderItems = docLines.map(line => {
      const item = catalogById.get(line.itemId);
      const quantity = Number(line.quantity || 0);
      const unitPrice = fin(line.unitPrice);
      const lineTotal = unitPrice.multiply(quantity);
      totalAmount = totalAmount.add(lineTotal);
      return {
        id: line.id,
        itemId: line.itemId,
        itemName: item?.name || `کالای کد ${line.itemId}`,
        itemCode: item?.code || '',
        unit: item?.unit || 'عدد',
        quantity,
        unitPrice: unitPrice.toNumber(),
        totalPrice: lineTotal.toNumber(),
        location: line.location || docLines[0]?.location || '',
      };
    });
    const projectName = requisitionProject || doc.notes?.match(/\[پروژه:\s*([^\]]+)\]/)?.[1]?.trim() || null;
    return {
      id: doc.id,
      refNumber: doc.refNumber,
      docType: doc.type,
      status: doc.status === 'final' ? 'final' : 'draft',
      date: doc.date,
      supplierName: doc.buyerName || 'تامین‌کننده تدارکات',
      notes: doc.notes || '',
      requisitionId,
      requisitionCode,
      projectName,
      location: docLines[0]?.location || '',
      totalAmount: totalAmount.toNumber(),
      itemsCount: orderItems.length,
      items: orderItems,
      user: doc.user || 'کارشناس تدارکات',
    };
  });
  return { data, total: Number(total), page, limit };
}

/** شمار سفارش‌های تدارکات (فقط سندهای دارای پیوند درخواست؛ پیش‌تر هر رسید و پیش‌فاکتور فروش شمرده می‌شد) */
export async function procurementOrderCounts(db: DbExecutor = orm): Promise<{ total: number; delivered: number; pendingDelivery: number }> {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    delivered: sql<number>`(count(*) FILTER (WHERE ${documents.status} = 'final'))::int`,
  }).from(documents).where(linkedOrder);
  const total = Number(row?.total ?? 0);
  const delivered = Number(row?.delivered ?? 0);
  return { total, delivered, pendingDelivery: total - delivered };
}
