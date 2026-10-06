import { Request, Response, NextFunction, RequestHandler } from 'express';
import { orm } from '../db/drizzle.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rolePermissionsCache } from '../lib/memoryCache.js';
import { asyncHandler } from './asyncHandler.js';
import { isCatalogPermission, SYSTEM_ADMIN_ROLE } from '../lib/permissions/permissionCatalog.js';

async function getCachedRoleData(roleCode: string) {
  return rolePermissionsCache.getOrSet(roleCode, async () => {
    const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, roleCode));
    if (!roleRecord) return null;
    return {
      permissions: Array.isArray(roleRecord.permissions) ? (roleRecord.permissions as string[]) : [],
      isSystem: roleRecord.isSystem ?? 0
    };
  }, 60_000);
}

/**
 * v7.0.51 (audit P2-10): کد نقش و کلید مجوز دو فضای نام جدا هستند. کلید مجوز همیشه نقطه دارد (`customers.manage`)
 * و کد نقش هرگز (`ROLE_CODE_PATTERN`، بررسی در ساخت نقش). پیش‌تر کد نقش کاربر با همه ورودی‌های گارد مقایسه می‌شد،
 * پس نقشی با کد `customers.manage` هر مسیری را که این مجوز لازم داشت باز می‌کرد، بدون آن‌که مجوز را داشته باشد.
 * اکنون کد نقش فقط با ورودی‌های بدون نقطه (نام نقش) و مجوزهای نقش فقط با کلیدهای مجوز سنجیده می‌شوند.
 */
export const ROLE_CODE_PATTERN = /^[a-z0-9_-]+$/;

export function isPermissionKey(entry: string): boolean {
  return entry.includes('.');
}

/** مجوزهای نقش (از کش ۶۰ ثانیه‌ای)؛ `*` قدیمی تا حذفش در ۲-M2 همه را می‌دهد */
async function roleHoldsAny(role: string, permissionKeys: readonly string[]): Promise<boolean> {
  const roleData = await getCachedRoleData(role);
  const perms: string[] = roleData?.permissions || [];
  return perms.includes('*') || permissionKeys.some(k => perms.includes(k));
}

async function roleOrPermissionGranted(role: string, entries: string[]): Promise<boolean> {
  // Admin always has full access
  if (role === SYSTEM_ADMIN_ROLE) return true;
  const roleCodes = entries.filter(e => !isPermissionKey(e));
  if (roleCodes.includes(role)) return true;
  return roleHoldsAny(role, entries.filter(isPermissionKey));
}

/**
 * v9.0.80 (TD-881، مدل مجوز §۴.۲): تنها بررسی دسترسی بر پایه مجوز. «مدیر سیستم» همه را دارد؛ هر کاربر دیگر فقط وقتی
 * نقشش یکی از کلیدها را دارد. کد نقش هرگز پرسیده نمی‌شود: ورودی بی‌نقطه خطای برنامه‌نویسی است و پرتاب می‌شود.
 */
export async function can(user: { role?: string } | undefined, ...permissionKeys: string[]): Promise<boolean> {
  const notKeys = permissionKeys.filter(k => !isPermissionKey(k));
  if (permissionKeys.length === 0 || notKeys.length > 0) {
    throw new TypeError(`can() accepts permission keys only, got: ${notKeys.join(', ') || '(none)'}`);
  }
  if (!user?.role) return false;
  if (user.role === SYSTEM_ADMIN_ROLE) return true;
  return roleHoldsAny(user.role, permissionKeys);
}

/**
 * نشانه گارد روی میدل‌ور، برای استخراج جدول «مسیر ← مجوز» از روترها (`src/lib/routeGuardTable.ts`).
 * کلید رشته‌ای است نه Symbol: express-async-errors هر هندلر را می‌پوشاند و فقط کلیدهای رشته‌ای را کپی می‌کند.
 */
export const GUARD_ENTRIES = '__erpRouteGuardEntries';

function tagGuard(entries: string[], mw: RequestHandler): RequestHandler {
  return Object.assign(mw, { [GUARD_ENTRIES]: [...entries] });
}

export const authorize = (...allowedRolesOrPermissions: string[]) => {
  return tagGuard(allowedRolesOrPermissions, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    }

    try {
      if (await roleOrPermissionGranted(user.role, allowedRolesOrPermissions)) {
        return next();
      }
    } catch (e) {
      // Continue to 403 if lookup fails
    }

    return res.status(403).json({ error: 'دسترسی غیرمجاز برای این عملیات' });
  }));
};

/**
 * v9.0.80 (TD-881): گارد route فقط با کلیدهای کاتالوگ مجوز. کلید بیرون از کاتالوگ یا کد نقش هنگام ساختن روتر
 * (راه‌اندازی سرور) خطا می‌دهد، پس گاردی که هیچ نقشی نمی‌تواند بگیرد ساخته نمی‌شود. عبور با `can`.
 */
export const requirePermission = (...permissionKeys: string[]) => {
  const invalid = permissionKeys.filter(k => !isCatalogPermission(k));
  if (permissionKeys.length === 0 || invalid.length > 0) {
    throw new TypeError(`requirePermission() accepts permission catalog keys only, got: ${invalid.join(', ') || '(none)'}`);
  }
  return tagGuard(permissionKeys, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    }

    try {
      if (await can(user, ...permissionKeys)) {
        return next();
      }

      return res.status(403).json({ error: `شما مجوز لازم (${permissionKeys.join(' یا ')}) برای انجام این کار را ندارید` });
    } catch (err) {
      return res.status(500).json({ error: 'خطا در بررسی مجوز دسترسی' });
    }
  }));
};

/** نام قدیمی همان گارد `requirePermission` (۲۰۵ route)؛ گارد تازه `requirePermission` را به کار ببرد */
export const authorizePermission = requirePermission;

/**
 * v7.0.26 (TD-184): بررسی برنامه‌ای «نقش یا مجوز» برای منطق سرویس‌ها (مثلاً مجوز سطح کلید در تنظیمات)
 * با همان کش نقش‌ها و همان قاعده‌های میدل‌ور authorize.
 */
export async function userHasRoleOrPermission(
  user: { role?: string } | undefined,
  ...rolesOrPermissions: string[]
): Promise<boolean> {
  if (!user?.role) return false;
  try {
    return await roleOrPermissionGranted(user.role, rolesOrPermissions);
  } catch {
    return false;
  }
}
