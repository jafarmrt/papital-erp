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
  WORKFLOW_SLA_REMINDER: 91006,
  /** v8.0.82 (TD-366): یک اجرای مهاجرت در هر زمان (راه‌اندازی سرور، ابزار دستی)؛ اجرای دوم منتظر می‌ماند */
  MIGRATIONS: 91008,
  /**
   * v9.0.57 (TD-524): قفل تراکنشی مجموعه مدیران سیستم؛ ویرایش و حذف کاربر زیر این قفل انجام می‌شود تا دو تغییر هم‌زمان
   * هر کدام مدیر دیگر را ببیند و سامانه بی مدیر بماند
   */
  SYSTEM_ADMIN_SET: 91030,
} as const;

/**
 * v8.0.75 (TD-342): فضای نام قفل‌های مشورتی یک‌ردیفی (شکل دوکلیدی: فضای نام و شناسه ردیف؛ با فضای تک‌کلیدی بالا هم‌پوشانی
 * ندارد).
 */
export const ROW_ADVISORY_LOCK_NAMESPACES = {
  DLQ_EVENT: 91007,
  /**
   * v9.0.37 (TD-455): شروع فرایند گردش‌کار یک موجودیت؛ قفل تراکنشی با کلید hashtext(نوع:شناسه)، تا شروع هم‌زمان دو
   * فرایند در جریان نسازد
   */
  WORKFLOW_ENTITY_START: 91009,
} as const;

export type AdvisoryLockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/**
 * قفل مشورتی سطح جلسه را روی یک اتصال اختصاصی می‌گیرد، تابع را اجرا می‌کند و قفل را روی همان اتصال
 * آزاد می‌کند. (قفل سطح جلسه روی استخر اتصال باید روی همان اتصالی که گرفته شده آزاد شود؛ اجرای
 * lock/unlock با دو کوئری جدای orm ممکن است روی دو اتصال متفاوت برود و قفل نشت کند.)
 * اگر نمونه دیگری قفل را در اختیار داشته باشد، بدون انتظار `{ acquired: false }` برمی‌گردد.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<AdvisoryLockOutcome<T>> {
  return withSessionAdvisoryLock('$1::bigint', [key], fn);
}

/**
 * v8.0.75 (TD-342): همان قفل سطح جلسه برای یک ردیف (فضای نام + شناسه) — برای کاری که بیرون از تراکنش طول می‌کشد
 * (مثل اجرای گرداننده‌های وب‌هوک و پیامک یک رویداد) و نباید هم‌زمان دو بار روی یک ردیف اجرا شود. با افتادن اتصال
 * قفل خودبه‌خود آزاد می‌شود. تراکنشی که باید ردیف در حال کار را کنار بگذارد همان کلید را با
 * `pg_try_advisory_xact_lock(namespace, id)` می‌آزماید.
 */
export async function withRowAdvisoryLock<T>(namespace: number, rowId: number, fn: () => Promise<T>): Promise<AdvisoryLockOutcome<T>> {
  return withSessionAdvisoryLock('$1::int, $2::int', [namespace, rowId], fn);
}

async function withSessionAdvisoryLock<T>(keyArgs: string, keys: number[], fn: () => Promise<T>): Promise<AdvisoryLockOutcome<T>> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT pg_try_advisory_lock(${keyArgs}) AS acquired`, keys);
    if (!res.rows?.[0]?.acquired) {
      return { acquired: false };
    }
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${keyArgs})`, keys).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
