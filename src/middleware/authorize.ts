import { Request, Response, NextFunction } from 'express';
import { orm } from '../db/drizzle.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rolePermissionsCache } from '../lib/memoryCache.js';

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

async function roleOrPermissionGranted(role: string, entries: string[]): Promise<boolean> {
  // Admin always has full access
  if (role === 'admin') return true;
  const roleCodes = entries.filter(e => !isPermissionKey(e));
  if (roleCodes.includes(role)) return true;
  const roleData = await getCachedRoleData(role);
  const perms: string[] = roleData?.permissions || [];
  const permissionKeys = entries.filter(isPermissionKey);
  return perms.includes('*') || permissionKeys.some(k => perms.includes(k));
}

export const authorize = (...allowedRolesOrPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
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
  };
};

export const authorizePermission = (...permissionKeys: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    }

    try {
      if (await roleOrPermissionGranted(user.role, permissionKeys)) {
        return next();
      }

      return res.status(403).json({ error: `شما مجوز لازم (${permissionKeys.join(' یا ')}) برای انجام این کار را ندارید` });
    } catch (err) {
      return res.status(500).json({ error: 'خطا در بررسی مجوز دسترسی' });
    }
  };
};

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
