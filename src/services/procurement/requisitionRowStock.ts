import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import type { PurchaseRequisition } from '../../types.js';

/**
 * v10.0.46 (TD-1173): the requisition the approval inbox previews carries each catalog row's current stock (the item's
 * total stock, `items.current_stock`, kept by the database), so the approver sees «موجودی فعلی انبار» instead of «نامشخص».
 * A free-text row (no item id) or a deleted item gets none. Only the detail read fills it; nothing is stored.
 */
export async function withRowCurrentStock(db: DbExecutor, requisition: PurchaseRequisition): Promise<PurchaseRequisition> {
  const rows = Array.isArray(requisition.items) ? requisition.items : [];
  const itemIdOf = (row: (typeof rows)[number]): number => Number(row.itemId ?? row.item_id ?? 0);
  const ids = [...new Set(rows.map(itemIdOf).filter(id => id > 0))];
  if (ids.length === 0) return requisition;
  const stocks = await db.select({ id: items.id, currentStock: items.currentStock })
    .from(items)
    .where(and(inArray(items.id, ids), eq(items.isDeleted, 0)));
  const stockById = new Map(stocks.map(s => [s.id, Number(s.currentStock ?? 0)]));
  return {
    ...requisition,
    items: rows.map(row => {
      const stock = stockById.get(itemIdOf(row));
      return stock === undefined ? row : { ...row, currentStock: stock };
    }),
  };
}
