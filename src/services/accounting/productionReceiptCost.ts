import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { transactions } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v8.0.12 (TD-256): بهای کالای رسید تولید با قیمت صفر در سند حسابداری همان بهای ثبت‌شده در کاردکس است.
 *
 * ورود با قیمت صفر به WAC جاری ارزش‌گذاری می‌شود و ردیف کاردکس آن از v8.0.12 همان WAC را دارد. سند حسابداری پیش‌تر
 * WAC کالا را در لحظه صدور می‌خواند؛ اگر ردیف دیگری از همان کالا در همان سند WAC را تغییر می‌داد (یا سند بعدها صادر
 * می‌شد) مبلغ سند با ارزش کاردکس فرق می‌کرد. برای هر کالای دارای ردیف قیمت صفر، مبلغ سند = جمع بهای ردیف‌های ورود
 * همان کالا در کاردکس این سند. کالایی که ردیف کاردکس با بهای صفر دارد (ثبت پیش از v8.0.12) در نقشه نمی‌آید و همان
 * قاعده قبلی (WAC) برایش می‌ماند.
 */
export async function productionKardexCostByItem(
  executor: DbExecutor,
  documentId: number,
  itemIds: number[],
): Promise<Map<number, FinancialDecimal>> {
  const result = new Map<number, FinancialDecimal>();
  if (itemIds.length === 0) return result;
  const rows = await executor.select({
    itemId: transactions.itemId,
    total: sql<string>`COALESCE(SUM(${transactions.totalPrice}), 0)::text`,
    zeroRows: sql<number>`(COUNT(*) FILTER (WHERE COALESCE(${transactions.unitPrice}, 0) <= 0))::int`,
  })
    .from(transactions)
    .where(and(
      eq(transactions.documentId, documentId),
      eq(transactions.type, 'in'),
      eq(transactions.isDeleted, 0),
      isNull(transactions.reversalOfId),
      inArray(transactions.itemId, itemIds),
    ))
    .groupBy(transactions.itemId);
  for (const row of rows) {
    if (Number(row.zeroRows) === 0) result.set(row.itemId, fin(row.total));
  }
  return result;
}
