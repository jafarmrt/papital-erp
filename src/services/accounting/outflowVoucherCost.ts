import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { transactions } from '../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v8.0.115 (TD-400): بهای سند حسابداری حواله و ضایعات همان بهای ردیف‌های خروج کاردکس همین سند است.
 *
 * پیش‌تر سند حسابداری WAC کالا را در لحظه صدور می‌خواند و برای کالای بی‌WAC به قیمت ردیف سند برمی‌گشت؛ همگام‌سازی
 * دوباره سند پیش‌نویس پس از رسیدی تازه عدد سند را عوض می‌کرد و ارزش انبار از دفتر کل جدا می‌شد. خروج از v7.0.46
 * همیشه WAC لحظه خروج را در کاردکس ثبت می‌کند، پس جمع `total_price` ردیف‌های خروج فعال همین سند (بی ردیف معکوس) بهای
 * درست هر کالاست. کالایی که ردیف کاردکس ندارد (سند پیش از کاردکس) به WAC جاری ارزش‌گذاری می‌شود، هرگز به قیمت سند.
 */

export interface OutflowLine {
  itemId: number;
  quantity: DecimalValue;
  itemType: string | null;
  weightedAverageCost: DecimalValue;
}

export interface OutflowCost {
  raw: FinancialDecimal;
  finished: FinancialDecimal;
}

export async function kardexOutCostByItem(executor: DbExecutor, documentId: number): Promise<Map<number, FinancialDecimal>> {
  const rows = await executor.select({
    itemId: transactions.itemId,
    total: sql<string>`COALESCE(SUM(${transactions.totalPrice}), 0)::text`,
  })
    .from(transactions)
    .where(and(
      eq(transactions.documentId, documentId),
      eq(transactions.type, 'out'),
      eq(transactions.isDeleted, 0),
      isNull(transactions.reversalOfId),
    ))
    .groupBy(transactions.itemId);
  return new Map(rows.map(r => [r.itemId, fin(r.total)]));
}

/** بهای خروج سند به تفکیک مواد (هر نوع جز محصول) و کالای ساخته‌شده؛ هر کالا یک بار، از کاردکس یا WAC جاری */
export function outflowCostByKind(lines: OutflowLine[], kardexCosts: Map<number, FinancialDecimal>): OutflowCost {
  const byItem = new Map<number, { qty: FinancialDecimal; wac: FinancialDecimal; finished: boolean }>();
  for (const line of lines) {
    const prev = byItem.get(line.itemId);
    const qty = fin(line.quantity);
    if (prev) prev.qty = prev.qty.add(qty);
    else byItem.set(line.itemId, { qty, wac: fin(line.weightedAverageCost), finished: line.itemType === 'product' });
  }
  let raw = fin(0);
  let finished = fin(0);
  for (const [itemId, entry] of byItem) {
    const kardex = kardexCosts.get(itemId);
    const cost = kardex ?? (entry.wac.isPositive() ? entry.qty.multiply(entry.wac) : fin(0));
    if (entry.finished) finished = finished.add(cost);
    else raw = raw.add(cost);
  }
  return { raw, finished };
}

export async function documentOutflowCost(executor: DbExecutor, documentId: number, lines: OutflowLine[]): Promise<OutflowCost> {
  return outflowCostByKind(lines, await kardexOutCostByItem(executor, documentId));
}
