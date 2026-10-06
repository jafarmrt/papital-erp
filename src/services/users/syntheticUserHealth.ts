import { and, asc, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { syntheticTestUsername } from '../../lib/syntheticUsers.js';
import type { HealthCheckTestResult } from '../../types/accounting.types.js';

export interface SyntheticUserRow { id: number; username: string; fullName: string | null; role: string }

/** بیشینه ردیف‌های فهرست‌شده در گزارش؛ شمار همیشه کامل است */
const MAX_LISTED = 200;

/** v9.0.61 (TD-521): کاربران حذف‌نشده‌ای که نام کاربری‌شان با پیشوند کاربران آزمون شروع می‌شود */
export async function findActiveSyntheticUsers(db: DbExecutor = orm): Promise<SyntheticUserRow[]> {
  return db.select({ id: users.id, username: users.username, fullName: users.fullName, role: users.role })
    .from(users)
    .where(and(eq(users.isDeleted, 0), syntheticTestUsername(users.username)))
    .orderBy(asc(users.id));
}

export function buildSyntheticUsersHealthTest(rows: SyntheticUserRow[]): HealthCheckTestResult {
  const count = rows.length;
  return {
    id: 'synthetic_test_users',
    category: 'system',
    title: 'کاربران فعال با پیشوند آزمون',
    description: 'نام کاربری با test_، e2e_ یا testuser_ ویژه کاربران آزمون خودکار است و از رابط ساخته نمی‌شود؛ چنین کاربر فعالی در پایگاه‌داده عملیاتی یا جامانده آزمون است یا پیش از v9.0.61 ساخته شده و باید بازبینی شود',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, count),
    count,
    message: count > 0
      ? `${count} کاربر فعال نام کاربری با پیشوند آزمون دارد. این کاربران وارد سامانه می‌شوند و در صفحه کاربران دیده می‌شوند؛ اگر کاربر واقعی نیستند حذفشان کنید.`
      : 'هیچ کاربر فعالی نام کاربری با پیشوند آزمون ندارد.',
    items: rows.slice(0, MAX_LISTED).map(r => ({
      id: r.id,
      code: r.username,
      title: r.fullName || r.username,
      subtitle: `نقش: ${r.role}`,
      details: `کاربر #${r.id} با نام کاربری «${r.username}» (TD-521).`,
    })),
    metrics: { activeSyntheticUsers: count },
  };
}
