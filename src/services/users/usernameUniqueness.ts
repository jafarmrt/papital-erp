import { asc, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import type { HealthCheckTestResult } from '../../types.js';
import { usernameKey } from '../../lib/users/usernameRules.js';

/**
 * OBS-R1-30 (ت۴۰ item 8): a live user's username is unique by `lower(btrim(username))`. Migration 0124 builds the
 * partial unique index uq_users_username_key (is_deleted = 0) only on data without such duplicates, and the financial
 * health check lists the live duplicates that are left (username_case_uniqueness); deleting one of the two accounts
 * clears one. Old usernames are never changed. A new user is still refused a deleted user's key (TD-519), in the service.
 */
export const USERNAME_KEY_UNIQUE_INDEX = 'uq_users_username_key';

/** where the system admin builds the index once the duplicates are gone (CONDITIONAL_CONSTRAINT_RULES) */
const UNIQUE_INDEX_BUILD_HINT = 'قید را از کارت «قیدهای جاافتاده پایگاه‌داده» در «عملیات سامانه» با «ساختن قیدهای جاافتاده» بسازید.';

export interface DuplicateUsernameRow {
  id: number;
  username: string;
  fullName: string | null;
}

export async function findCaseDuplicateUsernames(db: DbExecutor): Promise<DuplicateUsernameRow[]> {
  const key = sql`lower(btrim(${users.username}))`;
  return db.select({ id: users.id, username: users.username, fullName: users.fullName })
    .from(users)
    .where(sql`${users.isDeleted} = 0 AND ${key} IN (
      SELECT lower(btrim(u.username)) FROM users u WHERE u.is_deleted = 0 GROUP BY lower(btrim(u.username)) HAVING COUNT(*) > 1
    )`)
    .orderBy(asc(key), asc(users.id));
}

export async function hasUsernameKeyUniqueIndex(db: DbExecutor): Promise<boolean> {
  const res = await db.execute(sql`SELECT to_regclass(format('%I.%I', current_schema(), ${USERNAME_KEY_UNIQUE_INDEX}::text)) IS NOT NULL AS present`);
  return Boolean((res.rows?.[0] as { present?: boolean } | undefined)?.present);
}

export function buildUsernameUniquenessHealthTest(duplicates: DuplicateUsernameRow[], uniqueIndexPresent: boolean): HealthCheckTestResult {
  const idsByKey = new Map<string, number[]>();
  for (const r of duplicates) {
    const k = usernameKey(r.username);
    idsByKey.set(k, [...(idsByKey.get(k) ?? []), r.id]);
  }
  const duplicateCount = idsByKey.size;
  const userNumber = (id: number) => `#${id.toLocaleString('fa-IR', { useGrouping: false })}`;
  return {
    id: 'username_case_uniqueness',
    category: 'system',
    title: 'یکتایی نام کاربری بی توجه به بزرگی و کوچکی حروف',
    description: 'دو نام کاربری کاربران فعال که فقط در بزرگی و کوچکی حروف یا فاصله دو سر فرق دارند یک نام‌اند و پایگاه‌داده با ایندکس یکتا از آن جلوگیری می‌کند',
    status: duplicateCount > 0 || !uniqueIndexPresent ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, duplicateCount * 2),
    count: duplicateCount,
    message: duplicateCount > 0
      ? `${duplicateCount.toLocaleString('fa-IR')} نام کاربری میان بیش از یک کاربر فعال تکرار شده و قید یکتایی در پایگاه‌داده اعمال نشده است؛ نام‌ها خودکار عوض نمی‌شوند و همچنان وارد می‌شوند. یکی از دو حساب را حذف کنید، سپس ${UNIQUE_INDEX_BUILD_HINT}`
      : (uniqueIndexPresent
        ? 'هیچ نام کاربری تکرار نشده و پایگاه‌داده از نام کاربری تکراری جلوگیری می‌کند.'
        : `هیچ نام کاربری تکرار نشده اما قید یکتایی در پایگاه‌داده اعمال نشده است؛ ${UNIQUE_INDEX_BUILD_HINT}`),
    items: duplicates.map((r) => ({
      id: r.id,
      code: r.username,
      title: r.fullName || r.username,
      subtitle: 'کاربر فعال',
      details: `کاربران فعال با همین نام کاربری: ${(idsByKey.get(usernameKey(r.username)) ?? [r.id]).map(userNumber).join('، ')}`,
    })),
    metrics: { duplicateUsernames: duplicateCount, duplicateUserRows: duplicates.length, uniqueIndexPresent: uniqueIndexPresent ? 1 : 0 },
  };
}
