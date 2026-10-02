import { pool } from '../db/drizzle.js';

/**
 * v7.0.31 (TD-193 / audit P1-8): کلیدهای قفل مشورتی کارهای نگهداشتی که در کل خوشه فقط یک اجرای
 * همزمان مجاز دارند.
 */
export const ADVISORY_LOCK_KEYS = {
  SEED: 89345,
  DOCUMENT_VOUCHER_SYNC: 91001,
  KARDEX_INITIAL_BACKFILL: 91002,
  WAREHOUSE_STOCK_REPAIR: 91003,
  INLINE_ATTACHMENTS_MIGRATION: 91004,
  ATTACHMENT_ORPHAN_CLEANUP: 91005,
} as const;

export type AdvisoryLockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/**
 * قفل مشورتی سطح جلسه را روی یک اتصال اختصاصی می‌گیرد، تابع را اجرا می‌کند و قفل را روی همان اتصال
 * آزاد می‌کند. (قفل سطح جلسه روی استخر اتصال باید روی همان اتصالی که گرفته شده آزاد شود؛ اجرای
 * lock/unlock با دو کوئری جدای orm ممکن است روی دو اتصال متفاوت برود و قفل نشت کند.)
 * اگر نمونه دیگری قفل را در اختیار داشته باشد، بدون انتظار `{ acquired: false }` برمی‌گردد.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<AdvisoryLockOutcome<T>> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key]);
    if (!res.rows?.[0]?.acquired) {
      return { acquired: false };
    }
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
