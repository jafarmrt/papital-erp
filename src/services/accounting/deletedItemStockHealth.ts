import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import type { HealthCheckTestResult } from '../../types.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v11 phase 3.2 (S3): deleted items that still hold stock or an open BOM allocation. Before this phase an item could be
 * deleted while an allocation of it was open, and releasing that allocation put its stock, and through the voided allocation
 * voucher its value, back on the deleted item; the item list, the integrity audit and the warehouse reconciliation read only
 * live items, so this stock was seen nowhere. Since then the delete refuses an open allocation and no stock moves on a deleted
 * item. Nothing here changes automatically: an open allocation is closed with «مصرف شد»; stock on a deleted item needs a
 * by-hand correction.
 */
export interface DeletedItemStockRow {
  itemId: number;
  code: string;
  name: string;
  /** stock over every warehouse, as text */
  stock: string;
  /** stock × the item's weighted average cost, as text */
  value: string;
  openAllocations: number;
}

export async function findDeletedItemsWithStock(db: DbExecutor): Promise<DeletedItemStockRow[]> {
  const res = await db.execute(sql`
    WITH s AS (
      SELECT item_id, SUM(current_stock) AS stock FROM item_warehouse_stocks WHERE current_stock <> 0 GROUP BY item_id
    ), a AS (
      SELECT item_id, COUNT(*)::int AS open_allocations FROM project_bom_allocations
       WHERE status = 'allocated' AND is_deleted = 0 GROUP BY item_id
    )
    SELECT i.id AS "itemId", i.code, i.name,
           COALESCE(s.stock, 0)::text AS stock,
           (COALESCE(s.stock, 0) * COALESCE(i.weighted_average_cost, 0))::text AS value,
           COALESCE(a.open_allocations, 0) AS "openAllocations"
      FROM items i
      LEFT JOIN s ON s.item_id = i.id
      LEFT JOIN a ON a.item_id = i.id
     WHERE i.is_deleted = 1 AND (s.item_id IS NOT NULL OR a.item_id IS NOT NULL)
     ORDER BY i.id`);
  return (res.rows ?? []) as unknown as DeletedItemStockRow[];
}

export function buildDeletedItemStockHealthTest(rows: DeletedItemStockRow[]): HealthCheckTestResult {
  const count = rows.length;
  return {
    id: 'item_deleted_with_stock',
    category: 'inventory',
    title: 'موجودی یا تخصیص باز کالای حذف‌شده',
    description: 'کالای حذف‌شده نباید موجودی یا تخصیص باز پروژه داشته باشد؛ این موجودی در هیچ فهرست و گزارش انبار دیده نمی‌شود. این ردیف‌ها خودکار تغییر نمی‌کنند',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, count * 2),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} کالای حذف‌شده هنوز موجودی یا تخصیص باز پروژه دارد. تخصیص باز را در صفحهٔ تخصیص مواد با «مصرف شد» ببندید؛ موجودی کالای حذف‌شده با پشتیبانی اصلاح می‌شود.`
      : 'هیچ کالای حذف‌شده‌ای موجودی یا تخصیص باز ندارد.',
    items: rows.map(r => ({
      id: r.itemId,
      code: r.code,
      title: r.name,
      subtitle: `موجودی ${toPersianDigits(fin(r.stock).toString(), 4)} | تخصیص باز ${toPersianDigits(r.openAllocations)}`,
      amount: fin(r.value).toNumber(),
      details: `ارزش موجودی ${formatPersianPrice(fin(r.value).toString(), 'IRR', 0)}.`,
    })),
    metrics: { deletedItemsWithStock: count },
  };
}
