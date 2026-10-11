import { and, eq, notInArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { purchaseRequisitions } from '../../db/schema.js';

/**
 * v10.0.255 (TD-1134): مقدار هر کالا در درخواست‌های خرید باز (هنوز سفارش‌نشده)، که هشدار نقطه سفارش در ستون «درخواست
 * باز» نشان می‌دهد و پنجره سفارش پیش از ثبت درخواست تکراری درباره‌اش می‌پرسد. پیش‌تر هشدار فقط اسناد خرید باز («در راه»)
 * را می‌دید و درخواست دوم همان کالا بی‌هشدار ساخته می‌شد. بخش سفارش‌شده ردیف در «در راه» است، پس دوبار شمرده نمی‌شود.
 */

/** درخواستی با این وضعیت‌ها بسته است و چیزی از آن خریده نمی‌شود */
export const CLOSED_REQUEST_STATUSES = ['rejected', 'cancelled', 'consolidated'] as const;

export interface RequisitionRowQty {
  itemId?: number | string | null;
  requestedQty?: number | string | null;
  orderedQty?: number | string | null;
  closed?: boolean | null;
}

/** مانده سفارش‌نشده یک ردیف: ردیف بسته‌شده صفر، وگرنه مقدار درخواستی − سفارش‌شده (نه کمتر از صفر) */
export function unorderedRowQty(row: RequisitionRowQty): number {
  if (row.closed) return 0;
  const remaining = Number(row.requestedQty || 0) - Number(row.orderedQty || 0);
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
}

/** جمع مانده سفارش‌نشده هر کالای خواسته‌شده در ردیف‌های درخواست‌های باز */
export function openRequestedQuantities(rows: readonly RequisitionRowQty[], itemIds: readonly number[]): Map<number, number> {
  const wanted = new Set(itemIds);
  const totals = new Map<number, number>();
  for (const row of rows) {
    const itemId = Number(row.itemId);
    if (!wanted.has(itemId)) continue;
    const qty = unorderedRowQty(row);
    if (qty > 0) totals.set(itemId, (totals.get(itemId) ?? 0) + qty);
  }
  return totals;
}

/** v10.0.255 (TD-1134): unordered quantity of each item on live purchase requisitions that are not closed */
export async function openRequisitionQuantities(executor: DbExecutor, itemIds: number[]): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const requisitions = await executor
    .select({ items: purchaseRequisitions.items })
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.isDeleted, 0), notInArray(purchaseRequisitions.status, [...CLOSED_REQUEST_STATUSES])));
  const rows = requisitions.flatMap(r => (Array.isArray(r.items) ? r.items as RequisitionRowQty[] : []));
  return openRequestedQuantities(rows, itemIds);
}
