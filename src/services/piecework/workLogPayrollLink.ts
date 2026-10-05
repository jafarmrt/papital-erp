import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { pieceworkLogs } from '../../db/schema.js';
import { BadRequestError, NotFoundError } from '../../errors/customErrors.js';

/**
 * v8.0.28 (TD-281): کارکردی آزاد است که به فیش زنده‌ای پیوند ندارد (بی‌فیش، یا فیشش حذف‌شده). صدور فیش فقط کارکرد آزاد را
 * برمی‌دارد و پیوند می‌دهد؛ v8.0.76 (TD-328): ویرایش و حذف کارکرد هم فقط کارکرد آزاد را می‌پذیرد.
 */
export function workLogFreeOfLivePayroll(): SQL {
  return sql`(${pieceworkLogs.payrollId} IS NULL OR EXISTS (SELECT 1 FROM piecework_payrolls pp WHERE pp.id = ${pieceworkLogs.payrollId} AND pp.is_deleted = 1))`;
}

/**
 * v8.0.76 (TD-328): ردیف کارکرد را در تراکنش فراخواننده FOR UPDATE قفل می‌کند و گارد «در فیش است» را روی همین خواندن قفل‌شده
 * می‌سنجد؛ صدور فیش همین ردیف‌ها را FOR UPDATE قفل می‌کند، پس ویرایش یا حذف هم‌زمان یا پیش از پیوند فیش تمام می‌شود و در فیش
 * دیده می‌شود، یا پس از آن رد می‌شود. پیش‌تر خواندن بیرون از تراکنش و بی‌قفل بود و کارکرد پیوندشده به فیش بازنویسی یا حذف می‌شد.
 */
export async function lockEditableWorkLog(tx: DbExecutor, id: number, refusal: string): Promise<typeof pieceworkLogs.$inferSelect> {
  const [row] = await tx
    .select({ log: pieceworkLogs, free: sql<boolean>`${workLogFreeOfLivePayroll()}` })
    .from(pieceworkLogs)
    .where(and(eq(pieceworkLogs.id, id), eq(pieceworkLogs.isDeleted, 0)))
    .for('update');
  if (!row) {
    throw new NotFoundError('ردیف کارکرد یافت نشد');
  }
  if (row.log.status === 'paid' || !row.free) {
    throw new BadRequestError(refusal);
  }
  return row.log;
}
