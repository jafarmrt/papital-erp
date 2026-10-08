import { and, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documents, purchaseRequisitions } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { procurementListPage, requisitionStatusesOf } from '../../lib/procurement/procurementLists.js';
import type { PurchaseRequisition } from '../../types.js';
import { consolidatedIntoCodes } from './requisitionConsolidation.js';

export interface GetRequisitionsFilter {
  /** یکی از کلیدهای `REQUISITION_STATUS_FILTERS` */
  status?: string;
  projectId?: number;
  priority?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** v7.0.68 (P2-6): مبلغ برآوردی در پاسخ سرویس عدد است (ستون Decimal). */
export function toRequisitionDto(row: typeof purchaseRequisitions.$inferSelect): PurchaseRequisition {
  return { ...row, totalEstimatedAmount: row.totalEstimatedAmount?.toNumber() ?? 0 } as unknown as PurchaseRequisition;
}

/** ردیف‌های درخواست (ستون JSONB)؛ مقدار غیر آرایه‌ای ردیفی ندارد */
const requisitionRowsSql = sql`jsonb_array_elements(CASE WHEN jsonb_typeof(${purchaseRequisitions.items}) = 'array' THEN ${purchaseRequisitions.items} ELSE '[]'::jsonb END)`;

function requisitionListConditions(filter: GetRequisitionsFilter): SQL | undefined {
  const conditions: SQL[] = [eq(purchaseRequisitions.isDeleted, 0)];
  const statuses = requisitionStatusesOf(filter.status);
  if (statuses) conditions.push(inArray(purchaseRequisitions.status, [...statuses]));
  if (filter.projectId) conditions.push(eq(purchaseRequisitions.projectId, filter.projectId));
  if (filter.priority && filter.priority !== 'all') conditions.push(eq(purchaseRequisitions.priority, filter.priority));
  const search = filter.search?.trim();
  if (search) {
    const pattern = containsLikePattern(search);
    conditions.push(or(
      ilike(purchaseRequisitions.code, pattern),
      ilike(purchaseRequisitions.title, pattern),
      ilike(purchaseRequisitions.projectCode, pattern),
      ilike(purchaseRequisitions.projectName, pattern),
      // نام یا کد کالاهای درخواست، همان که جست‌وجوی مرورگر میز روی ۱۰۰ ردیف آخر می‌خواند
      sql`EXISTS (SELECT 1 FROM ${requisitionRowsSql} AS req_row WHERE req_row->>'itemName' ILIKE ${pattern} OR req_row->>'itemCode' ILIKE ${pattern})`,
    ) as SQL);
  }
  return and(...conditions);
}

/** شمار سفارش‌های زنده هر درخواست و سفارش‌های در انتظار تحویل، از ستون پیوند سند (ت۲) */
export async function requisitionOrderCounts(db: DbExecutor, requisitionIds: number[]): Promise<Map<number, { ordersCount: number; pendingDeliveryOrdersCount: number }>> {
  const counts = new Map<number, { ordersCount: number; pendingDeliveryOrdersCount: number }>();
  if (requisitionIds.length === 0) return counts;
  const rows = await db.select({
    requisitionId: documents.procurementRequisitionId,
    ordersCount: sql<number>`count(*)::int`,
    pendingDeliveryOrdersCount: sql<number>`(count(*) FILTER (WHERE ${documents.status} IS DISTINCT FROM 'final'))::int`,
  })
    .from(documents)
    .where(and(isNotNull(documents.procurementRequisitionId), eq(documents.isDeleted, 0), inArray(documents.procurementRequisitionId, requisitionIds)))
    .groupBy(documents.procurementRequisitionId);
  for (const row of rows) {
    counts.set(Number(row.requisitionId), { ordersCount: Number(row.ordersCount), pendingDeliveryOrdersCount: Number(row.pendingDeliveryOrdersCount) });
  }
  return counts;
}

/** DTO هر درخواست با کد درخواست تجمیعی و شمار سفارش‌هایش */
export async function requisitionDtos(db: DbExecutor, rows: Array<typeof purchaseRequisitions.$inferSelect>): Promise<PurchaseRequisition[]> {
  const [targetCodes, orderCounts] = await Promise.all([
    consolidatedIntoCodes(db, rows),
    requisitionOrderCounts(db, rows.map(row => row.id)),
  ]);
  return rows.map(row => ({
    ...toRequisitionDto(row),
    consolidatedIntoCode: targetCodes.get(Number(row.consolidatedIntoId)) ?? null,
    ordersCount: orderCounts.get(row.id)?.ordersCount ?? 0,
    pendingDeliveryOrdersCount: orderCounts.get(row.id)?.pendingDeliveryOrdersCount ?? 0,
  }));
}

/**
 * v9.0.346 (TD-697، B10-10): فهرست درخواست‌های خرید با فیلتر وضعیت گروهی، جست‌وجو در کالاهای درخواست و شمار سفارش‌های
 * هر درخواست، همه در SQL؛ سقف صفحه همان `PROCUREMENT_LIST_MAX_LIMIT` Zod است و پاسخ صفحه و سقف به‌کاررفته را برمی‌گرداند.
 */
export async function listRequisitions(
  filter: GetRequisitionsFilter = {},
  db: DbExecutor = orm,
): Promise<{ data: PurchaseRequisition[]; total: number; page: number; limit: number }> {
  const { page, limit } = procurementListPage(filter.page, filter.limit);
  const where = requisitionListConditions(filter);
  const [countRes] = await db.select({ count: sql<number>`count(*)::int` }).from(purchaseRequisitions).where(where);
  const rows = await db.select()
    .from(purchaseRequisitions)
    .where(where)
    .orderBy(desc(purchaseRequisitions.id))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data: await requisitionDtos(db, rows), total: Number(countRes?.count ?? 0), page, limit };
}
