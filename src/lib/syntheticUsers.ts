import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { startsWithLikePattern } from './sqlLike.js';

/**
 * پیشوند نام کاربری کاربران ساختگی آزمون‌ها. از v9.0.61 (TD-521) فقط تشخیص «راه‌اندازی شده» (`check-setup` و `setup`) آن‌ها
 * را نمی‌شمارد؛ فهرست‌های کاربران همه کاربران حذف‌نشده را نشان می‌دهند و API کاربر تازه با این پیشوندها نمی‌سازد.
 */
export const SYNTHETIC_TEST_USERNAME_PREFIXES = ['testuser_', 'test_', 'e2e_'] as const;

/** v9.0.61 (TD-521): پیام رد نام کاربری با پیشوند کاربران آزمون */
export const SYNTHETIC_USERNAME_REFUSED =
  'نام کاربری نباید با test_، e2e_ یا testuser_ شروع شود؛ این پیشوندها ویژه کاربران آزمون خودکار است. نام کاربری دیگری انتخاب کنید.';

/** v9.0.61 (TD-521): نام کاربری با یکی از پیشوندهای کاربران آزمون شروع می‌شود (بی حساسیت به حروف، مثل شرط ILIKE) */
export function isSyntheticTestUsername(username: string): boolean {
  const name = String(username ?? '').trim().toLowerCase();
  return SYNTHETIC_TEST_USERNAME_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * v7.0.78: شرط «کاربر ساختگی تست نیست». پیش‌تر الگوها بدون escape نوشته شده بودند و `_` در LIKE هر نویسه‌ای
 * را تطبیق می‌دهد؛ پس `test_%` هر نام کاربری با شروع «test» و دست‌کم یک نویسه دیگر (مثلاً tester) و `e2e_%`
 * نامی مانند e2eadmin را هم کنار می‌گذاشت: چنین کاربری در فهرست کاربران دیده نمی‌شد و اگر تنها کاربر بود،
 * سامانه «راه‌اندازی نشده» شمرده می‌شد.
 */
export function notSyntheticTestUsername(column: AnyColumn): SQL {
  return sql.join(
    SYNTHETIC_TEST_USERNAME_PREFIXES.map(prefix => sql`${column} NOT ILIKE ${startsWithLikePattern(prefix)}`),
    sql` AND `,
  );
}

/** v9.0.61 (TD-521): شرط وارون، برای فهرست بررسی سلامت کاربران فعال با پیشوند آزمون */
export function syntheticTestUsername(column: AnyColumn): SQL {
  return sql`(${sql.join(
    SYNTHETIC_TEST_USERNAME_PREFIXES.map(prefix => sql`${column} ILIKE ${startsWithLikePattern(prefix)}`),
    sql` OR `,
  )})`;
}
