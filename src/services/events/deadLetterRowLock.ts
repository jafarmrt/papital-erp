import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { ROW_ADVISORY_LOCK_NAMESPACES, withRowAdvisoryLock } from '../../lib/advisoryLock.js';
import { ConflictError } from '../../errors/customErrors.js';

const DLQ_LOCK = ROW_ADVISORY_LOCK_NAMESPACES.DLQ_EVENT;

/** برچسب وضعیت‌های حل‌شده DLQ در پیام‌های رد */
export const RESOLVED_STATUS_LABELS: Record<string, string> = { replayed: 'بازپخش', dismissed: 'صرف‌نظر' };

/**
 * v8.0.55 (TD-342): بازپخش و صرف‌نظر یک ردیف DLQ زیر قفل مشورتی همان ردیف اجرا می‌شوند؛ کار هم‌زمان روی همان ردیف
 * بی‌انتظار رد می‌شود (گرداننده‌های وب‌هوک و پیامک بیرون از تراکنش اجرا می‌شوند و نباید دو بار اجرا شوند).
 */
export async function withDeadLetterRowLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const outcome = await withRowAdvisoryLock(DLQ_LOCK, id, fn);
  if (!outcome.acquired) {
    throw new ConflictError(`رویداد #${id} صف خطا هم‌اکنون در حال بازپخش یا تغییر وضعیت است؛ پس از پایان آن دوباره تلاش کنید.`);
  }
  return outcome.result;
}

/**
 * v8.0.55 (TD-342): از ردیف‌های DLQ آن‌هایی را برمی‌گرداند که هم‌اکنون بازپخش نمی‌شوند، و قفل تراکنشی همان کلید را تا
 * پایان تراکنش رویشان نگه می‌دارد تا بازپخش دستی هم‌زمان رد شود.
 */
export async function lockIdleDeadLetterRows<T extends { id: number }>(tx: DbTransaction, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = sql.join(rows.map(r => sql`${r.id}::int`), sql`, `);
  const locked = await tx.execute(sql`SELECT id FROM unnest(ARRAY[${ids}]) AS id WHERE pg_try_advisory_xact_lock(${DLQ_LOCK}::int, id)`);
  const lockedIds = new Set((locked.rows as Array<{ id: number | string }>).map(r => Number(r.id)));
  return rows.filter(r => lockedIds.has(r.id));
}
