import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { journalVoucherItems, journalVouchers } from '../../db/schema.js';

/**
 * v9.0.197 (TD-546، B03-04، تصمیم ت۴ الف): شمار ردیف‌های سند (هر وضعیت) روی یک حساب. ردیف حذف نرم‌شده و ردیف سند
 * حذف‌شده شمرده نمی‌شوند، چون هیچ گزارشی آن‌ها را نمی‌خواند (TD-270).
 */
export async function countAccountVoucherRows(executor: DbExecutor, accountId: number): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`COUNT(*)::int` })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(eq(journalVoucherItems.accountId, accountId), eq(journalVoucherItems.isDeleted, 0), eq(journalVouchers.isDeleted, 0)));
  return Number(row?.n ?? 0);
}
