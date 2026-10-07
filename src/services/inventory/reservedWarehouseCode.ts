import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.108 (TD-482 / B06-03): a warehouse whose code is a Kardex ledger alias ('default') shares its Kardex rows with the
 * default warehouse, so reconciliation, repair and rebuild move its stock there. New ones are refused at creation; one
 * created before this version is only listed here and never changed automatically (AGENTS §12).
 */
export interface ReservedCodeWarehouseRow {
  id: number;
  code: string;
  name: string;
  isActive: number;
  stock: string;
}

export async function findReservedCodeWarehouses(executor: DbExecutor = orm): Promise<ReservedCodeWarehouseRow[]> {
  const res = await executor.execute(sql`
    SELECT w.id, w.code, w.name, w.is_active AS "isActive",
           COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.warehouse_id = w.id), 0)::text AS stock
      FROM warehouses w
     WHERE lower(btrim(w.code)) IN ('', 'default')
     ORDER BY w.id`);
  return (res.rows ?? []) as unknown as ReservedCodeWarehouseRow[];
}

export function buildReservedWarehouseCodeHealthTest(rows: ReservedCodeWarehouseRow[]): HealthCheckTestResult {
  return {
    id: 'warehouse_reserved_code',
    category: 'inventory',
    title: 'انبار با کد رزرو کاردکس',
    description: 'کد «default» در کاردکس به معنای انبار پیش‌فرض است؛ انباری با این کد، گردش‌هایش را با انبار پیش‌فرض یکی می‌بیند',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, rows.length * 5),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} انبار کد رزرو کاردکس دارد. این انبارها خودکار تغییر نمی‌کنند؛ موجودی را با حواله انتقال به انباری با کد دیگر ببرید و سپس انبار را غیرفعال کنید.`
      : 'هیچ انباری کد رزرو کاردکس ندارد.',
    items: rows.map(r => ({
      id: r.id,
      code: r.code,
      title: r.name,
      subtitle: `موجودی: ${r.stock} | ${r.isActive === 1 ? 'فعال' : 'غیرفعال'}`,
      details: `انبار #${r.id} با کد «${r.code}» (TD-482).`,
    })),
    metrics: { reservedCodeWarehouses: rows.length },
  };
}
