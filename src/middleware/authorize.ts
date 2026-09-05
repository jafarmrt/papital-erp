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

export const authorize = (...allowedRolesOrPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'احراز هویت انجام نشده است' });
    }
    // Admin always has full access
    if (user.role === 'admin' || allowedRolesOrPermissions.includes(user.role)) {
      return next();
    }

    try {
      const roleData = await getCachedRoleData(user.role);
      if (roleData) {
        const perms: string[] = roleData.permissions;
        if (perms.includes('*') || allowedRolesOrPermissions.some(k => perms.includes(k))) {
          return next();
        }
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

    // Admin has unrestricted access to everything
    if (user.role === 'admin' || permissionKeys.includes(user.role)) {
      return next();
    }

    try {
      const roleData = await getCachedRoleData(user.role);
      const perms: string[] = roleData?.permissions || [];

      const hasPermission = perms.includes('*') || permissionKeys.some(key => perms.includes(key) || user.role === key);
      if (hasPermission) {
        return next();
      }

      return res.status(403).json({ error: `شما مجوز لازم (${permissionKeys.join(' یا ')}) برای انجام این کار را ندارید` });
    } catch (err) {
      return res.status(500).json({ error: 'خطا در بررسی مجوز دسترسی' });
    }
  };
};

