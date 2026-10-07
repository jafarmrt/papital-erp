import { eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { roles } from '../../db/schema.js';
import { ForbiddenError } from '../../errors/customErrors.js';
import { isSystemAdminRole } from '../../lib/permissions/permissionCatalog.js';
import { grantorPermissionsOf, permissionsBeyond, permissionTitles, type GrantorPermissions } from '../../lib/permissions/grantBoundary.js';

/**
 * v9.0.112 (TD-520، یافته B02-05، تصمیم ت۳ الف): دارنده غیرمدیر `users.manage` / `roles.manage` دسترسی خودش را بالا
 * نمی‌برد. پیش‌تر دارنده «مدیریت نقش‌ها» به نقش خودش «صدور و ویرایش اسناد حسابداری»، «مدیریت کاربران» و «مدیریت
 * تنظیمات» افزود و دارنده «مدیریت کاربران» نقش خودش را «مدیر ارشد مالی» کرد. قاعده‌ها:
 * - نقش خود را نه ویرایش می‌کند نه عوض؛
 * - نقش فقط مجوزهایی را می‌گیرد که واگذارکننده دارد، و کاربر فقط نقشی که مجوزهایش در مجوزهای واگذارکننده است؛
 * - حسابی را که نقشش مجوزی بیش از واگذارکننده دارد تغییر نمی‌دهد و حذف نمی‌کند (بازنشانی رمز آن همان دسترسی را
 *   به او می‌داد؛ همان قاعده TD-299 برای حساب مدیر سیستم).
 * مجوزها از جدول نقش‌ها خوانده می‌شوند، نه از کش ۶۰ ثانیه‌ای گارد.
 */
export const OWN_ROLE_CHANGE_REFUSED = 'OWN_ROLE_CHANGE_REFUSED';
export const GRANT_BEYOND_OWN_PERMISSIONS = 'GRANT_BEYOND_OWN_PERMISSIONS';

export async function rolePermissions(db: DbExecutor, roleCode: string | null | undefined): Promise<string[]> {
  if (!roleCode) return [];
  const [row] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.code, roleCode));
  return Array.isArray(row?.permissions) ? (row.permissions as string[]) : [];
}

export async function grantorPermissions(actorRole: string | undefined, db: DbExecutor = orm): Promise<GrantorPermissions> {
  if (isSystemAdminRole(actorRole)) return 'all';
  return grantorPermissionsOf(actorRole, await rolePermissions(db, actorRole));
}

/** نقش تازه یا افزوده‌های نقش فقط از مجوزهای واگذارکننده */
export function assertGrantWithinOwn(grantor: GrantorPermissions, keys: readonly string[]): void {
  const beyond = permissionsBeyond(grantor, keys);
  if (beyond.length > 0) {
    throw new ForbiddenError(
      `فقط مجوزهایی را می‌توانید به نقش بدهید که خودتان دارید؛ این مجوزها را ندارید: ${permissionTitles(beyond)}`,
      { permissions: beyond },
      GRANT_BEYOND_OWN_PERMISSIONS,
    );
  }
}

/** نقش خود واگذارکننده (غیرمدیر) ویرایش نمی‌شود */
export function assertNotOwnRole(actorRole: string | undefined, targetRoleCode: string): void {
  if (!isSystemAdminRole(actorRole) && actorRole && actorRole.toLowerCase() === targetRoleCode.toLowerCase()) {
    throw new ForbiddenError(
      'نقش خودتان را نمی‌توانید ویرایش کنید؛ تغییر آن با کاربر دیگری است که «مدیریت نقش‌ها» دارد.',
      undefined,
      OWN_ROLE_CHANGE_REFUSED,
    );
  }
}

/** نقشی که به کاربر داده می‌شود در مرز مجوزهای واگذارکننده است */
export async function assertAssignableRole(db: DbExecutor, grantor: GrantorPermissions, roleCode: string): Promise<void> {
  if (grantor === 'all') return;
  const beyond = permissionsBeyond(grantor, await rolePermissions(db, roleCode));
  if (beyond.length > 0) {
    throw new ForbiddenError(
      `این نقش مجوزهایی دارد که خودتان ندارید و نمی‌توانید آن را به کاربری بدهید: ${permissionTitles(beyond)}`,
      { role: roleCode, permissions: beyond },
      GRANT_BEYOND_OWN_PERMISSIONS,
    );
  }
}

/** حسابی که نقشش مجوزی بیش از واگذارکننده دارد تغییر نمی‌کند و حذف نمی‌شود */
export async function assertManageableAccount(db: DbExecutor, grantor: GrantorPermissions, accountRole: string): Promise<void> {
  if (grantor === 'all') return;
  const beyond = permissionsBeyond(grantor, await rolePermissions(db, accountRole));
  if (beyond.length > 0) {
    throw new ForbiddenError(
      `نقش این کاربر مجوزهایی دارد که خودتان ندارید؛ حساب او را فقط کسی تغییر می‌دهد که همه آن‌ها را دارد: ${permissionTitles(beyond)}`,
      { role: accountRole, permissions: beyond },
      GRANT_BEYOND_OWN_PERMISSIONS,
    );
  }
}

/** کاربر غیرمدیر نقش حساب خودش را عوض نمی‌کند */
export function assertNotOwnAccountRole(actor: { id?: number | string; role?: string } | undefined, targetUserId: number): void {
  if (!isSystemAdminRole(actor?.role) && Number(actor?.id) === targetUserId) {
    throw new ForbiddenError(
      'نقش حساب خودتان را نمی‌توانید عوض کنید؛ تغییر آن با کاربر دیگری است که «مدیریت کاربران» دارد.',
      undefined,
      OWN_ROLE_CHANGE_REFUSED,
    );
  }
}
