import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { startsWithLikePattern } from './sqlLike.js';

/** پیشوند نام کاربری کاربران ساختگی تست‌ها که در فهرست‌ها و تشخیص «راه‌اندازی شده» شمرده نمی‌شوند */
export const SYNTHETIC_TEST_USERNAME_PREFIXES = ['testuser_', 'test_', 'e2e_'] as const;

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
