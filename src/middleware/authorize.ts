import { Request, Response, NextFunction } from 'express';
import { orm } from '../db/drizzle.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
      const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, user.role));
      if (roleRecord) {
        const perms: string[] = Array.isArray(roleRecord.permissions) ? (roleRecord.permissions as string[]) : [];
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
      const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, user.role));
      
      let perms: string[] = [];
      if (roleRecord && Array.isArray(roleRecord.permissions)) {
        perms = roleRecord.permissions as string[];
      }

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

