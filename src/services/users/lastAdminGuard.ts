import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ConflictError } from '../../errors/customErrors.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

export { SYSTEM_ADMIN_ROLE };

/**
 * v9.0.75 (TD-524, B02-09): ویرایش و حذف کاربر مجموعه مدیران سیستم را زیر یک قفل تراکنشی تغییر می‌دهند. پیش‌تر حذف آخرین
 * مدیر رد می‌شد ولی ویرایش نقش او پذیرفته می‌شد و سامانه بی مدیر می‌ماند. قفل پیش از قفل ردیف کاربر گرفته می‌شود تا حذف
 * و ویرایش هم‌زمان دو مدیر به بن‌بست نرسند و هر کدام وضع پس از دیگری را ببیند.
 */
export async function lockSystemAdminSet(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.SYSTEM_ADMIN_SET}::bigint)`);
}

/** مدیر سیستم فعال دیگری جز این کاربر هست؛ وگرنه ۴۰۹ با پیام فارسی (پس از `lockSystemAdminSet`) */
export async function assertAnotherActiveAdmin(tx: DbTransaction, userId: number, action: 'delete' | 'demote'): Promise<void> {
  const others = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, SYSTEM_ADMIN_ROLE), eq(users.isDeleted, 0), ne(users.id, userId)))
    .limit(1);
  if (others.length > 0) return;
  throw new ConflictError(action === 'delete'
    ? 'آخرین مدیر سیستم قابل حذف نیست؛ ابتدا باید مدیر دیگری تعریف شود.'
    : 'نقش آخرین مدیر سیستم را نمی‌توان تغییر داد؛ ابتدا مدیر سیستم دیگری تعریف کنید.', { code: 'LAST_SYSTEM_ADMIN' });
}
