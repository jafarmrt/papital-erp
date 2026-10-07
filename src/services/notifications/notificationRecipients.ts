import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { permissionDefinition, SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * v9.0.127 (TD-883، مدل مجوز §۴.۲): گیرنده اعلان «دارندگان یک مجوز» است، با همان قاعده `can`: مدیر سیستم و هر کاربر
 * حذف‌نشده‌ای که نقشش آن کلید را دارد. پیش‌تر قاعده پیش‌فرض کسری موجودی فقط به کد `warehouse_keeper` و اعلان «معامله
 * موفق» به پنج کد ثابت می‌رفت، پس نقش سفارشی با همان تیک‌ها هیچ‌کدام را نمی‌گرفت.
 */
export async function permissionHolderUserIds(permission: string): Promise<number[]> {
  if (!permissionDefinition(permission)) throw new Error(`Unknown permission key for notification recipients: ${permission}`);
  const rows = await orm.select({ id: users.id }).from(users)
    .leftJoin(roles, eq(roles.code, users.role))
    .where(and(eq(users.isDeleted, 0), sql`(${users.role} = ${SYSTEM_ADMIN_ROLE} OR coalesce(${roles.permissions}, '[]'::jsonb) ? ${permission})`))
    .orderBy(users.id);
  return rows.map(r => r.id);
}

/** کاربران حذف‌نشده یک نقش که مدیر در تنظیم قاعده برگزیده است (داده، نه کد) */
export async function roleMemberUserIds(roleCode: string): Promise<number[]> {
  const rows = await orm.select({ id: users.id }).from(users)
    .where(and(eq(users.isDeleted, 0), eq(users.role, roleCode)))
    .orderBy(users.id);
  return rows.map(r => r.id);
}

/** کلید گیرنده اعلان قاعده باید در کاتالوگ مجوزها باشد */
export function assertNotificationPermission(permission: unknown): void {
  if (permission === undefined || permission === null || permission === '') return;
  if (typeof permission !== 'string' || !permissionDefinition(permission)) {
    throw new ValidationError(`مجوز گیرندگان اعلان «${String(permission)}» در فهرست مجوزها نیست.`, { targetPermission: permission }, 'NOTIFICATION_PERMISSION_UNKNOWN');
  }
}
