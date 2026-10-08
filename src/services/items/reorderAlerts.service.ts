import { and, asc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, items } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { ItemStockReservationService } from './itemStockReservation.service.js';
import { ItemWarehouseStockService } from '../inventory/itemWarehouseStock.service.js';

/**
 * v9.0.404 (TD-843، تصمیم ت۷ «الف» بسته ۷): هشدار نقطه سفارش «موجودی آزاد» = موجودی کل − رزروها (پیش‌فاکتور فروش و پروژه
 * نهایی‌شده، همان گزارش رزرو) را با نقطه سفارش می‌سنجد؛ کسری و «بی موجودی» هم از موجودی آزاد است. ستون «در راه» جمع ردیف‌های
 * سندهای خرید باز (رسید یا خرید در وضعیت پیش‌نویس یا پیش‌فاکتور: سفارش‌های تدارکات و پیش‌فاکتور خرید) است و فقط نشان داده
 * می‌شود، در سنجش نیست. پیش‌تر هشدار موجودی کل را می‌سنجید: کالایی که همه‌اش رزرو بود هشدار نمی‌گرفت. خطای خواندن رزرو
 * درخواست را رد می‌کند (TD-821)، هرگز به رزرو صفر خوانده نمی‌شود.
 */
export const IN_TRANSIT_DOCUMENT_TYPES = ['receipt', 'purchase'] as const;
export const IN_TRANSIT_DOCUMENT_STATUSES = ['draft', 'proforma'] as const;

export interface ReorderAlertFilters {
  type?: string;
  search?: string;
  zeroStock?: boolean;
}

export type ReorderAlertRow = Record<string, unknown> & {
  id: number;
  current_stock: number;
  reserved_qty: number;
  free_stock: number;
  in_transit_qty: number;
  reorder_point: number;
  deficit: number;
};

/** Quantity of each item on open purchase documents (draft or proforma receipts and purchases) */
export async function inTransitQuantities(executor: DbExecutor, itemIds: number[]): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await executor
    .select({ itemId: documentItems.itemId, quantity: sql<string>`SUM(${documentItems.quantity})::text` })
    .from(documentItems)
    .innerJoin(documents, eq(documentItems.documentId, documents.id))
    .where(and(
      inArray(documentItems.itemId, itemIds),
      eq(documentItems.isDeleted, 0),
      eq(documents.isDeleted, 0),
      inArray(documents.type, [...IN_TRANSIT_DOCUMENT_TYPES]),
      inArray(documents.status, [...IN_TRANSIT_DOCUMENT_STATUSES]),
    ))
    .groupBy(documentItems.itemId);
  return new Map(rows.map(r => [Number(r.itemId), fin(r.quantity).toNumber()]));
}

export async function listReorderAlerts(filters: ReorderAlertFilters, executor: DbExecutor = orm): Promise<ReorderAlertRow[]> {
  const conditions: SQL[] = [eq(items.isDeleted, 0), gt(items.reorderPoint, 0)];
  if (filters.type === 'product' || filters.type === 'raw_material') conditions.push(eq(items.type, filters.type));
  if (filters.search) {
    conditions.push(or(
      ilike(items.name, containsLikePattern(filters.search)),
      ilike(items.code, containsLikePattern(filters.search)),
      ilike(items.category, containsLikePattern(filters.search)),
    )!);
  }
  const candidates = await executor.select().from(items).where(and(...conditions)).orderBy(asc(items.id));
  const ids = candidates.map(it => it.id);
  const [reserved, inTransit, stockMap] = await Promise.all([
    ItemStockReservationService.getReservedStocksMap({ itemIds: ids }),
    inTransitQuantities(executor, ids),
    ItemWarehouseStockService.getStocksForItems(executor, ids),
  ]);

  const rows: ReorderAlertRow[] = [];
  for (const it of candidates) {
    const reorderPoint = fin(it.reorderPoint).toNumber();
    const reservedQty = fin(reserved[String(it.id)]?.totalReserved).toNumber();
    const free = fin(it.currentStock).subtract(reservedQty);
    if (free.greaterThan(reorderPoint)) continue;
    if (filters.zeroStock && free.isPositive()) continue;
    const wac = fin(it.weightedAverageCost).toNumber();
    const deficit = fin(reorderPoint).subtract(free);
    const deficitQty = deficit.isPositive() ? deficit.toNumber() : 0;
    const stocks = stockMap.get(it.id)?.byCode ?? {};
    const row: ReorderAlertRow = {
      ...it,
      stocks,
      current_stock: fin(it.currentStock).toNumber(),
      reserved_qty: reservedQty,
      free_stock: free.toNumber(),
      in_transit_qty: inTransit.get(it.id) ?? 0,
      reorder_point: reorderPoint,
      weighted_average_cost: wac,
      deficit: deficitQty,
      deficit_value: fin(deficitQty).multiply(wac).toNumber(),
      is_zero_stock: !free.isPositive(),
    };
    for (const code of Object.keys(stocks)) row[`stock_${code}`] = Number(stocks[code] || 0);
    rows.push(row);
  }
  // the least free stock first, as before (by total stock)
  return rows.sort((a, b) => a.free_stock - b.free_stock || a.id - b.id);
}
