import { asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { notifications, users } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.434 (TD-717، B15-15، تصمیم ت۸ الف): یادآوری سررسید پیگیری (`crm_due_task`) برای هر کاربر و پیوند یکتاست؛ ایندکس
 * یکتای جزئی `uq_notifications_due_reminder` (مهاجرت 0089) فقط روی داده بی تکرار ساخته شد. یادآوری‌های تکراری پیشین
 * (ساخته‌شده با درخواست‌های هم‌زمان زنگ و شمارنده) پاک نمی‌شوند و این‌جا فهرست می‌شوند.
 */
export const DUE_REMINDER_UNIQUE_INDEX = 'uq_notifications_due_reminder';
export const DUE_REMINDER_TYPE = 'crm_due_task';

export interface DuplicateDueReminderRow {
  userId: number;
  userName: string;
  link: string;
  count: number;
}

export async function findDuplicateDueReminders(db: DbExecutor = orm): Promise<DuplicateDueReminderRow[]> {
  const count = sql<number>`COUNT(*)::int`;
  const rows = await db.select({
    userId: notifications.userId,
    userName: sql<string>`COALESCE(NULLIF(btrim(MAX(${users.fullName})), ''), MAX(${users.username}), '')`,
    link: sql<string>`COALESCE(${notifications.link}, '')`,
    count,
  })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.type, DUE_REMINDER_TYPE))
    .groupBy(notifications.userId, notifications.link)
    .having(sql`COUNT(*) > 1`)
    .orderBy(asc(notifications.userId), asc(notifications.link));
  return rows.map(r => ({ ...r, count: Number(r.count) }));
}

export async function hasDueReminderUniqueIndex(db: DbExecutor = orm): Promise<boolean> {
  // only the current schema counts: an index of the same name in another schema is not this table's
  const res = await db.execute(sql`SELECT to_regclass(format('%I.%I', current_schema(), ${DUE_REMINDER_UNIQUE_INDEX}::text)) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildDueReminderHealthTest(duplicates: DuplicateDueReminderRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const count = duplicates.length;
  return {
    id: 'notification_reminder_uniqueness',
    category: 'system',
    title: 'یکتایی یادآوری سررسید پیگیری',
    description: 'هر پیگیری سررسیدشده برای هر کاربر یک یادآوری در زنگ اعلان دارد و یادآوری کنارگذاشته برنمی‌گردد؛ پایگاه‌داده با ایندکس یکتا از یادآوری تکراری جلوگیری می‌کند',
    status: count > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: 0,
    count,
    message: count > 0
      ? `${toPersianDigits(count)} یادآوری سررسید پیگیری برای یک کاربر بیش از یک بار ساخته شده و قید یکتایی در پایگاه‌داده اعمال نشده است؛ یادآوری‌ها خودکار پاک نمی‌شوند و کاربر می‌تواند نسخه‌های تکراری را از زنگ اعلان کنار بگذارد.`
      : (uniqueIndexPresent
        ? 'هیچ یادآوری سررسید پیگیری تکرار نشده و پایگاه‌داده از یادآوری تکراری جلوگیری می‌کند.'
        : 'هیچ یادآوری سررسید پیگیری تکرار نشده اما قید یکتایی در پایگاه‌داده اعمال نشده است.'),
    items: duplicates.map((r, index) => ({
      id: index + 1,
      code: `کاربر #${toPersianDigits(r.userId)}`,
      title: r.userName || `کاربر #${toPersianDigits(r.userId)}`,
      subtitle: `پیوند: ${r.link}`,
      details: `${toPersianDigits(r.count)} یادآوری`,
    })),
    metrics: { duplicateDueReminders: count, dueReminderUniqueIndex: uniqueIndexPresent ? 1 : 0 },
  };
}
